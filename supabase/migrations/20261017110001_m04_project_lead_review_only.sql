-- F04.05: only the project lead reviews completion/extension requests.
-- Reviewer = projects.lead_id or a project member with role 'lead'; Admin/CEO
-- and department heads do not review, and nobody reviews their own request.

-- Cloud recorded 20260919110000 without creating its trigger, so leads were
-- never added to project_members and could not see the project. Re-apply.
create or replace function public.sync_project_lead_membership()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.lead_id is not null and not exists (
    select 1 from public.profiles where id = new.lead_id and is_active
  ) then
    raise exception 'Trưởng nhóm dự án không tồn tại hoặc đã ngừng hoạt động.' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.lead_id is not null and old.lead_id is distinct from new.lead_id then
    update public.project_members
    set role = 'member', role_code = 'member'
    where project_id = new.id and user_id = old.lead_id and coalesce(role_code, role) = 'lead';
  end if;

  if new.lead_id is not null then
    insert into public.project_members(project_id, user_id, role, role_code)
    values (new.id, new.lead_id, 'lead', 'lead')
    on conflict (project_id, user_id) do update
      set role = 'lead', role_code = 'lead';
  end if;
  return new;
end;
$$;

drop trigger if exists project_lead_membership_sync on public.projects;
create trigger project_lead_membership_sync
after insert or update of lead_id on public.projects
for each row execute function public.sync_project_lead_membership();
revoke all on function public.sync_project_lead_membership() from public;

insert into public.project_members(project_id, user_id, role, role_code)
select p.id, p.lead_id, 'lead', 'lead'
from public.projects p
join public.profiles u on u.id = p.lead_id and u.is_active
where p.lead_id is not null
on conflict (project_id, user_id) do update
  set role = 'lead', role_code = 'lead';

-- Single source of truth for "may the current user review this request".
create or replace function public.can_review_project_task_request(target_request uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.project_task_requests r
    join public.projects p on p.id = r.project_id
    join public.profiles me on me.id = auth.uid() and me.is_active
    where r.id = target_request
      and r.requested_by <> auth.uid()
      and (
        p.lead_id = auth.uid()
        or exists (
          select 1 from public.project_members pm
          where pm.project_id = p.id and pm.user_id = auth.uid()
            and coalesce(pm.role_code, pm.role) = 'lead'
        )
      )
  );
$$;
revoke all on function public.can_review_project_task_request(uuid) from public;
grant execute on function public.can_review_project_task_request(uuid) to authenticated;

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
  if request_row.requested_by = auth.uid() then
    raise exception 'Bạn không thể tự kiểm duyệt yêu cầu của mình.' using errcode = '42501';
  end if;
  if not public.can_review_project_task_request(target_request) then
    raise exception 'Chỉ trưởng dự án mới được duyệt yêu cầu này.' using errcode = '42501';
  end if;
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
revoke all on function public.review_project_task_request(uuid, text, text) from public;
grant execute on function public.review_project_task_request(uuid, text, text) to authenticated;

-- Legacy Cloud trigger (not in earlier migrations): it required the 'projects'
-- permission to reach done, which blocks a staff project lead. Completion is
-- now allowed for whoever approved the matching completion request.
create or replace function public.enforce_task_approval()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'done' and old.status is distinct from 'done'
     and not public.can('projects')
     and not exists (
       select 1 from public.project_task_requests r
       where r.task_id = old.id and r.request_type = 'COMPLETION'
         and r.status = 'APPROVED' and r.reviewed_by = auth.uid()
     ) then
    raise exception 'Chỉ trưởng dự án mới xác nhận hoàn thành. Hãy gửi nghiệm thu để báo đã xong.';
  end if;

  if old.status = 'done' and new.status is distinct from 'done'
     and not public.can('projects') then
    raise exception 'Chỉ quản lý mới mở lại tác vụ đã hoàn thành.';
  end if;

  return new;
end;
$$;

notify pgrst, 'reload schema';
