-- M04: project task requests, weekly worklog approval, and daily assignment history.

create table if not exists public.project_task_requests (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete restrict,
  request_type text not null check (request_type in ('DEADLINE_EXTENSION', 'COMPLETION')),
  previous_due_date date,
  requested_due_date date,
  request_note text not null check (length(trim(request_note)) >= 3),
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'APPROVED', 'RETURNED')),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (request_type = 'DEADLINE_EXTENSION'
      and previous_due_date is not null
      and requested_due_date is not null
      and requested_due_date > previous_due_date)
    or (request_type = 'COMPLETION'
      and previous_due_date is null
      and requested_due_date is null)
  ),
  check ((status = 'SUBMITTED') = (reviewed_at is null and reviewed_by is null))
);

create index if not exists project_task_requests_project_status_idx
  on public.project_task_requests(project_id, status, created_at desc);
create index if not exists project_task_requests_requester_idx
  on public.project_task_requests(requested_by, created_at desc);
create unique index if not exists project_task_requests_one_pending_per_type
  on public.project_task_requests(task_id, request_type)
  where status = 'SUBMITTED';

alter table public.project_task_requests enable row level security;
drop policy if exists project_task_requests_read on public.project_task_requests;
create policy project_task_requests_read on public.project_task_requests
for select to authenticated
using (
  requested_by = auth.uid()
  or public.project_member_has_permission(project_id, auth.uid(), 'task.move_any')
);
grant select on public.project_task_requests to authenticated;
revoke insert, update, delete on public.project_task_requests from authenticated;

create or replace function public.request_project_task_action(
  target_task uuid,
  request_kind text,
  target_due_date date default null,
  request_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_row public.tasks%rowtype;
  request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Bạn cần đăng nhập để gửi yêu cầu.' using errcode = '42501';
  end if;
  if request_kind is null or request_kind not in ('DEADLINE_EXTENSION', 'COMPLETION') then
    raise exception 'Loại yêu cầu không hợp lệ.' using errcode = '23514';
  end if;
  if length(trim(coalesce(request_reason, ''))) < 3 then
    raise exception 'Nhập lý do hoặc kết quả công việc (ít nhất 3 ký tự).' using errcode = '23514';
  end if;

  select * into task_row from public.tasks where id = target_task for update;
  if not found then raise exception 'Không tìm thấy tác vụ.' using errcode = 'P0002'; end if;
  if task_row.assignee_id is distinct from auth.uid()
     or not public.project_member_has_permission(task_row.project_id, auth.uid(), 'project.view') then
    raise exception 'Chỉ người được giao trong dự án mới được gửi yêu cầu.' using errcode = '42501';
  end if;

  if request_kind = 'DEADLINE_EXTENSION' then
    if task_row.due_date is null or target_due_date is null or target_due_date <= task_row.due_date then
      raise exception 'Hạn mới phải sau hạn hiện tại.' using errcode = '23514';
    end if;
    if task_row.start_date is not null and target_due_date < task_row.start_date then
      raise exception 'Hạn mới không được trước ngày bắt đầu.' using errcode = '23514';
    end if;
  elsif target_due_date is not null then
    raise exception 'Yêu cầu nghiệm thu không nhận ngày hạn mới.' using errcode = '23514';
  end if;

  insert into public.project_task_requests (
    task_id, project_id, requested_by, request_type,
    previous_due_date, requested_due_date, request_note
  )
  values (
    task_row.id, task_row.project_id, auth.uid(), request_kind,
    case when request_kind = 'DEADLINE_EXTENSION' then task_row.due_date end,
    case when request_kind = 'DEADLINE_EXTENSION' then target_due_date end,
    trim(request_reason)
  )
  returning id into request_id;

  return request_id;
end;
$$;

create or replace function public.review_project_task_request(
  target_request uuid,
  decision text,
  decision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  request_row public.project_task_requests%rowtype;
begin
  if decision is null or decision not in ('APPROVED', 'RETURNED') then
    raise exception 'Quyết định không hợp lệ.' using errcode = '23514';
  end if;
  if decision = 'RETURNED' and length(trim(coalesce(decision_note, ''))) < 3 then
    raise exception 'Nhập lý do trả lại (ít nhất 3 ký tự).' using errcode = '23514';
  end if;

  select * into request_row
  from public.project_task_requests
  where id = target_request
  for update;
  if not found then raise exception 'Không tìm thấy yêu cầu.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'Tài khoản không còn quyền thao tác.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.projects p
    where p.id = request_row.project_id
      and (p.lead_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'Chỉ trưởng dự án hoặc Admin/CEO mới được duyệt.' using errcode = '42501';
  end if;
  if request_row.status <> 'SUBMITTED' then
    raise exception 'Yêu cầu đã được xử lý hoặc thay đổi.' using errcode = '55000';
  end if;

  update public.project_task_requests
  set status = decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = case when decision = 'RETURNED' then trim(decision_note) else null end,
      updated_at = now()
  where id = request_row.id;

  if decision = 'APPROVED' and request_row.request_type = 'DEADLINE_EXTENSION' then
    update public.tasks
    set due_date = request_row.requested_due_date
    where id = request_row.task_id
      and due_date is not distinct from request_row.previous_due_date;
    if not found then
      raise exception 'Hạn tác vụ đã thay đổi; tải lại và gửi yêu cầu mới.' using errcode = '40001';
    end if;
  elsif decision = 'APPROVED' and request_row.request_type = 'COMPLETION' then
    update public.tasks
    set status = 'done'
    where id = request_row.task_id
      and status <> 'done';
  end if;
end;
$$;

create or replace function public.guard_project_task_workflow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.due_date is distinct from old.due_date
     and auth.uid() is not null
     and not exists (
       select 1 from public.project_task_requests r
       where r.task_id = old.id
         and r.request_type = 'DEADLINE_EXTENSION'
         and r.status = 'APPROVED'
         and r.previous_due_date is not distinct from old.due_date
         and r.requested_due_date is not distinct from new.due_date
     ) then
    raise exception 'Thay đổi hạn chót phải qua yêu cầu gia hạn được trưởng dự án duyệt.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done'
     and auth.uid() is not null
     and not exists (
       select 1 from public.project_task_requests r
       where r.task_id = old.id
         and r.request_type = 'COMPLETION'
         and r.status = 'APPROVED'
         and r.reviewed_at >= coalesce(old.updated_at, '-infinity'::timestamptz)
     ) then
    raise exception 'Tác vụ phải được trưởng dự án nghiệm thu trước khi chuyển hoàn thành.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists project_task_workflow_guard on public.tasks;
create trigger project_task_workflow_guard
before update of due_date, status on public.tasks
for each row execute function public.guard_project_task_workflow();

revoke all on function public.guard_project_task_workflow() from public;
revoke all on function public.request_project_task_action(uuid, text, date, text) from public;
revoke all on function public.review_project_task_request(uuid, text, text) from public;
grant execute on function public.request_project_task_action(uuid, text, date, text) to authenticated;
grant execute on function public.review_project_task_request(uuid, text, text) to authenticated;

create table if not exists public.worklog_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete cascade,
  week_start date not null,
  status text not null default 'SUBMITTED' check (status in ('SUBMITTED', 'APPROVED', 'RETURNED')),
  submit_note text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id, week_start),
  check (extract(isodow from week_start) = 1),
  check ((status = 'SUBMITTED') = (reviewed_at is null and reviewed_by is null))
);

create index if not exists worklog_submissions_review_idx
  on public.worklog_submissions(project_id, week_start, status);

alter table public.worklog_submissions enable row level security;
drop policy if exists worklog_submissions_read on public.worklog_submissions;
create policy worklog_submissions_read on public.worklog_submissions
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.projects p
    where p.id = project_id and (p.lead_id = auth.uid() or public.is_admin())
  )
);
grant select on public.worklog_submissions to authenticated;
revoke insert, update, delete on public.worklog_submissions from authenticated;

create table if not exists public.worklog_submission_history (
  id bigint generated always as identity primary key,
  submission_id uuid not null,
  user_id uuid not null,
  project_id uuid not null,
  actor_id uuid references public.profiles(id) on delete set null,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);
create index if not exists worklog_submission_history_idx
  on public.worklog_submission_history(submission_id, created_at desc);
alter table public.worklog_submission_history enable row level security;
drop policy if exists worklog_submission_history_read on public.worklog_submission_history;
create policy worklog_submission_history_read on public.worklog_submission_history
for select to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1 from public.projects p
    where p.id = project_id and (p.lead_id = auth.uid() or public.is_admin())
  )
);
grant select on public.worklog_submission_history to authenticated;
revoke insert, update, delete on public.worklog_submission_history from authenticated;

create or replace function public.record_worklog_submission_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.worklog_submission_history (
      submission_id, user_id, project_id, actor_id, new_values
    ) values (new.id, new.user_id, new.project_id, auth.uid(), to_jsonb(new));
    return new;
  end if;

  if to_jsonb(new) is distinct from to_jsonb(old) then
    insert into public.worklog_submission_history (
      submission_id, user_id, project_id, actor_id, old_values, new_values
    ) values (new.id, new.user_id, new.project_id, auth.uid(), to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end;
$$;

drop trigger if exists worklog_submission_history_record on public.worklog_submissions;
create trigger worklog_submission_history_record
after insert or update on public.worklog_submissions
for each row execute function public.record_worklog_submission_history();

create or replace function public.submit_project_worklog_week(
  target_week_start date,
  submission_note text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  project_row record;
  submitted_count integer := 0;
  affected integer;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập.' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'Tài khoản không còn quyền thao tác.' using errcode = '42501';
  end if;
  if target_week_start is null or extract(isodow from target_week_start) <> 1 then
    raise exception 'Tuần phải bắt đầu vào thứ Hai.' using errcode = '23514';
  end if;
  if target_week_start + 6 >= current_date then
    raise exception 'Chỉ gửi worklog của tuần đã kết thúc.' using errcode = '23514';
  end if;

  for project_row in
    select distinct t.project_id
    from public.task_worklogs w
    join public.tasks t on t.id = w.task_id
    where w.user_id = auth.uid()
      and w.work_date between target_week_start and target_week_start + 6
  loop
    insert into public.worklog_submissions (
      user_id, project_id, week_start, status, submit_note,
      reviewed_by, reviewed_at, review_note, updated_at
    )
    values (
      auth.uid(), project_row.project_id, target_week_start, 'SUBMITTED',
      nullif(trim(submission_note), ''), null, null, null, now()
    )
    on conflict (user_id, project_id, week_start) do update
      set status = 'SUBMITTED',
          submit_note = excluded.submit_note,
          reviewed_by = null,
          reviewed_at = null,
          review_note = null,
          updated_at = now()
      where worklog_submissions.status = 'RETURNED';

    get diagnostics affected = row_count;
    submitted_count := submitted_count + affected;
  end loop;

  if submitted_count = 0 then
    raise exception 'Không có worklog để gửi hoặc tuần này đã gửi/được duyệt.' using errcode = '55000';
  end if;
  return submitted_count;
end;
$$;

create or replace function public.review_project_worklog_submission(
  target_submission uuid,
  decision text,
  decision_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_row public.worklog_submissions%rowtype;
begin
  if decision is null or decision not in ('APPROVED', 'RETURNED') then
    raise exception 'Quyết định không hợp lệ.' using errcode = '23514';
  end if;
  if decision = 'RETURNED' and length(trim(coalesce(decision_note, ''))) < 3 then
    raise exception 'Nhập lý do trả worklog (ít nhất 3 ký tự).' using errcode = '23514';
  end if;

  select * into submission_row
  from public.worklog_submissions where id = target_submission for update;
  if not found then raise exception 'Không tìm thấy worklog.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'Tài khoản không còn quyền thao tác.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.projects p
    where p.id = submission_row.project_id
      and (p.lead_id = auth.uid() or public.is_admin())
  ) then
    raise exception 'Chỉ trưởng dự án hoặc Admin/CEO mới được duyệt worklog.' using errcode = '42501';
  end if;
  if submission_row.status <> 'SUBMITTED' then
    raise exception 'Worklog đã được xử lý.' using errcode = '55000';
  end if;

  update public.worklog_submissions
  set status = decision,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = case when decision = 'RETURNED' then trim(decision_note) else null end,
      updated_at = now()
  where id = submission_row.id;
end;
$$;

create or replace function public.guard_submitted_worklog_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_locked boolean := false;
  new_locked boolean := false;
  old_user uuid;
  old_task uuid;
  old_date date;
  new_user uuid;
  new_task uuid;
  new_date date;
begin
  if tg_op <> 'INSERT' then
    old_user := old.user_id;
    old_task := old.task_id;
    old_date := old.work_date;
    select exists (
      select 1 from public.worklog_submissions s
      join public.tasks t on t.project_id = s.project_id
      where s.user_id = old_user and t.id = old_task
        and s.week_start = date_trunc('week', old_date)::date
        and s.status in ('SUBMITTED', 'APPROVED')
    ) into old_locked;
  end if;
  if tg_op <> 'DELETE' then
    new_user := new.user_id;
    new_task := new.task_id;
    new_date := new.work_date;
    select exists (
      select 1 from public.worklog_submissions s
      join public.tasks t on t.project_id = s.project_id
      where s.user_id = new_user and t.id = new_task
        and s.week_start = date_trunc('week', new_date)::date
        and s.status in ('SUBMITTED', 'APPROVED')
    ) into new_locked;
  end if;
  if old_locked or new_locked then
    raise exception 'Worklog tuần này đã gửi duyệt/được duyệt; không thể sửa hoặc xóa.' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists worklog_submission_guard on public.task_worklogs;
create trigger worklog_submission_guard
before insert or update or delete on public.task_worklogs
for each row execute function public.guard_submitted_worklog_changes();

revoke all on function public.record_worklog_submission_history() from public;
revoke all on function public.guard_submitted_worklog_changes() from public;
revoke all on function public.submit_project_worklog_week(date, text) from public;
revoke all on function public.review_project_worklog_submission(uuid, text, text) from public;
grant execute on function public.submit_project_worklog_week(date, text) to authenticated;
grant execute on function public.review_project_worklog_submission(uuid, text, text) to authenticated;

create table if not exists public.daily_assignment_history (
  id bigint generated always as identity primary key,
  assignment_id uuid not null,
  event_type text not null check (event_type in ('CREATED', 'UPDATED', 'DELETED')),
  actor_id uuid references public.profiles(id) on delete set null,
  user_id uuid not null,
  assigned_by uuid,
  reviewed_by uuid,
  old_values jsonb,
  new_values jsonb,
  created_at timestamptz not null default now()
);

create index if not exists daily_assignment_history_assignment_idx
  on public.daily_assignment_history(assignment_id, created_at desc);
alter table public.daily_assignment_history enable row level security;
drop policy if exists daily_assignment_history_read on public.daily_assignment_history;
create policy daily_assignment_history_read on public.daily_assignment_history
for select to authenticated
using (
  user_id = auth.uid()
  or assigned_by = auth.uid()
  or reviewed_by = auth.uid()
  or public.is_admin()
  or public.manages_employee(user_id)
);
grant select on public.daily_assignment_history to authenticated;
revoke insert, update, delete on public.daily_assignment_history from authenticated;

create or replace function public.record_daily_assignment_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.daily_assignment_history (
      assignment_id, event_type, actor_id, user_id, assigned_by, reviewed_by, new_values
    ) values (
      new.id, 'CREATED', auth.uid(), new.user_id, new.assigned_by, new.reviewed_by, to_jsonb(new)
    );
    return new;
  elsif tg_op = 'UPDATE' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      insert into public.daily_assignment_history (
        assignment_id, event_type, actor_id, user_id, assigned_by, reviewed_by, old_values, new_values
      ) values (
        new.id, 'UPDATED', auth.uid(), new.user_id, new.assigned_by, new.reviewed_by,
        to_jsonb(old), to_jsonb(new)
      );
    end if;
    return new;
  end if;

  insert into public.daily_assignment_history (
    assignment_id, event_type, actor_id, user_id, assigned_by, reviewed_by, old_values
  ) values (
    old.id, 'DELETED', auth.uid(), old.user_id, old.assigned_by, old.reviewed_by, to_jsonb(old)
  );
  return old;
end;
$$;

drop trigger if exists daily_assignment_history_record on public.daily_assignments;
create trigger daily_assignment_history_record
after insert or update or delete on public.daily_assignments
for each row execute function public.record_daily_assignment_history();

revoke all on function public.record_daily_assignment_history() from public;

notify pgrst, 'reload schema';
