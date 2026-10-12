-- All leave requests require a direct manager approval followed by HR approval.
do $$
begin
  if to_regprocedure('public.manages_employee(uuid)') is null then
    raise exception 'Migration 20260930100000_teamlead_department_scope.sql must be applied first.';
  end if;
end;
$$;

alter table public.leave_requests
  drop constraint if exists leave_requests_approval_stage_check;

update public.leave_requests
set approval_stage = 'HR'
where status = 'pending' and approval_stage = 'DIRECTOR';

alter table public.leave_requests
  add constraint leave_requests_approval_stage_check
  check (approval_stage is null or approval_stage in ('MANAGER', 'HR'));

comment on column public.leave_requests.approval_stage is
  'Cấp đang chờ duyệt: MANAGER = quản lý trực tiếp/phụ trách đơn vị, HR = nhân sự. Mọi đơn đều đi qua cả hai cấp.';

-- Replace legacy policies instead of assuming their names. A leftover
-- permissive FOR ALL policy would otherwise override the scoped rules below.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'leave_requests'
      and cmd in ('ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE')
  loop
    execute format('drop policy %I on public.leave_requests', existing_policy.policyname);
  end loop;
end;
$$;

create policy leave_requests_read_scoped
  on public.leave_requests for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.can('users')
    or (public.can('leave') and public.manages_employee(user_id))
  );

create policy leave_requests_insert_own
  on public.leave_requests for insert to authenticated
  with check (user_id = auth.uid());

create policy leave_requests_review_update
  on public.leave_requests for update to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.can('users')
    or (public.can('leave') and public.manages_employee(user_id))
  )
  with check (
    user_id = auth.uid()
    or public.is_admin()
    or public.can('users')
    or (public.can('leave') and public.manages_employee(user_id))
  );

create policy leave_requests_delete_own_pending
  on public.leave_requests for delete to authenticated
  using ((user_id = auth.uid() and status = 'pending') or public.is_admin());

grant select, insert, update, delete on public.leave_requests to authenticated;

-- Every newly submitted row starts at the manager stage, regardless of values
-- supplied by a client. Approval attribution is server managed.
create or replace function public.set_leave_approval_stage()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  new.status := 'pending';
  new.approval_stage := 'MANAGER';
  new.manager_approved_by := null;
  new.manager_approved_at := null;
  new.approved_by := null;
  new.approved_at := null;
  new.reason_reject := null;
  new.is_cancelled := false;
  new.cancelled_at := null;
  new.cancelled_by := null;
  return new;
end;
$fn$;

drop trigger if exists leave_requests_set_stage on public.leave_requests;
create trigger leave_requests_set_stage
before insert on public.leave_requests
for each row execute function public.set_leave_approval_stage();

-- Keep request content immutable during review and prevent employees from
-- editing or skipping approval stages. Editing a pending request restarts the
-- manager review so HR never approves stale content.
create or replace function public.guard_leave_two_stage_approval()
returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  current_stage text;
  request_changed boolean;
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'Không được đổi chủ sở hữu đơn nghỉ phép.' using errcode = '23514';
  end if;

  request_changed := row(new.leave_type, new.start_date, new.end_date, new.days, new.half_day, new.reason)
    is distinct from row(old.leave_type, old.start_date, old.end_date, old.days, old.half_day, old.reason);

  if old.status = 'pending' and new.status = 'pending' then
    if auth.uid() is distinct from old.user_id then
      raise exception 'Chỉ nhân viên gửi đơn mới được sửa nội dung khi đơn còn chờ duyệt.'
        using errcode = '42501';
    end if;

    new.approval_stage := case when request_changed then 'MANAGER' else old.approval_stage end;
    new.manager_approved_by := case when request_changed then null else old.manager_approved_by end;
    new.manager_approved_at := case when request_changed then null else old.manager_approved_at end;
    new.approved_by := old.approved_by;
    new.approved_at := old.approved_at;
    new.reason_reject := old.reason_reject;
    new.is_cancelled := old.is_cancelled;
    new.cancelled_at := old.cancelled_at;
    new.cancelled_by := old.cancelled_by;
    return new;
  end if;

  if old.status = 'pending' and new.status in ('approved', 'rejected') then
    if request_changed
       or new.approval_stage is distinct from old.approval_stage
       or new.manager_approved_by is distinct from old.manager_approved_by
       or new.manager_approved_at is distinct from old.manager_approved_at
       or new.created_at is distinct from old.created_at
       or new.is_cancelled is distinct from old.is_cancelled
       or new.cancelled_at is distinct from old.cancelled_at
       or new.cancelled_by is distinct from old.cancelled_by then
      raise exception 'Không được sửa nội dung đơn trong khi duyệt.' using errcode = '23514';
    end if;

    current_stage := coalesce(old.approval_stage, 'MANAGER');

    if current_stage = 'MANAGER' then
      if not public.manages_employee(old.user_id) then
        raise exception 'Đơn nghỉ phải được quản lý trực tiếp hoặc quản lý đơn vị duyệt trước.'
          using errcode = '42501';
      end if;

      if new.status = 'approved' then
        new.status := 'pending';
        new.approval_stage := 'HR';
        new.manager_approved_by := auth.uid();
        new.manager_approved_at := now();
        new.approved_by := null;
        new.approved_at := null;
        new.reason_reject := null;
        return new;
      end if;
    elsif current_stage = 'HR' then
      if not (public.is_admin() or public.can('users')) then
        raise exception 'Cấp duyệt cuối của đơn nghỉ phép chỉ dành cho Nhân sự/HR.'
          using errcode = '42501';
      end if;
    else
      raise exception 'Cấp duyệt đơn nghỉ không hợp lệ: %.', current_stage
        using errcode = '23514';
    end if;

    if new.status = 'rejected' and nullif(btrim(new.reason_reject), '') is null then
      raise exception 'Vui lòng nhập lý do từ chối đơn nghỉ phép.'
        using errcode = '23514';
    end if;

    new.approval_stage := null;
    new.manager_approved_by := old.manager_approved_by;
    new.manager_approved_at := old.manager_approved_at;
    new.approved_by := auth.uid();
    new.approved_at := now();
    return new;
  end if;

  -- The cancellation trigger is SECURITY DEFINER and only changes these three
  -- columns on an already-approved request. No client may rewrite a completed
  -- request through the generic UPDATE grant.
  if current_user <> 'authenticated'
     and old.status = 'approved'
     and new.status = old.status
     and new.leave_type is not distinct from old.leave_type
     and new.start_date is not distinct from old.start_date
     and new.end_date is not distinct from old.end_date
     and new.days is not distinct from old.days
     and new.half_day is not distinct from old.half_day
     and new.reason is not distinct from old.reason
     and new.approval_stage is not distinct from old.approval_stage
     and new.manager_approved_by is not distinct from old.manager_approved_by
     and new.manager_approved_at is not distinct from old.manager_approved_at
     and new.approved_by is not distinct from old.approved_by
     and new.approved_at is not distinct from old.approved_at
     and new.reason_reject is not distinct from old.reason_reject
     and new.created_at is not distinct from old.created_at then
    return new;
  end if;

  raise exception 'Không thể thay đổi đơn nghỉ đã xử lý.' using errcode = '42501';
end;
$fn$;

drop trigger if exists leave_requests_two_stage on public.leave_requests;
create trigger leave_requests_two_stage
before update on public.leave_requests
for each row execute function public.guard_leave_two_stage_approval();

update public.feature_flags
set enabled = true,
    description = 'Mọi đơn nghỉ phép cần quản lý trực tiếp duyệt trước, sau đó Nhân sự/HR chốt.'
where key = 'multi_level_approval';
