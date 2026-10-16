-- Allow the assigned employee to reopen a completed task for follow-up work.
-- Reopening changes only the status; task content and deletion stay protected.
create or replace function public.guard_project_task_status_transition()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    if old.status = 'done'
       and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'Thẻ đã hoàn thành; chỉ được mở lại để tiếp tục công việc.' using errcode = '55000';
    end if;
    return new;
  end if;

  if old.status = 'done' then
    if new.status in ('todo', 'in_progress')
       and (to_jsonb(new) - 'status' - 'updated_at') is not distinct from (to_jsonb(old) - 'status' - 'updated_at')
       and old.assignee_id = auth.uid()
       and public.project_member_has_permission(old.project_id, auth.uid(), 'task.move_own') then
      return new;
    end if;
    raise exception 'Chỉ người được giao mới có thể kéo task hoàn thành về Cần làm hoặc Đang làm.' using errcode = '55000';
  end if;

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
  if old.status = 'in_review' then
    raise exception 'Thẻ đang chờ nghiệm thu nên không thể kéo thả.' using errcode = '55000';
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
revoke all on function public.guard_project_task_status_transition() from public;
