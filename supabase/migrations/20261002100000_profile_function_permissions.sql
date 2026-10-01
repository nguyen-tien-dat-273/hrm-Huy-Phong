-- Cap quyen chuc nang RIENG cho tung tai khoan.
--
-- Truoc migration nay, can_function() chi doc hai nguon: vai tro nghiep vu va
-- vi tri chuc danh. Nghia la muon cho DUNG MOT nguoi dung them mot chuc nang,
-- phai tao han mot vi tri rieng cho ho, hoac mo chuc nang do cho ca vi tri -
-- keo theo tat ca nhung ai cung vi tri.
--
-- Quyen module da co duong rieng tuong duong o profiles.permissions; bang nay
-- la phan con thieu cho quyen chuc nang.
--
-- Chay lai duoc nhieu lan.

create table if not exists public.profile_function_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  function_code text not null,
  granted_at timestamptz not null default now(),
  -- Ai la nguoi cap: quyen le kieu nay de thanh ngoai le khong ai nho vi sao
  -- con do, nen phai truy duoc nguoi bam.
  granted_by uuid default auth.uid() references public.profiles(id) on delete set null,
  primary key (user_id, function_code)
);

create index if not exists profile_function_permissions_code_idx
  on public.profile_function_permissions(function_code);

alter table public.profile_function_permissions enable row level security;

-- Doc: chinh chu xem duoc quyen cua minh; nguoi quan tri nhan su xem duoc het
-- de con doi chieu luc phan cong.
drop policy if exists profile_function_permissions_read on public.profile_function_permissions;
create policy profile_function_permissions_read
  on public.profile_function_permissions for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.can('users'));

-- Ghi: chi Admin/CEO. Mo cho can('users') la tu mo duong leo thang quyen -
-- ai co quyen sua tai khoan se tu cap duoc moi chuc nang cho chinh minh.
drop policy if exists profile_function_permissions_manage on public.profile_function_permissions;
create policy profile_function_permissions_manage
  on public.profile_function_permissions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.profile_function_permissions to authenticated;

-- can_function() doc them nguon thu ba.
--
-- Giu nguyen hai nhanh cu: ai dang vao duoc bang vai tro hay vi tri thi sau
-- migration nay van vao duoc y het.
create or replace function public.can_function(target_function text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active
      and (
        p.role in ('admin', 'ceo')
        or exists (
          select 1
          from public.system_access_role_functions rf
          join public.system_access_roles ar on ar.code = rf.access_role_code and ar.is_active
          where rf.access_role_code = p.access_role_code
            and rf.function_code = target_function
        )
        or exists (
          select 1
          from public.job_position_function_permissions pf
          where pf.position_id = p.position_id
            and pf.function_code = target_function
        )
        or exists (
          select 1
          from public.profile_function_permissions uf
          where uf.user_id = p.id
            and uf.function_code = target_function
        )
      )
  );
$$;

revoke all on function public.can_function(text) from public;
grant execute on function public.can_function(text) to authenticated;
