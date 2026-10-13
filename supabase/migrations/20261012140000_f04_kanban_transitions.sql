-- F04.04: audited status transitions and locked completion review workflow.
create table if not exists public.task_status_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  from_status text not null,
  to_status text not null,
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists task_status_logs_project_changed_idx
  on public.task_status_logs(project_id, changed_at desc);
alter table public.task_status_logs enable row level security;
drop policy if exists task_status_logs_read on public.task_status_logs;
create policy task_status_logs_read on public.task_status_logs
  for select to authenticated
  using (public.project_member_has_permission(project_id, auth.uid(), 'project.view'));
revoke insert, update, delete on public.task_status_logs from authenticated;
grant select on public.task_status_logs to authenticated;

alter table public.project_task_requests add column if not exists evidence_file_path text;
alter table public.project_task_requests add column if not exists evidence_file_name text;
insert into storage.buckets (id, name, public, file_size_limit)
values ('task-evidence', 'task-evidence', false, 10485760)
on conflict (id) do update set public = false, file_size_limit = 10485760;
drop policy if exists task_evidence_read on storage.objects;
create policy task_evidence_read on storage.objects for select to authenticated
  using (bucket_id = 'task-evidence' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and public.project_member_has_permission(((storage.foldername(name))[1])::uuid, auth.uid(), 'project.view'));
drop policy if exists task_evidence_insert on storage.objects;
create policy task_evidence_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-evidence' and (storage.foldername(name))[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (storage.foldername(name))[3] = auth.uid()::text
    and public.project_member_has_permission(((storage.foldername(name))[1])::uuid, auth.uid(), 'project.view'));

create or replace function public.log_project_task_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.task_status_logs(task_id, project_id, from_status, to_status, changed_by)
    values (new.id, new.project_id, old.status, new.status, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists task_status_log_after_update on public.tasks;
create trigger task_status_log_after_update after update of status on public.tasks
for each row execute function public.log_project_task_status();
revoke all on function public.log_project_task_status() from public;

-- Only the assigned member may move todo <-> in_progress. Review and done are
-- reached exclusively through request/review RPCs and are locked from dragging.
create or replace function public.guard_project_task_status_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'done' and
     (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'Thẻ đã hoàn thành và bị khóa hoàn toàn.' using errcode = '55000';
  end if;
  if new.status is not distinct from old.status then return new; end if;

  if old.status = 'in_review' and new.status = 'done' and exists (
    select 1 from public.project_task_requests r
    where r.task_id = old.id and r.request_type = 'COMPLETION'
      and r.status = 'APPROVED' and r.reviewed_by = auth.uid()
  ) then
    return new;
  end if;
  if old.status = 'in_review' and new.status = 'in_progress' and exists (
    select 1 from public.project_task_requests r
    where r.task_id = old.id and r.request_type = 'COMPLETION'
      and r.status = 'RETURNED' and r.reviewed_by = auth.uid()
  ) then
    return new;
  end if;
  if old.status in ('in_review', 'done') then
    raise exception 'Thẻ đang chờ nghiệm thu hoặc đã hoàn thành nên không thể kéo thả.' using errcode = '55000';
  end if;

  if new.status in ('todo', 'in_progress') then
    if new.assignee_id is distinct from auth.uid() then
      raise exception 'Chỉ người được giao mới được chuyển thẻ giữa Cần làm và Đang làm.' using errcode = '42501';
    end if;
    if not ((old.status = 'todo' and new.status = 'in_progress')
         or (old.status = 'in_progress' and new.status = 'todo')) then
      raise exception 'Chuyển cột không đúng thứ tự.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.status = 'in_review' and not exists (
    select 1 from public.project_task_requests r
    where r.task_id = old.id and r.request_type = 'COMPLETION'
      and r.status = 'SUBMITTED' and r.requested_by = auth.uid()
  ) then
    raise exception 'Chuyển sang Đang duyệt phải gửi báo cáo và minh chứng.' using errcode = '42501';
  end if;

  if new.status = 'done' and not exists (
    select 1 from public.project_task_requests r
    where r.task_id = old.id and r.request_type = 'COMPLETION'
      and r.status = 'APPROVED' and r.reviewed_by = auth.uid()
  ) then
    raise exception 'Chỉ người kiểm duyệt mới được nghiệm thu hoàn thành.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists task_status_transition_guard on public.tasks;
create trigger task_status_transition_guard before update on public.tasks
for each row execute function public.guard_project_task_status_transition();
revoke all on function public.guard_project_task_status_transition() from public;

create or replace function public.prevent_completed_task_delete()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status = 'done' then
    raise exception 'Thẻ đã hoàn thành và bị khóa hoàn toàn.' using errcode = '55000';
  end if;
  return old;
end;
$$;
drop trigger if exists completed_task_delete_guard on public.tasks;
create trigger completed_task_delete_guard before delete on public.tasks
for each row execute function public.prevent_completed_task_delete();
revoke all on function public.prevent_completed_task_delete() from public;

-- A completion submission requires a meaningful report and at least one valid
-- evidence link. It moves the card atomically into in_review.
drop function if exists public.request_project_task_action(uuid, text, date, text, text);
create function public.request_project_task_action(
  target_task uuid,
  request_kind text,
  target_due_date date default null,
  request_reason text default null,
  target_evidence_url text default null,
  target_evidence_file_path text default null,
  target_evidence_file_name text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  task_row public.tasks%rowtype;
  request_id uuid;
begin
  if auth.uid() is null then raise exception 'Bạn cần đăng nhập để gửi yêu cầu.' using errcode = '42501'; end if;
  if request_kind not in ('DEADLINE_EXTENSION', 'COMPLETION') then
    raise exception 'Loại yêu cầu không hợp lệ.' using errcode = '23514';
  end if;
  if length(trim(coalesce(request_reason, ''))) < (case when request_kind = 'COMPLETION' then 10 else 3 end) then
    raise exception 'Báo cáo nghiệm thu cần ít nhất 10 ký tự; lý do gia hạn cần ít nhất 3 ký tự.' using errcode = '23514';
  end if;
  if request_kind = 'COMPLETION' and nullif(trim(target_evidence_url), '') is null
     and nullif(trim(target_evidence_file_path), '') is null then
    raise exception 'Cần ít nhất một link hoặc file minh chứng.' using errcode = '23514';
  end if;
  if request_kind = 'COMPLETION' and nullif(trim(target_evidence_url), '') is not null and (
    length(trim(target_evidence_url)) > 2048
    or trim(target_evidence_url) !~* '^https?://[^[:space:]]+$') then
    raise exception 'Cần ít nhất một link minh chứng HTTP/HTTPS hợp lệ.' using errcode = '23514';
  end if;
  if target_evidence_file_path is not null and (
    request_kind <> 'COMPLETION' or target_evidence_file_path !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$'
    or target_evidence_file_name is null or length(target_evidence_file_name) > 255
    or not exists (select 1 from storage.objects o where o.bucket_id = 'task-evidence' and o.name = target_evidence_file_path)
  ) then
    raise exception 'File minh chứng không hợp lệ hoặc chưa tải lên.' using errcode = '23514';
  end if;
  if request_kind = 'DEADLINE_EXTENSION' and target_evidence_url is not null then
    raise exception 'Yêu cầu gia hạn không nhận minh chứng.' using errcode = '23514';
  end if;

  select * into task_row from public.tasks where id = target_task for update;
  if not found then raise exception 'Không tìm thấy tác vụ.' using errcode = 'P0002'; end if;
  if task_row.assignee_id is distinct from auth.uid()
     or not public.project_member_has_permission(task_row.project_id, auth.uid(), 'project.view') then
    raise exception 'Chỉ người được giao trong dự án mới được gửi yêu cầu.' using errcode = '42501';
  end if;
  if target_evidence_file_path is not null and target_evidence_file_path not like
    task_row.project_id::text || '/' || task_row.id::text || '/' || auth.uid()::text || '/%' then
    raise exception 'File minh chứng không thuộc nhiệm vụ này.' using errcode = '42501';
  end if;

  if request_kind = 'COMPLETION' and task_row.status <> 'in_progress' then
    raise exception 'Chỉ có thể nộp nghiệm thu từ cột Đang làm.' using errcode = '55000';
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
    previous_due_date, requested_due_date, request_note, evidence_url, evidence_file_path, evidence_file_name
  ) values (
    task_row.id, task_row.project_id, auth.uid(), request_kind,
    case when request_kind = 'DEADLINE_EXTENSION' then task_row.due_date end,
    case when request_kind = 'DEADLINE_EXTENSION' then target_due_date end,
    trim(request_reason), nullif(trim(target_evidence_url), ''), target_evidence_file_path, target_evidence_file_name
  ) returning id into request_id;

  if request_kind = 'COMPLETION' then
    update public.tasks set status = 'in_review' where id = task_row.id;
  end if;
  return request_id;
end;
$$;

create or replace function public.review_project_task_request(
  target_request uuid,
  decision text,
  decision_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare
  request_row public.project_task_requests%rowtype;
begin
  if decision not in ('APPROVED', 'RETURNED') then raise exception 'Quyết định không hợp lệ.' using errcode = '23514'; end if;
  if decision = 'RETURNED' and length(trim(coalesce(decision_note, ''))) < 10 then
    raise exception 'Lý do trả lại phải có ít nhất 10 ký tự.' using errcode = '23514';
  end if;
  select * into request_row from public.project_task_requests where id = target_request for update;
  if not found then raise exception 'Không tìm thấy yêu cầu.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active) then
    raise exception 'Tài khoản không còn quyền thao tác.' using errcode = '42501';
  end if;
  if request_row.requested_by = auth.uid() then
    raise exception 'Bạn không thể tự kiểm duyệt yêu cầu của mình.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.projects p where p.id = request_row.project_id
      and (p.lead_id = auth.uid() or public.is_admin())
  ) then raise exception 'Chỉ trưởng dự án hoặc Admin/CEO mới được duyệt.' using errcode = '42501'; end if;
  if request_row.status <> 'SUBMITTED' then raise exception 'Yêu cầu đã được xử lý hoặc thay đổi.' using errcode = '55000'; end if;

  update public.project_task_requests
  set status = decision, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = case when decision = 'RETURNED' then trim(decision_note) else null end,
      updated_at = now()
  where id = request_row.id;

  if request_row.request_type = 'DEADLINE_EXTENSION' and decision = 'APPROVED' then
    update public.tasks set due_date = request_row.requested_due_date
    where id = request_row.task_id and due_date is not distinct from request_row.previous_due_date;
    if not found then raise exception 'Hạn tác vụ đã thay đổi; tải lại và gửi yêu cầu mới.' using errcode = '40001'; end if;
  elsif request_row.request_type = 'COMPLETION' then
    if decision = 'APPROVED' then
      update public.tasks set status = 'done' where id = request_row.task_id and status = 'in_review';
    else
      update public.tasks set status = 'in_progress' where id = request_row.task_id and status = 'in_review';
    end if;
    if not found then raise exception 'Trạng thái tác vụ đã thay đổi; tải lại rồi thử lại.' using errcode = '40001'; end if;
  end if;
end;
$$;

revoke all on function public.request_project_task_action(uuid, text, date, text, text, text, text) from public;
revoke all on function public.review_project_task_request(uuid, text, text) from public;
grant execute on function public.request_project_task_action(uuid, text, date, text, text, text, text) to authenticated;
grant execute on function public.review_project_task_request(uuid, text, text) to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'task_status_logs'
  ) then
    alter publication supabase_realtime add table public.task_status_logs;
  end if;
end $$;

notify pgrst, 'reload schema';
