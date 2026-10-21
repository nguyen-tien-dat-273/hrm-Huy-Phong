-- Trưởng dự án bấm "Duyệt" bị chặn: RPC review_project_task_request nhận người
-- có projects.lead_id, nhưng cập nhật tác vụ sau đó lại đi qua trigger
-- guard_task_member_changes — trigger này chỉ tin dòng project_members có vai trò
-- đủ quyền. Trưởng dự án được chỉ định ở projects.lead_id mà không có dòng thành
-- viên (hoặc dòng vai trò khác) sẽ bị báo "không có quyền chuyển trạng thái".
-- Coi trưởng dự án luôn có đủ quyền trong dự án của mình.
create or replace function public.project_member_has_permission(
  target_project uuid,
  target_user uuid,
  required_permission text
)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = target_user and p.is_active
      and (p.role in ('admin', 'ceo') or 'projects' = any(coalesce(p.permissions, '{}')))
  ) or exists (
    select 1 from public.projects pr
    join public.profiles p on p.id = pr.lead_id and p.is_active
    where pr.id = target_project and pr.lead_id = target_user
  ) or exists (
    select 1
    from public.project_members pm
    join public.project_role_definitions rd on rd.code = pm.role_code and rd.is_active
    where pm.project_id = target_project
      and pm.user_id = target_user
      and required_permission = any(rd.permissions)
  );
$$;

notify pgrst, 'reload schema';
