-- UC-M01-009 bước 9: email xác nhận đã nhận hồ sơ cho ứng viên.
-- submit_public_application xếp thư vào email_outbox và trả mã hàng đợi; API
-- /api/recruitment-confirmation (service role, Gmail SMTP) gửi đúng 1 lần cho
-- mã đó. Ứng viên ẩn danh không đọc/ghi được email_outbox.

create table if not exists public.email_outbox (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  to_email text not null,
  candidate_id uuid references public.recruitment_candidates(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING' check (status in ('PENDING','SENDING','SENT','FAILED')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists email_outbox_to_kind_created_idx on public.email_outbox(to_email, kind, created_at desc);
alter table public.email_outbox enable row level security;
drop policy if exists email_outbox_admin_read on public.email_outbox;
create policy email_outbox_admin_read on public.email_outbox for select to authenticated
  using (public.is_admin() or public.can('users'));
revoke insert, update, delete on public.email_outbox from anon, authenticated;
grant select on public.email_outbox to authenticated;

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
  v_title text;
  v_outbox uuid;
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

  -- Email xác nhận (UC-M01-009 bước 9): xếp hàng cho chính email đã nộp,
  -- tối đa 1 thư / 10 phút / địa chỉ. API gửi thư bằng mã hàng đợi trả về.
  select r.title into v_title from public.recruitment_requisitions r where r.id = v_posting.requisition_id;
  if not exists (
    select 1 from public.email_outbox e
    where e.kind = 'recruitment_application_received' and e.to_email = v_email
      and e.created_at > now() - interval '10 minutes'
  ) then
    insert into public.email_outbox (kind, to_email, candidate_id, payload)
    values ('recruitment_application_received', v_email, v_candidate_id, jsonb_build_object(
      'full_name', trim(p_full_name),
      'job_title', coalesce((select p.title from public.recruitment_job_postings p where p.public_code = p_code), v_title),
      'cv_name', left(coalesce(nullif(trim(p_cv_name), ''), 'CV'), 255),
      'submitted_at', now()
    ))
    returning id into v_outbox;
  end if;

  -- Trả mã hàng đợi email (null nếu bị giới hạn tần suất); client không cần id ứng viên.
  return v_outbox;
end;
$fn$;

comment on function public.submit_public_application(text, text, text, text, text, text, text) is
  'UC-M01-009 - nhận hồ sơ + CV từ form công khai HRM; BR-006 gắn CV vào hồ sơ cũ; trả mã email_outbox để gửi email xác nhận.';

notify pgrst, 'reload schema';
