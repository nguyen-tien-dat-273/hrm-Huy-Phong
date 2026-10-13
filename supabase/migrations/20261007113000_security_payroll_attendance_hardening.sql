-- Centralize profile access, payroll writes, and attendance bridge token lifecycle.

create or replace function public.is_admin()
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
      and p.role in ('admin', 'ceo')
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.guard_profile_privilege_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  changes_access boolean;
  changes_privilege boolean;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  select * into actor from public.profiles where id = auth.uid();
  if actor.id is null or not actor.is_active then
    raise exception 'Tài khoản không còn quyền thao tác.' using errcode = '42501';
  end if;

  if tg_op = 'DELETE' then
    if actor.role not in ('admin', 'ceo') then
      raise exception 'Chỉ Admin/CEO được xóa trực tiếp hồ sơ tài khoản.' using errcode = '42501';
    end if;
    if old.id = actor.id then
      raise exception 'Không thể tự xóa tài khoản đang đăng nhập.' using errcode = '42501';
    end if;
    return old;
  end if;

  changes_access := new.role is distinct from old.role
    or new.access_role_code is distinct from old.access_role_code
    or new.permissions is distinct from old.permissions
    or new.is_active is distinct from old.is_active
    or new.position_id is distinct from old.position_id
    or new.unit_id is distinct from old.unit_id
    or new.manager_id is distinct from old.manager_id
    or new.annual_leave_quota is distinct from old.annual_leave_quota
    or new.employment_status is distinct from old.employment_status
    or new.employee_code is distinct from old.employee_code
    or new.email is distinct from old.email;
  changes_privilege := changes_access
    or new.must_change_password is distinct from old.must_change_password;

  if old.id = actor.id then
    if changes_access then
      raise exception 'Không thể tự thay đổi vai trò, quyền hoặc thông tin phân quyền.' using errcode = '42501';
    end if;
    return new;
  end if;

  if actor.role in ('admin', 'ceo') then
    return new;
  end if;

  if public.can('users') and old.role = 'staff' and not changes_privilege then
    return new;
  end if;

  if public.can('leave') and old.role = 'staff'
    and new.name is not distinct from old.name
    and new.email is not distinct from old.email
    and new.department is not distinct from old.department
    and new.role is not distinct from old.role
    and new.access_role_code is not distinct from old.access_role_code
    and new.permissions is not distinct from old.permissions
    and new.is_active is not distinct from old.is_active
    and new.must_change_password is not distinct from old.must_change_password
    and new.position_id is not distinct from old.position_id
    and new.unit_id is not distinct from old.unit_id
    and new.manager_id is not distinct from old.manager_id
    and new.employment_status is not distinct from old.employment_status
    and new.employee_code is not distinct from old.employee_code
    and new.phone is not distinct from old.phone
    and new.hometown is not distinct from old.hometown
    and new.permanent_address is not distinct from old.permanent_address
    and new.current_address is not distinct from old.current_address
    and new.education_level is not distinct from old.education_level
    and new.school_name is not distinct from old.school_name
    and new.major is not distinct from old.major
    and new.graduation_year is not distinct from old.graduation_year
    and new.avatar_url is not distinct from old.avatar_url
    and new.hire_date is not distinct from old.hire_date
    and new.dependents_count is not distinct from old.dependents_count
    and new.created_at is not distinct from old.created_at then
    return new;
  end if;

  raise exception 'Bạn không có quyền thay đổi tài khoản này.' using errcode = '42501';
end;
$$;

drop trigger if exists profile_privilege_changes_guard on public.profiles;
create trigger profile_privilege_changes_guard
before update or delete on public.profiles
for each row execute function public.guard_profile_privilege_changes();

-- Remove legacy/dashboard policies on profiles before establishing the
-- explicit direct-read and write rules below.
alter table public.profiles enable row level security;

do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy %I on public.profiles', existing_policy.policyname);
  end loop;
end;
$$;

create policy profiles_read_direct
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.can('users')
  );

create policy profiles_update
  on public.profiles for update to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or public.can('users')
  )
  with check (
    id = auth.uid()
    or public.is_admin()
    or public.can('users')
  );

create policy profiles_delete
  on public.profiles for delete to authenticated
  using (public.is_admin());

create or replace view public.profiles_directory
with (security_barrier = true)
as
  select id, name, employee_code, department, unit_id, position_id,
         manager_id, role, is_active, avatar_url, employment_status
  from public.profiles;

revoke all on public.profiles_directory from public, anon;
grant select on public.profiles_directory to authenticated;

create or replace view public.profiles_workforce_accounts
with (security_barrier = true)
as
  select id, name, email, is_active
  from public.profiles
  where public.is_admin() or public.can_function('admin.workforce');

revoke all on public.profiles_workforce_accounts from public, anon;
grant select on public.profiles_workforce_accounts to authenticated;

create or replace view public.profiles_leave_quota
with (security_barrier = true)
as
  select id, name, department, annual_leave_quota, is_active
  from public.profiles
  where id = auth.uid() or public.can('leave');

revoke all on public.profiles_leave_quota from public, anon;
grant select on public.profiles_leave_quota to authenticated;

create or replace function public.set_annual_leave_quota(target_user uuid, quota integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.can('leave') then
    raise exception 'Bạn không có quyền quản lý hạn mức phép năm.' using errcode = '42501';
  end if;
  if quota is null or quota < 0 or quota > 365 then
    raise exception 'Hạn mức phép năm phải từ 0 đến 365 ngày.' using errcode = '22023';
  end if;

  update public.profiles
  set annual_leave_quota = quota
  where id = target_user and role = 'staff';

  if not found then
    raise exception 'Không tìm thấy nhân viên hoặc hồ sơ không phải nhân viên.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.set_annual_leave_quota(uuid, integer) from public;
grant execute on function public.set_annual_leave_quota(uuid, integer) to authenticated;

create or replace function public.get_profile_approver_ids(target_permission text default 'attendance')
returns table (user_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if target_permission is null
    or target_permission not in ('users', 'attendance', 'leave', 'shifts') then
    raise exception 'Loại quyền duyệt không hợp lệ.' using errcode = '22023';
  end if;

  return query
  select p.id
  from public.profiles p
  where p.is_active
    and (
      p.role in ('admin', 'ceo')
      or target_permission = any(coalesce(p.permissions, '{}'))
      or (
        p.role = 'teamlead'
        and target_permission = any(array['projects', 'attendance', 'shifts', 'leave']::text[])
      )
      or exists (
        select 1
        from public.system_access_roles ar
        where ar.code = p.access_role_code
          and ar.is_active
          and target_permission = any(coalesce(ar.permissions, '{}'))
      )
      or exists (
        select 1
        from public.job_position_permissions jpp
        where jpp.position_id = p.position_id
          and jpp.permission_code = target_permission
      )
    );
end;
$$;

revoke all on function public.get_profile_approver_ids(text) from public;
grant execute on function public.get_profile_approver_ids(text) to authenticated;

create or replace function public.persist_payroll_payslips(
  target_run_id uuid,
  payslip_entries jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  payroll_run public.payroll_runs%rowtype;
  entry jsonb;
  line jsonb;
  payslip_id uuid;
  seen_users uuid[] := '{}';
  employee_id uuid;
begin
  if auth.uid() is null or not public.can_function('admin.payroll') then
    raise exception 'Bạn không có quyền ghi bảng lương.' using errcode = '42501';
  end if;
  if payslip_entries is null or jsonb_typeof(payslip_entries) <> 'array' then
    raise exception 'Danh sách phiếu lương không hợp lệ.' using errcode = '22023';
  end if;
  if jsonb_array_length(payslip_entries) > 10000 then
    raise exception 'Mỗi lần chỉ được ghi tối đa 10000 phiếu lương.' using errcode = '54000';
  end if;

  select * into payroll_run
  from public.payroll_runs
  where id = target_run_id
  for update;

  if payroll_run.id is null then
    raise exception 'Không tìm thấy kỳ lương.' using errcode = 'P0002';
  end if;
  if payroll_run.status not in ('DRAFT', 'CALCULATED') then
    raise exception 'Chỉ được ghi lại phiếu của kỳ lương nháp hoặc đã tính.' using errcode = '23514';
  end if;

  for entry in select value from jsonb_array_elements(payslip_entries)
  loop
    employee_id := nullif(entry->>'user_id', '')::uuid;
    if employee_id is null or employee_id = any(seen_users) then
      raise exception 'Phiếu lương thiếu nhân viên hoặc có nhân viên trùng.' using errcode = '22023';
    end if;
    seen_users := array_append(seen_users, employee_id);
  end loop;

  delete from public.payslips where run_id = target_run_id;

  for entry in select value from jsonb_array_elements(payslip_entries)
  loop
    insert into public.payslips (
      run_id, user_id, employee_name, employee_code, department, pay_basis,
      work_days, leave_days, paid_days, standard_days, work_hours, gross_pay,
      taxable_income, insurance_employee, insurance_employer, personal_income_tax,
      other_deductions, net_pay, snapshot
    ) values (
      target_run_id,
      (entry->>'user_id')::uuid,
      coalesce(entry->>'employee_name', ''),
      nullif(entry->>'employee_code', ''),
      nullif(entry->>'department', ''),
      entry->>'pay_basis',
      coalesce((entry->>'work_days')::numeric, 0),
      coalesce((entry->>'leave_days')::numeric, 0),
      coalesce((entry->>'paid_days')::numeric, 0),
      coalesce((entry->>'standard_days')::numeric, 0),
      coalesce((entry->>'work_hours')::numeric, 0),
      coalesce((entry->>'gross_pay')::numeric, 0),
      coalesce((entry->>'taxable_income')::numeric, 0),
      coalesce((entry->>'insurance_employee')::numeric, 0),
      coalesce((entry->>'insurance_employer')::numeric, 0),
      coalesce((entry->>'personal_income_tax')::numeric, 0),
      coalesce((entry->>'other_deductions')::numeric, 0),
      coalesce((entry->>'net_pay')::numeric, 0),
      coalesce(entry->'snapshot', '{}'::jsonb)
    )
    returning id into payslip_id;

    for line in
      select value from jsonb_array_elements(coalesce(entry->'lines', '[]'::jsonb))
    loop
      insert into public.payslip_lines (
        payslip_id, sequence, code, name, kind, quantity, rate, amount,
        taxable, insurable, detail
      ) values (
        payslip_id,
        coalesce((line->>'sequence')::integer, 0),
        coalesce(line->>'code', ''),
        coalesce(line->>'name', ''),
        line->>'kind',
        nullif(line->>'quantity', '')::numeric,
        nullif(line->>'rate', '')::numeric,
        coalesce((line->>'amount')::numeric, 0),
        coalesce((line->>'taxable')::boolean, true),
        coalesce((line->>'insurable')::boolean, false),
        nullif(line->>'detail', '')
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.persist_payroll_payslips(uuid, jsonb) from public;
grant execute on function public.persist_payroll_payslips(uuid, jsonb) to authenticated;
revoke insert, update, delete on public.payslips, public.payslip_lines from public, anon, authenticated;

create table if not exists public.attendance_device_auth_failures (
  minute_bucket timestamptz primary key,
  failure_count bigint not null default 0 check (failure_count > 0)
);

alter table public.attendance_device_auth_failures enable row level security;
revoke all on public.attendance_device_auth_failures from public, anon, authenticated;
grant select on public.attendance_device_auth_failures to authenticated;
drop policy if exists attendance_device_auth_failures_admin
  on public.attendance_device_auth_failures;
create policy attendance_device_auth_failures_admin
  on public.attendance_device_auth_failures for select to authenticated
  using (public.is_admin());

update public.attendance_device_tokens
set expires_at = now() + interval '30 days'
where expires_at is null and revoked_at is null;

create or replace function public.record_attendance_device_auth_failure()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  bucket timestamptz := date_trunc('minute', now());
begin
  insert into public.attendance_device_auth_failures(minute_bucket, failure_count)
  values (bucket, 1)
  on conflict (minute_bucket) do update
    set failure_count = public.attendance_device_auth_failures.failure_count + 1;
end;
$$;

revoke all on function public.record_attendance_device_auth_failure() from public;

create or replace function public.issue_attendance_device_token(
  target_device uuid,
  token_label text default 'Bridge'
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  plain_token text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ Admin/CEO được tạo khóa đồng bộ.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.attendance_devices
    where id = target_device and is_active
  ) then
    raise exception 'Máy chấm công không tồn tại hoặc đã tắt.' using errcode = '22023';
  end if;

  update public.attendance_device_tokens
  set expires_at = least(coalesce(expires_at, now() + interval '7 days'), now() + interval '7 days')
  where device_id = target_device
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  plain_token := 'rj_' || replace(gen_random_uuid()::text, '-', '')
    || replace(gen_random_uuid()::text, '-', '');
  insert into public.attendance_device_tokens(device_id, label, token_hash, expires_at)
  values (
    target_device,
    coalesce(nullif(trim(token_label), ''), 'Bridge'),
    encode(digest(plain_token, 'sha256'), 'hex'),
    now() + interval '90 days'
  );
  return plain_token;
end;
$$;

revoke all on function public.issue_attendance_device_token(uuid, text) from public;
grant execute on function public.issue_attendance_device_token(uuid, text) to authenticated;

do $$
begin
  if to_regprocedure('public.ingest_attendance_device_events_validated(text,jsonb)') is null then
    execute 'alter function public.ingest_attendance_device_events(text, jsonb) rename to ingest_attendance_device_events_validated';
  end if;
end;
$$;

revoke all on function public.ingest_attendance_device_events_validated(text, jsonb)
  from public, anon, authenticated;

create or replace function public.ingest_attendance_device_events(
  bridge_token text,
  events jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  result jsonb;
begin
  if bridge_token is null or length(bridge_token) < 20 then
    perform public.record_attendance_device_auth_failure();
    return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  end if;

  begin
    select public.ingest_attendance_device_events_validated(bridge_token, events)
    into result;
    return result || jsonb_build_object('ok', true);
  exception
    when sqlstate '28000' then
      perform public.record_attendance_device_auth_failure();
      return jsonb_build_object('ok', false, 'code', 'AUTH_FAILED');
  end;
exception
  when others then
    raise;
end;
$$;

comment on function public.ingest_attendance_device_events(text, jsonb)
  is 'Ingests attendance events, returns an explicit AUTH_FAILED result for invalid bridge tokens, and records aggregate failures without storing token values.';

revoke all on function public.ingest_attendance_device_events(text, jsonb) from public;
grant execute on function public.ingest_attendance_device_events(text, jsonb) to anon, authenticated;
