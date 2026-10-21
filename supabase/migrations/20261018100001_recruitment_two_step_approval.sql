-- BR-005 / UC-M01-007: đề xuất tuyển dụng duyệt 2 bước.
--   SUBMITTED (chờ HR kiểm tra, hạn 24 giờ) --HR trình--> PENDING_BOARD
--   PENDING_BOARD --BGĐ--> APPROVED | REJECTED | RETURNED
--   SUBMITTED --HR trả về--> RETURNED --người lập sửa & gửi lại--> SUBMITTED
-- BGĐ = Admin/CEO (is_admin). Tệp đề xuất (.pdf/.doc/.docx ≤ 20MB) bắt buộc.

alter table public.recruitment_requisitions
  drop constraint if exists recruitment_requisitions_status_check;
alter table public.recruitment_requisitions
  add constraint recruitment_requisitions_status_check
  check (status in ('DRAFT','SUBMITTED','PENDING_BOARD','RETURNED','APPROVED','REJECTED','OPEN','CLOSED','CANCELLED'));

alter table public.recruitment_requisitions
  add column if not exists attachment_path text,
  add column if not exists attachment_name text,
  add column if not exists hr_reviewed_by uuid references public.profiles(id) on delete set null,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists hr_note text;

-- ---------------------------------------------------------------------------
-- Tệp đề xuất: requisition-files/<người lập>/<uuid>.<pdf|doc|docx>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('requisition-files', 'requisition-files', false, 20971520, array[
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists requisition_files_insert on storage.objects;
create policy requisition_files_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'requisition-files'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~* '\.(pdf|doc|docx)$'
    and (public.can('projects') or public.can('users'))
  );

drop policy if exists requisition_files_read on storage.objects;
create policy requisition_files_read on storage.objects for select to authenticated
  using (
    bucket_id = 'requisition-files'
    and (
      public.can('users') or public.is_admin()
      or exists (
        select 1 from public.recruitment_requisitions r
        where r.attachment_path = storage.objects.name
          and (r.requested_by = auth.uid() or r.hiring_manager_id = auth.uid())
      )
    )
  );

-- Tệp phải do chính người lập tải lên đúng thư mục của mình.
create or replace function public.requisition_attachment_valid(p_path text, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_path is not null
    and (storage.foldername(p_path))[1] = p_owner::text
    and p_path ~* '\.(pdf|doc|docx)$'
    and exists (select 1 from storage.objects o where o.bucket_id = 'requisition-files' and o.name = p_path);
$$;
revoke all on function public.requisition_attachment_valid(text, uuid) from public, anon;
grant execute on function public.requisition_attachment_valid(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Chặn đi tắt: trạng thái duyệt chỉ đổi qua các RPC bên dưới.
-- Đổi trực tiếp chỉ còn APPROVED->OPEN, OPEN->CLOSED và hủy (CANCELLED).
-- ---------------------------------------------------------------------------
create or replace function public.guard_requisition_changes()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'SUBMITTED' and auth.uid() is not null
       and not public.requisition_attachment_valid(new.attachment_path, new.requested_by) then
      raise exception 'Cần đính kèm tệp đề xuất (.pdf/.doc/.docx) theo mẫu Huy Phong.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.status is distinct from old.status
     and coalesce(current_setting('app.requisition_flow', true), '') <> 'on'
     and auth.uid() is not null
     and not (
       (old.status = 'APPROVED' and new.status = 'OPEN')
       or (old.status = 'OPEN' and new.status = 'CLOSED')
       or new.status = 'CANCELLED'
     ) then
    raise exception 'Trạng thái đề xuất chỉ đổi qua bước HR kiểm tra / BGĐ phê duyệt.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists recruitment_requisition_guard on public.recruitment_requisitions;
create trigger recruitment_requisition_guard
before insert or update on public.recruitment_requisitions
for each row execute function public.guard_requisition_changes();

-- ---------------------------------------------------------------------------
-- Bước 1: HR kiểm tra -> trình BGĐ hoặc trả về
-- ---------------------------------------------------------------------------
create or replace function public.hr_review_requisition(target_id uuid, decision text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare req public.recruitment_requisitions%rowtype;
begin
  if not public.can('users') then raise exception 'Chỉ HR được kiểm tra đề xuất tuyển dụng.' using errcode = '42501'; end if;
  if decision not in ('FORWARD', 'RETURN') then raise exception 'Quyết định không hợp lệ.' using errcode = '23514'; end if;
  if decision = 'RETURN' and length(trim(coalesce(note, ''))) < 5 then
    raise exception 'Trả về phải ghi rõ nội dung cần điều chỉnh (ít nhất 5 ký tự).' using errcode = '23514';
  end if;
  select * into req from public.recruitment_requisitions where id = target_id for update;
  if not found then raise exception 'Không tìm thấy đề xuất.' using errcode = 'P0002'; end if;
  if req.status <> 'SUBMITTED' then raise exception 'Đề xuất không ở bước chờ HR kiểm tra.' using errcode = '55000'; end if;

  perform set_config('app.requisition_flow', 'on', true);
  update public.recruitment_requisitions
  set status = case when decision = 'FORWARD' then 'PENDING_BOARD' else 'RETURNED' end,
      hr_reviewed_by = auth.uid(), hr_reviewed_at = now(), hr_note = nullif(trim(note), ''),
      review_note = case when decision = 'RETURN' then trim(note) else review_note end,
      updated_at = now()
  where id = req.id;
  perform set_config('app.requisition_flow', 'off', true);

  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, summary, details)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()),
    'recruitment.requisition.hr_' || lower(decision), 'recruitment_requisitions', req.id::text,
    req.code || ' · ' || case when decision = 'FORWARD' then 'HR trình BGĐ' else 'HR trả về điều chỉnh' end,
    jsonb_build_object('note', note, 'from', req.status));
end;
$$;

-- ---------------------------------------------------------------------------
-- Bước 2: BGĐ (Admin/CEO) phê duyệt / không phê duyệt / trả về
-- ---------------------------------------------------------------------------
create or replace function public.board_review_requisition(target_id uuid, decision text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare req public.recruitment_requisitions%rowtype;
begin
  if not public.is_admin() then raise exception 'Chỉ Ban Giám đốc (Admin/CEO) được phê duyệt đề xuất tuyển dụng.' using errcode = '42501'; end if;
  if decision not in ('APPROVED', 'REJECTED', 'RETURNED') then raise exception 'Quyết định không hợp lệ.' using errcode = '23514'; end if;
  if decision <> 'APPROVED' and length(trim(coalesce(note, ''))) < 5 then
    raise exception 'Không phê duyệt hoặc trả về phải ghi lý do (ít nhất 5 ký tự).' using errcode = '23514';
  end if;
  select * into req from public.recruitment_requisitions where id = target_id for update;
  if not found then raise exception 'Không tìm thấy đề xuất.' using errcode = 'P0002'; end if;
  if req.status <> 'PENDING_BOARD' then raise exception 'Đề xuất chưa được HR trình hoặc đã xử lý.' using errcode = '55000'; end if;

  perform set_config('app.requisition_flow', 'on', true);
  update public.recruitment_requisitions
  set status = decision, reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(trim(note), ''), updated_at = now()
  where id = req.id;
  perform set_config('app.requisition_flow', 'off', true);

  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, summary, details)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()),
    'recruitment.requisition.board_' || lower(decision), 'recruitment_requisitions', req.id::text,
    req.code || ' · BGĐ ' || case decision when 'APPROVED' then 'phê duyệt' when 'REJECTED' then 'không phê duyệt' else 'trả về điều chỉnh' end,
    jsonb_build_object('note', note));
end;
$$;

-- ---------------------------------------------------------------------------
-- Người lập sửa & gửi lại sau khi bị trả về
-- ---------------------------------------------------------------------------
create or replace function public.resubmit_requisition(
  target_id uuid, p_title text, p_headcount integer, p_reason text,
  p_salary_min numeric default null, p_salary_max numeric default null, p_desired_start_date date default null,
  p_attachment_path text default null, p_attachment_name text default null
)
returns void language plpgsql security definer set search_path = public as $$
declare req public.recruitment_requisitions%rowtype; v_path text; v_name text;
begin
  select * into req from public.recruitment_requisitions where id = target_id for update;
  if not found then raise exception 'Không tìm thấy đề xuất.' using errcode = 'P0002'; end if;
  if req.requested_by is distinct from auth.uid() then raise exception 'Chỉ người lập đề xuất được gửi lại.' using errcode = '42501'; end if;
  if req.status <> 'RETURNED' then raise exception 'Chỉ gửi lại đề xuất đang bị trả về.' using errcode = '55000'; end if;
  v_path := coalesce(nullif(p_attachment_path, ''), req.attachment_path);
  v_name := coalesce(nullif(p_attachment_name, ''), req.attachment_name);
  if not public.requisition_attachment_valid(v_path, auth.uid()) then
    raise exception 'Cần đính kèm tệp đề xuất (.pdf/.doc/.docx) theo mẫu Huy Phong.' using errcode = '23514';
  end if;

  perform set_config('app.requisition_flow', 'on', true);
  update public.recruitment_requisitions
  set title = trim(p_title), headcount = p_headcount, reason = trim(p_reason),
      salary_min = p_salary_min, salary_max = p_salary_max, desired_start_date = p_desired_start_date,
      attachment_path = v_path, attachment_name = v_name,
      status = 'SUBMITTED', submitted_at = now(), review_due_at = now() + interval '24 hours',
      hr_reviewed_by = null, hr_reviewed_at = null, hr_note = null,
      reviewed_by = null, reviewed_at = null, updated_at = now()
  where id = req.id;
  perform set_config('app.requisition_flow', 'off', true);

  insert into public.audit_logs(actor_id, actor_name, action, entity_type, entity_id, summary, details)
  values (auth.uid(), (select name from public.profiles where id = auth.uid()),
    'recruitment.requisition.resubmit', 'recruitment_requisitions', req.id::text,
    req.code || ' · gửi lại sau điều chỉnh', jsonb_build_object('previous_note', req.review_note));
end;
$$;

-- Hàm 1 bước cũ (client cũ): chỉ còn là BGĐ duyệt ở bước PENDING_BOARD.
create or replace function public.review_recruitment_requisition(target_id uuid, decision text, note text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.board_review_requisition(target_id, decision, note);
end;
$$;

revoke all on function public.hr_review_requisition(uuid, text, text) from public, anon;
revoke all on function public.board_review_requisition(uuid, text, text) from public, anon;
revoke all on function public.resubmit_requisition(uuid, text, integer, text, numeric, numeric, date, text, text) from public, anon;
grant execute on function public.hr_review_requisition(uuid, text, text) to authenticated;
grant execute on function public.board_review_requisition(uuid, text, text) to authenticated;
grant execute on function public.resubmit_requisition(uuid, text, integer, text, numeric, numeric, date, text, text) to authenticated;

notify pgrst, 'reload schema';
