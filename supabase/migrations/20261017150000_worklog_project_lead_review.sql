-- Worklog tuần: chỉ trưởng dự án duyệt (projects.lead_id hoặc thành viên vai
-- trò 'lead'), không tự duyệt. Admin/CEO vẫn XEM được để đối chiếu nhưng không
-- duyệt - thống nhất với nghiệm thu task (20261017110001).

create or replace function public.is_project_lead(target_project uuid, target_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.projects p
    where p.id = target_project and p.lead_id = target_user
  ) or exists (
    select 1 from public.project_members pm
    where pm.project_id = target_project and pm.user_id = target_user
      and coalesce(pm.role_code, pm.role) = 'lead'
  );
$$;
revoke all on function public.is_project_lead(uuid, uuid) from public, anon;
grant execute on function public.is_project_lead(uuid, uuid) to authenticated;

create or replace function public.review_project_worklog_submission(
  target_submission uuid,
  decision text,
  decision_note text default null
)
returns void language plpgsql security definer set search_path = public as $$
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
  if submission_row.user_id = auth.uid() then
    raise exception 'Bạn không thể tự duyệt worklog của mình.' using errcode = '42501';
  end if;
  if not public.is_project_lead(submission_row.project_id, auth.uid()) then
    raise exception 'Chỉ trưởng dự án mới được duyệt worklog.' using errcode = '42501';
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
revoke all on function public.review_project_worklog_submission(uuid, text, text) from public;
grant execute on function public.review_project_worklog_submission(uuid, text, text) to authenticated;

-- Trưởng dự án gán qua vai trò thành viên cũng đọc được worklog cần duyệt.
drop policy if exists worklog_submissions_read on public.worklog_submissions;
create policy worklog_submissions_read on public.worklog_submissions for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_project_lead(project_id, auth.uid())
    or public.is_admin()
  );

notify pgrst, 'reload schema';
