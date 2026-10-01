-- ============================================================================
-- Mot don vi co the co NHIEU nguoi phu trach.
-- ----------------------------------------------------------------------------
-- `organization_units.manager_id` la mot cot don, nen moi don vi chi khai
-- duoc dung mot nguoi. Thuc te mot phong thuong co truong phong va mot pho
-- phong cung duyet, hoac hai nguoi dong phu trach trong giai doan ban giao.
--
-- KHONG doi `manager_id` thanh mang: cot do dang duoc tham chieu o nhieu noi
-- (so do to chuc, hien thi "Nguoi phu trach", va quan trong nhat la ham RLS
-- `manages_employee`). Doi kieu du lieu la phai sua het mot luot, va sai mot
-- cho thi hong quyen xem du lieu cham cong.
--
-- Thay vao do: bang noi `organization_unit_managers`, con `manager_id` o lai
-- lam nguoi phu trach CHINH. Moi thu dang doc `manager_id` chay nhu cu.
--
-- Phan QUAN TRONG NHAT cua migration nay khong phai cai bang moi ma la viec
-- sua `manages_employee()`. Them nguoi phu trach ma khong sua ham do thi ho
-- chi la mot cai ten tren man hinh: khong xem duoc cham cong cua nhan vien,
-- khong duyet duoc gi.
-- ============================================================================

create table if not exists public.organization_unit_managers (
  unit_id uuid not null references public.organization_units(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Nguoi phu trach chinh, duoc dong bo nguoc ve organization_units.manager_id.
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (unit_id, user_id)
);

create index if not exists organization_unit_managers_user_idx
  on public.organization_unit_managers(user_id);

comment on table public.organization_unit_managers is
  'Nguoi phu trach cua don vi. Dong co is_primary = true duoc dong bo ve organization_units.manager_id.';

-- Mot don vi chi co MOT nguoi phu trach chinh.
create unique index if not exists organization_unit_managers_one_primary
  on public.organization_unit_managers(unit_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- Chuyen du lieu dang co sang bang moi
-- ---------------------------------------------------------------------------
insert into public.organization_unit_managers (unit_id, user_id, is_primary)
select u.id, u.manager_id, true
from public.organization_units u
where u.manager_id is not null
on conflict (unit_id, user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Giu manager_id khop voi nguoi phu trach chinh
-- ---------------------------------------------------------------------------
-- Dong bo bang trigger chu khong de ung dung tu ghi hai noi: ung dung quen
-- mot lan la hai bang lech nhau vinh vien, va cho lech do khong lo ra o dau
-- ca cho toi khi ai do mat quyen xem cham cong.
create or replace function public.sync_unit_primary_manager()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_unit uuid;
begin
  -- DELETE thi NEW chua duoc gan, phai doc tu OLD.
  v_unit := case when tg_op = 'DELETE' then old.unit_id else new.unit_id end;

  update public.organization_units u
     set manager_id = (
       select m.user_id
       from public.organization_unit_managers m
       where m.unit_id = v_unit
       order by m.is_primary desc, m.created_at asc
       limit 1
     )
   where u.id = v_unit;

  return null;
end;
$fn$;

drop trigger if exists organization_unit_managers_sync on public.organization_unit_managers;
create trigger organization_unit_managers_sync
after insert or update or delete on public.organization_unit_managers
for each row execute function public.sync_unit_primary_manager();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.organization_unit_managers enable row level security;

drop policy if exists organization_unit_managers_read on public.organization_unit_managers;
create policy organization_unit_managers_read on public.organization_unit_managers
for select to authenticated using (true);

drop policy if exists organization_unit_managers_manage on public.organization_unit_managers;
create policy organization_unit_managers_manage on public.organization_unit_managers
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.organization_unit_managers to authenticated;

-- ---------------------------------------------------------------------------
-- Pham vi quan ly xet ca nguoi phu trach phu
-- ---------------------------------------------------------------------------
-- Day moi la phan lam cho nguoi phu trach moi co quyen that. Giu nguyen hai
-- nhanh cu (quan ly truc tiep, va manager_id cua don vi/cap tren) roi them
-- mot nhanh thu ba doc bang noi - de du chua chay buoc chuyen du lieu o tren
-- thi ham van tra ve dung nhu truoc.
create or replace function public.manages_employee(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive target as (
    select p.manager_id, p.unit_id
    from public.profiles p
    where p.id = target_user
  ),
  lineage as (
    select u.id, u.parent_id, u.manager_id, 1 as depth
    from public.organization_units u
    where u.id = (select unit_id from target)
    union all
    select parent.id, parent.parent_id, parent.manager_id, child.depth + 1
    from lineage child
    join public.organization_units parent on parent.id = child.parent_id
    -- Chan lap vo han neu cay don vi bi tao thanh chu trinh.
    where child.depth < 10
  )
  select
    -- a. Quan ly truc tiep cua chinh nguoi do.
    coalesce((select manager_id from target) = auth.uid(), false)
    -- b. Nguoi phu trach chinh cua don vi hoac don vi cap tren.
    or exists (select 1 from lineage where lineage.manager_id = auth.uid())
    -- c. Nguoi dong phu trach cua don vi hoac don vi cap tren.
    or exists (
      select 1
      from public.organization_unit_managers m
      join lineage on lineage.id = m.unit_id
      where m.user_id = auth.uid()
    );
$$;

comment on function public.manages_employee(uuid) is
  'Nguoi dang dang nhap co phai quan ly cua nhan su nay khong - quan ly truc tiep, nguoi phu trach chinh, hoac nguoi dong phu trach cua don vi/don vi cap tren. Dung cho RC1.2.';

revoke all on function public.manages_employee(uuid) from public;
grant execute on function public.manages_employee(uuid) to authenticated;
