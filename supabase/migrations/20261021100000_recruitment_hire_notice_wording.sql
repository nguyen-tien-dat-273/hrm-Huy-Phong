-- Đổi lời thông báo khi thêm nhân sự cho đề xuất tuyển dụng.
-- Nhân sự được thêm là để GIẢI QUYẾT đề xuất (bù đủ số lượng cần tuyển), dự án
-- chỉ là nơi họ về làm việc. Lời cũ "Bạn được thêm vào dự án" không cho người
-- nhận biết họ đang gánh đề xuất nào, lệch với nhãn trên giao diện.
-- Chỉ phần insert vào public.notifications đổi; phần còn lại giữ nguyên bản
-- 20261020100001_recruitment_external_hire_to_project.sql.

create or replace function public.add_hire_to_project(
  target_requisition uuid, target_project uuid, target_user uuid, target_role text default 'member'
)
returns void language plpgsql security definer set search_path = public as $$
declare
  req public.recruitment_requisitions%rowtype;
  v_project_name text;
  v_user_name text;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'Chỉ Ban Giám đốc (Admin/CEO) được thêm nhân sự đã tuyển.' using errcode = '42501';
  end if;
  select * into req from public.recruitment_requisitions where id = target_requisition for update;
  if not found then raise exception 'Không tìm thấy đề xuất.' using errcode = 'P0002'; end if;
  if req.status <> 'OPEN' then
    raise exception 'Chỉ thêm nhân sự cho đề xuất đang tuyển.' using errcode = '55000';
  end if;
  select name into v_project_name from public.projects where id = target_project;
  if v_project_name is null then raise exception 'Không tìm thấy dự án.' using errcode = 'P0002'; end if;
  select name into v_user_name from public.profiles where id = target_user and is_active;
  if v_user_name is null then raise exception 'Nhân sự không tồn tại hoặc đã ngừng hoạt động.' using errcode = '23514'; end if;
  if coalesce(target_role, '') not in (select code from public.project_role_definitions where is_active and code <> 'lead') then
    raise exception 'Vai trò dự án không hợp lệ (trưởng dự án gán ở thông tin dự án).' using errcode = '23514';
  end if;
  if exists (select 1 from public.recruitment_requisition_hires where requisition_id = req.id and user_id = target_user) then
    raise exception 'Nhân sự này đã được ghi nhận cho đề xuất.' using errcode = '23505';
  end if;
  select count(*) into v_count from public.recruitment_requisition_hires where requisition_id = req.id;
  if v_count >= req.headcount then
    raise exception 'Đề xuất đã đủ số lượng cần tuyển.' using errcode = '55000';
  end if;

  insert into public.recruitment_requisition_hires(requisition_id, project_id, user_id, role_code, added_by)
  values (req.id, target_project, target_user, target_role, auth.uid());

  insert into public.project_members(project_id, user_id, role, role_code)
  values (target_project, target_user,
          case when target_role in ('member', 'viewer') then target_role else 'member' end, target_role)
  on conflict (project_id, user_id) do nothing;

  if v_count + 1 >= req.headcount then
    update public.recruitment_requisitions set status = 'CLOSED', updated_at = now() where id = req.id;
  end if;

  insert into public.notifications(id, user_id, type, title, message, created_by)
  select gen_random_uuid(), uid, 'recruitment_hire_added',
         case when uid = target_user then 'Bạn được giao giải quyết đề xuất tuyển dụng'
              else 'Đã thêm nhân sự giải quyết đề xuất' end,
         case when uid = target_user
                then req.code || ' · ' || req.title || ' · làm việc tại dự án ' || v_project_name
              else req.code || ' · ' || v_user_name || ' → ' || v_project_name
                   || ' (' || (v_count + 1) || '/' || req.headcount || ' người)' end,
         auth.uid()
  from (select distinct unnest(array[target_user, req.requested_by, req.hiring_manager_id]) as uid) owners
  where uid is not null and uid <> auth.uid();

  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, target_user_id, target_name, summary, details)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()),
    'recruitment.requisition.hire_added', 'recruitment_requisitions', req.id::text, target_user, v_user_name,
    req.code || ' · thêm ' || v_user_name || ' vào ' || v_project_name,
    jsonb_build_object('project_id', target_project, 'role', target_role, 'filled', v_count + 1, 'headcount', req.headcount));
end;
$$;

revoke all on function public.add_hire_to_project(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.add_hire_to_project(uuid, uuid, uuid, text) to authenticated;
