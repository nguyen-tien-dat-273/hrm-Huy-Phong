-- M04: allow an assignee to attach an external evidence link to a completion request.

alter table public.project_task_requests
  add column if not exists evidence_url text;

alter table public.project_task_requests
  drop constraint if exists project_task_requests_evidence_url_check;

alter table public.project_task_requests
  add constraint project_task_requests_evidence_url_check
  check (
    evidence_url is null
    or (length(evidence_url) <= 2048 and evidence_url ~* '^https?://[^[:space:]]+$')
  );

drop function if exists public.request_project_task_action(uuid, text, date, text);

create function public.request_project_task_action(
  target_task uuid,
  request_kind text,
  target_due_date date default null,
  request_reason text default null,
  target_evidence_url text default null
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
  if target_evidence_url is not null and (
    request_kind <> 'COMPLETION'
    or length(trim(target_evidence_url)) > 2048
    or trim(target_evidence_url) !~* '^https?://[^[:space:]]+$'
  ) then
    raise exception 'Link minh chứng chỉ hỗ trợ HTTP/HTTPS và chỉ dùng cho yêu cầu nghiệm thu.' using errcode = '23514';
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
    previous_due_date, requested_due_date, request_note, evidence_url
  )
  values (
    task_row.id, task_row.project_id, auth.uid(), request_kind,
    case when request_kind = 'DEADLINE_EXTENSION' then task_row.due_date end,
    case when request_kind = 'DEADLINE_EXTENSION' then target_due_date end,
    trim(request_reason), nullif(trim(target_evidence_url), '')
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.request_project_task_action(uuid, text, date, text, text) from public;
grant execute on function public.request_project_task_action(uuid, text, date, text, text) to authenticated;

notify pgrst, 'reload schema';
