-- ============================================================================
-- Mo CHECK cua profiles.role cho vai tro Truong nhom (teamlead).
-- ----------------------------------------------------------------------------
-- Tao tai khoan Truong nhom bao:
--   new row for relation "profiles" violates check constraint "profiles_role_check"
--
-- Ung dung da dung bon vai tro tu lau (admin / ceo / teamlead / staff): API
-- kiem `ROLES`, RLS phan pham vi phong ban cho teamlead, giao dien co nhan
-- "Truong nhom". Chi rieng CHECK tren cot `role` la con lai o ban cu - no
-- duoc tao thang tren dashboard nen khong migration nao cham toi, va khong ai
-- thay cho toi khi co nguoi bam tao.
--
-- Doc TEN rang buoc tu catalog thay vi doan: cot nay co the dang bi rang buoc
-- boi mot ten khac.
-- ============================================================================

do $$
declare
  v_name text;
begin
  -- Xoa moi CHECK dang rang buoc cot role cua profiles, du ten la gi.
  for v_name in
    select con.conname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    join pg_attribute att
      on att.attrelid = rel.oid
     and att.attnum = any (con.conkey)
    where nsp.nspname = 'public'
      and rel.relname = 'profiles'
      and con.contype = 'c'
      and att.attname = 'role'
  loop
    execute format('alter table public.profiles drop constraint %I', v_name);
    raise notice 'Da xoa rang buoc cu: %', v_name;
  end loop;
end $$;

-- Ban ghi nao dang giu gia tri ngoai bon vai tro thi keo ve staff, neu khong
-- lenh them rang buoc ben duoi se hong giua chung.
update public.profiles
   set role = 'staff'
 where role is null
    or role not in ('admin', 'ceo', 'teamlead', 'staff');

alter table public.profiles
  alter column role set default 'staff';

alter table public.profiles
  alter column role set not null;

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('admin', 'ceo', 'teamlead', 'staff'));

comment on column public.profiles.role is
  'Vai tro he thong: admin, ceo, teamlead (Truong nhom), staff.';
