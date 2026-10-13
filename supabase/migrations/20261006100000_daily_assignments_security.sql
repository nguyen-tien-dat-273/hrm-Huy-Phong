-- Gioi han quyen giao viec va chuyen trang thai ngay tai database.

create or replace function public.guard_daily_assignment_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_active boolean;
  can_manage boolean;
begin
  if auth.uid() is null then
    return new;
  end if;

  select p.is_active into actor_active
  from public.profiles p
  where p.id = auth.uid();

  if not coalesce(actor_active, false) then
    raise exception 'Tài khoản không còn quyền thao tác.' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if not (
      public.can('attendance')
      and (public.is_admin() or public.manages_employee(new.user_id))
    ) then
      raise exception 'Bạn không có quyền giao việc cho nhân sự này.' using errcode = '42501';
    end if;

    if new.assigned_by is distinct from auth.uid()
       or new.status <> 'pending'
       or new.submitted_at is not null
       or new.submit_note is not null
       or new.reviewed_by is not null
       or new.reviewed_at is not null
       or new.review_note is not null
       or not exists (
         select 1 from public.profiles p
         where p.id = new.user_id and p.is_active
       ) then
      raise exception 'Thông tin giao việc không hợp lệ.' using errcode = '42501';
    end if;

    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  can_manage := public.can('attendance')
    and (public.is_admin() or public.manages_employee(old.user_id));

  if auth.uid() = old.user_id then
    if (to_jsonb(new) - array['status', 'submitted_at', 'submit_note', 'updated_at'])
       is distinct from
       (to_jsonb(old) - array['status', 'submitted_at', 'submit_note', 'updated_at']) then
      raise exception 'Bạn chỉ được gửi hoặc thu hồi việc của mình.' using errcode = '42501';
    end if;

    if old.status in ('pending', 'rejected') and new.status = 'submitted' then
      if new.submitted_at is null
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
         or new.review_note is distinct from old.review_note then
        raise exception 'Thông tin gửi duyệt không hợp lệ.' using errcode = '42501';
      end if;
    elsif old.status = 'submitted' and new.status = 'pending' then
      if new.submitted_at is not null
         or new.submit_note is not null
         or new.reviewed_by is distinct from old.reviewed_by
         or new.reviewed_at is distinct from old.reviewed_at
         or new.review_note is distinct from old.review_note then
        raise exception 'Thông tin thu hồi không hợp lệ.' using errcode = '42501';
      end if;
    else
      raise exception 'Trạng thái công việc không cho phép thao tác này.' using errcode = '42501';
    end if;
  elsif can_manage then
    if new.user_id is distinct from old.user_id
       or new.assigned_by is distinct from old.assigned_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Không được đổi người nhận hoặc người giao việc.' using errcode = '42501';
    end if;

    if old.status in ('pending', 'rejected') and new.status = old.status then
      if (to_jsonb(new) - array['title', 'description', 'priority', 'work_date', 'updated_at'])
         is distinct from
         (to_jsonb(old) - array['title', 'description', 'priority', 'work_date', 'updated_at']) then
        raise exception 'Chỉ được sửa nội dung việc chưa gửi duyệt.' using errcode = '42501';
      end if;
    elsif old.status = 'submitted' and new.status in ('approved', 'rejected') then
      if (to_jsonb(new) - array['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
         is distinct from
         (to_jsonb(old) - array['status', 'reviewed_by', 'reviewed_at', 'review_note', 'updated_at'])
         or new.reviewed_by is distinct from auth.uid()
         or new.reviewed_at is null
         or (new.status = 'approved' and new.review_note is not null)
         or (new.status = 'rejected' and length(trim(coalesce(new.review_note, ''))) < 3) then
        raise exception 'Thông tin duyệt công việc không hợp lệ.' using errcode = '42501';
      end if;
    else
      raise exception 'Trạng thái công việc không cho phép thao tác này.' using errcode = '42501';
    end if;
  else
    raise exception 'Bạn không có quyền cập nhật công việc này.' using errcode = '42501';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists daily_assignments_changes_guard on public.daily_assignments;
create trigger daily_assignments_changes_guard
before insert or update on public.daily_assignments
for each row execute function public.guard_daily_assignment_changes();

-- Remove older permissive policies so PostgreSQL cannot OR them with these.
do $$
declare
  existing_policy record;
begin
  for existing_policy in
    select policyname
    from pg_policies
    where schemaname = 'public' and tablename = 'daily_assignments'
  loop
    execute format('drop policy %I on public.daily_assignments', existing_policy.policyname);
  end loop;
end;
$$;

create policy daily_assignments_read on public.daily_assignments
for select to authenticated
using (
  user_id = auth.uid()
  or assigned_by = auth.uid()
  or (
    public.can('attendance')
    and (public.is_admin() or public.manages_employee(user_id))
  )
);

create policy daily_assignments_insert on public.daily_assignments
for insert to authenticated
with check (
  public.can('attendance')
  and (public.is_admin() or public.manages_employee(user_id))
);

create policy daily_assignments_update on public.daily_assignments
for update to authenticated
using (
  user_id = auth.uid()
  or (
    public.can('attendance')
    and (public.is_admin() or public.manages_employee(user_id))
  )
)
with check (
  user_id = auth.uid()
  or (
    public.can('attendance')
    and (public.is_admin() or public.manages_employee(user_id))
  )
);

create policy daily_assignments_delete on public.daily_assignments
for delete to authenticated
using (
  public.can('attendance')
  and (public.is_admin() or public.manages_employee(user_id))
);

revoke all on function public.guard_daily_assignment_changes() from public;
