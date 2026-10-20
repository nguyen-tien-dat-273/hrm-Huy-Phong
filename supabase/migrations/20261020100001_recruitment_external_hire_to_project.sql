-- Tuyển dụng: bỏ luồng ứng viên (pipeline, form công khai, CV, phỏng vấn,
-- offer, bàn giao, email xác nhận). Luồng mới:
--   Trưởng phòng lập đề xuất -> HR kiểm tra -> BGĐ (Admin/CEO) phê duyệt
--   -> OPEN: Admin/CEO thêm tay nhân sự đã tuyển (đã có tài khoản) vào dự án
--   -> đủ số lượng thì đề xuất tự CLOSED.
-- Lệch SRS F01.03 (FR01.03.02-05) theo quyết định của nhóm ngày 20/10/2026.
-- Xóa hẳn dữ liệu ứng viên; file trong bucket candidate-documents đã được xóa
-- qua Storage API trước khi chạy migration này.

-- ---------------------------------------------------------------------------
-- 1. Gỡ luồng ứng viên
-- ---------------------------------------------------------------------------
drop policy if exists candidate_documents_storage_admin on storage.objects;
drop policy if exists candidate_documents_public_cv_upload on storage.objects;
drop policy if exists candidate_documents_storage_owner_read on storage.objects;

drop function if exists public.submit_public_application(text, text, text, text, text, text, text);
drop function if exists public.submit_public_application(text, text, text, text, text);
drop function if exists public.public_job_posting(text);
drop function if exists public.publish_recruitment_posting(uuid);
drop function if exists public.set_recruitment_posting_open(uuid, boolean);
drop function if exists public.public_posting_accepts_cv(text);
drop function if exists public.transition_recruitment_candidate(uuid, text, text);
drop function if exists public.handoff_hired_candidate(uuid, date, text);

drop table if exists public.email_outbox;
drop table if exists public.recruitment_candidate_documents;
drop table if exists public.recruitment_interviews;
drop table if exists public.recruitment_offers;
drop table if exists public.recruitment_onboarding_handoffs;
drop table if exists public.recruitment_job_postings;
drop table if exists public.recruitment_candidates;

drop function if exists public.can_read_candidate_document(uuid);
drop function if exists public.trg_notify_new_recruitment_candidate();
drop function if exists public.trg_notify_recruitment_resubmission();
drop function if exists public.notify_recruitment_owners(uuid, text, text, text);

alter table public.recruitment_requisitions drop column if exists external_form_url;

-- ---------------------------------------------------------------------------
-- 2. Nhân sự đã tuyển, thêm thẳng vào dự án
-- ---------------------------------------------------------------------------
create table if not exists public.recruitment_requisition_hires (
  id uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references public.recruitment_requisitions(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role_code text not null references public.project_role_definitions(code),
  added_by uuid references public.profiles(id) on delete set null default auth.uid(),
  added_at timestamptz not null default now(),
  unique (requisition_id, user_id)
);
create index if not exists recruitment_requisition_hires_req_idx
  on public.recruitment_requisition_hires(requisition_id, added_at);

alter table public.recruitment_requisition_hires enable row level security;
drop policy if exists recruitment_requisition_hires_read on public.recruitment_requisition_hires;
create policy recruitment_requisition_hires_read on public.recruitment_requisition_hires for select to authenticated
  using (
    public.can('users') or public.is_admin() or user_id = auth.uid()
    or exists (
      select 1 from public.recruitment_requisitions r
      where r.id = requisition_id and (r.requested_by = auth.uid() or r.hiring_manager_id = auth.uid())
    )
  );
revoke insert, update, delete on public.recruitment_requisition_hires from anon, authenticated;
grant select on public.recruitment_requisition_hires to authenticated;

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
         case when uid = target_user then 'Bạn được thêm vào dự án' else 'Đã tuyển nhân sự cho đề xuất' end,
         case when uid = target_user then v_project_name || ' · ' || req.title
              else req.code || ' · ' || v_user_name || ' → ' || v_project_name end,
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

-- Gỡ nhân sự ghi nhầm khỏi đề xuất (không tự gỡ khỏi dự án: việc đó làm ở dự án).
create or replace function public.remove_hire(target_hire uuid)
returns void language plpgsql security definer set search_path = public as $$
declare hire public.recruitment_requisition_hires%rowtype; req_status text;
begin
  if not public.is_admin() then
    raise exception 'Chỉ Ban Giám đốc (Admin/CEO) được gỡ nhân sự đã tuyển.' using errcode = '42501';
  end if;
  select * into hire from public.recruitment_requisition_hires where id = target_hire for update;
  if not found then raise exception 'Không tìm thấy bản ghi.' using errcode = 'P0002'; end if;
  select status into req_status from public.recruitment_requisitions where id = hire.requisition_id for update;
  delete from public.recruitment_requisition_hires where id = hire.id;
  -- Đề xuất tự hoàn tất vì đủ người thì mở lại khi gỡ bớt.
  if req_status = 'CLOSED' then
    perform set_config('app.requisition_flow', 'on', true);
    update public.recruitment_requisitions set status = 'OPEN', updated_at = now() where id = hire.requisition_id;
    perform set_config('app.requisition_flow', 'off', true);
  end if;
  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, target_user_id, summary, details)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()),
    'recruitment.requisition.hire_removed', 'recruitment_requisitions', hire.requisition_id::text, hire.user_id,
    'Gỡ nhân sự khỏi đề xuất', jsonb_build_object('project_id', hire.project_id));
end;
$$;

revoke all on function public.add_hire_to_project(uuid, uuid, uuid, text) from public, anon;
revoke all on function public.remove_hire(uuid) from public, anon;
grant execute on function public.add_hire_to_project(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.remove_hire(uuid) to authenticated;

notify pgrst, 'reload schema';
