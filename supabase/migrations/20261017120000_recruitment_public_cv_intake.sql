-- F01.03 / UC-M01-009: Web Form tuyển dụng HRM có CV.
-- - HR tạo link công khai từ yêu cầu đã duyệt (publish_recruitment_posting).
-- - Ứng viên ẩn danh tải CV thẳng lên Storage (chỉ INSERT, không đọc/sửa/xóa)
--   vào applications/<public_code>/..., rồi gọi submit_public_application.
-- - BR-007: CV tối đa 20MB, chỉ .pdf/.doc/.docx/ảnh.
-- - BR-006: email trùng trong cùng yêu cầu -> không tạo hồ sơ mới; gắn CV mới
--   và ghi chú "Nộp lại" vào hồ sơ cũ, KHÔNG ghi đè họ tên/SĐT (người lạ biết
--   email không được sửa hồ sơ của người khác).

-- BR-007: 20MB cho hồ sơ tuyển dụng.
update storage.buckets set file_size_limit = 20971520 where id = 'candidate-documents';
alter table public.recruitment_candidate_documents
  drop constraint if exists recruitment_candidate_documents_size_bytes_check;
alter table public.recruitment_candidate_documents
  add constraint recruitment_candidate_documents_size_bytes_check
  check (size_bytes > 0 and size_bytes <= 20971520);

-- ---------------------------------------------------------------------------
-- HR tạo / đóng link công khai
-- ---------------------------------------------------------------------------
create or replace function public.publish_recruitment_posting(target_requisition uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  req public.recruitment_requisitions%rowtype;
  v_code text;
begin
  if not public.can('users') then
    raise exception 'Không có quyền tạo link tuyển dụng.' using errcode = '42501';
  end if;
  select * into req from public.recruitment_requisitions where id = target_requisition for update;
  if not found then raise exception 'Không tìm thấy yêu cầu tuyển dụng.' using errcode = 'P0002'; end if;
  if req.status not in ('APPROVED', 'OPEN') then
    raise exception 'Chỉ tạo link cho yêu cầu đã được duyệt.' using errcode = '55000';
  end if;

  -- Mỗi yêu cầu một link HRM: gọi lại thì trả link đang có.
  select p.public_code into v_code
  from public.recruitment_job_postings p
  where p.requisition_id = req.id and p.channel = 'HRM_WEB_FORM' and p.public_code is not null
  order by p.created_at desc limit 1;

  if v_code is null then
    loop
      v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
      exit when not exists (select 1 from public.recruitment_job_postings where public_code = v_code);
    end loop;
    insert into public.recruitment_job_postings
      (requisition_id, channel, title, status, published_at, public_code, accepts_applications, created_by)
    values (req.id, 'HRM_WEB_FORM', req.title, 'PUBLISHED', now(), v_code, true, auth.uid());
  end if;

  if req.status = 'APPROVED' then
    update public.recruitment_requisitions set status = 'OPEN', updated_at = now() where id = req.id;
  end if;
  return v_code;
end;
$$;
revoke all on function public.publish_recruitment_posting(uuid) from public, anon;
grant execute on function public.publish_recruitment_posting(uuid) to authenticated;

create or replace function public.set_recruitment_posting_open(target_posting uuid, is_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can('users') then
    raise exception 'Không có quyền thay đổi link tuyển dụng.' using errcode = '42501';
  end if;
  update public.recruitment_job_postings
  set accepts_applications = is_open,
      status = case when is_open then 'PUBLISHED' else status end,
      closed_at = null
  where id = target_posting;
  if not found then raise exception 'Không tìm thấy tin tuyển dụng.' using errcode = 'P0002'; end if;
end;
$$;
revoke all on function public.set_recruitment_posting_open(uuid, boolean) from public, anon;
grant execute on function public.set_recruitment_posting_open(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Ứng viên tải CV: chỉ INSERT vào applications/<public_code>/<tên>.<đuôi hợp lệ>
-- của tin đang mở. Không có policy SELECT/UPDATE/DELETE cho anon.
-- ---------------------------------------------------------------------------
create or replace function public.public_posting_accepts_cv(object_name text)
returns boolean language sql stable security definer set search_path = public as $$
  select (storage.foldername(object_name))[1] = 'applications'
    and array_length(storage.foldername(object_name), 1) = 2
    and object_name ~* '\.(pdf|doc|docx|png|jpe?g|webp)$'
    and exists (
      select 1 from public.recruitment_job_postings p
      where p.public_code = (storage.foldername(object_name))[2]
        and p.status = 'PUBLISHED' and p.accepts_applications and p.closed_at is null
    );
$$;
revoke all on function public.public_posting_accepts_cv(text) from public;
grant execute on function public.public_posting_accepts_cv(text) to anon, authenticated;

drop policy if exists candidate_documents_public_cv_upload on storage.objects;
create policy candidate_documents_public_cv_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'candidate-documents' and public.public_posting_accepts_cv(name));

-- ---------------------------------------------------------------------------
-- Nộp hồ sơ: bắt buộc họ tên, email, SĐT, CV (UC-M01-009 bước 1).
-- ---------------------------------------------------------------------------
-- Bản 5 tham số cũ không nhận CV: giữ tên để client cũ báo lỗi rõ ràng thay
-- vì nộp hồ sơ thiếu CV.
create or replace function public.submit_public_application(
  p_code text, p_full_name text, p_email text, p_phone text, p_note text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Biểu mẫu đã được cập nhật và bắt buộc CV. Vui lòng tải lại trang rồi nộp lại.'
    using errcode = 'check_violation';
end;
$$;

create or replace function public.submit_public_application(
  p_code text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_note text,
  p_cv_path text,
  p_cv_name text
)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  v_posting record;
  v_object record;
  v_candidate_id uuid;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  select p.requisition_id, p.status, p.accepts_applications, p.closed_at
    into v_posting
  from public.recruitment_job_postings p
  where p.public_code = p_code;

  if v_posting is null then
    raise exception 'Không tìm thấy tin tuyển dụng này.' using errcode = 'no_data_found';
  end if;
  if v_posting.status <> 'PUBLISHED' or not v_posting.accepts_applications
     or v_posting.closed_at is not null then
    raise exception 'Tin tuyển dụng này đã đóng, không nhận hồ sơ nữa.' using errcode = 'check_violation';
  end if;
  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Vui lòng nhập họ tên.' using errcode = 'check_violation';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email không hợp lệ.' using errcode = 'check_violation';
  end if;
  if length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 9 then
    raise exception 'Vui lòng nhập số điện thoại hợp lệ.' using errcode = 'check_violation';
  end if;

  -- CV phải đã nằm trong thư mục của chính tin này (BR-007 do bucket + policy chặn).
  if coalesce(p_cv_path, '') = '' or p_cv_path not like 'applications/' || p_code || '/%' then
    raise exception 'Vui lòng tải CV lên trước khi nộp.' using errcode = 'check_violation';
  end if;
  select o.name, coalesce((o.metadata->>'size')::bigint, 0) as size_bytes, o.metadata->>'mimetype' as mime_type
    into v_object
  from storage.objects o
  where o.bucket_id = 'candidate-documents' and o.name = p_cv_path;
  if v_object is null or v_object.size_bytes <= 0 then
    raise exception 'Không tìm thấy CV đã tải lên. Vui lòng tải lại CV.' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.recruitment_candidate_documents d where d.storage_path = p_cv_path) then
    raise exception 'CV này đã được dùng cho một hồ sơ khác.' using errcode = 'unique_violation';
  end if;

  -- BR-006: email trùng trong cùng yêu cầu -> gắn vào hồ sơ cũ, không ghi đè thông tin.
  select c.id into v_candidate_id
  from public.recruitment_candidates c
  where c.requisition_id = v_posting.requisition_id and lower(c.email) = v_email
  order by c.created_at desc limit 1
  for update;

  if v_candidate_id is not null then
    update public.recruitment_candidates
    set note = concat_ws(E'\n', note,
          '[Nộp lại ' || to_char(now() at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YYYY HH24:MI') || ']'
          || coalesce(' ' || v_note, '')),
        updated_at = now()
    where id = v_candidate_id;
  else
    insert into public.recruitment_candidates
      (requisition_id, full_name, email, phone, source, stage, note, consent_at, created_by)
    values (
      v_posting.requisition_id, trim(p_full_name), v_email, trim(p_phone),
      'WEB_FORM', 'APPLIED', v_note, now(), null
    )
    returning id into v_candidate_id;
  end if;

  insert into public.recruitment_candidate_documents
    (candidate_id, title, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (
    v_candidate_id,
    'CV - ' || trim(p_full_name),
    p_cv_path,
    left(coalesce(nullif(trim(p_cv_name), ''), 'CV'), 255),
    v_object.mime_type,
    v_object.size_bytes,
    null
  );

  return v_candidate_id;
end;
$fn$;

revoke all on function public.submit_public_application(text, text, text, text, text) from public;
grant execute on function public.submit_public_application(text, text, text, text, text) to anon, authenticated;
revoke all on function public.submit_public_application(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_public_application(text, text, text, text, text, text, text) to anon, authenticated;

comment on function public.submit_public_application(text, text, text, text, text, text, text) is
  'UC-M01-009 - nhận hồ sơ + CV từ form công khai HRM. Email trùng cùng yêu cầu thì gắn CV vào hồ sơ cũ (BR-006).';

notify pgrst, 'reload schema';
