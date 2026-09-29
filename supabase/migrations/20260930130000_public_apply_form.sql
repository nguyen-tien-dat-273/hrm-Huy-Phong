-- ============================================================================
-- RC2.5 — Web form đăng tuyển công khai.
-- ----------------------------------------------------------------------------
-- BRD Huy Phong v1.0, RC2.5 (Trung bình, Giai đoạn 2):
--   "Tích hợp Link Web Form đăng tuyển công khai: dữ liệu CV ứng viên tự động
--    đổ về hệ thống, không cần nhập tay."
--
-- Đây là bề mặt DUY NHẤT của hệ thống mà người lạ chạm được, nên phần lớn file
-- này là chặn lạm dụng chứ không phải chức năng.
--
-- Bốn ranh giới, đặt ở tầng database vì giao diện công khai thì ai cũng bỏ qua
-- được bằng cách gọi thẳng API:
--
-- 1. Người ẩn danh CHỈ được INSERT, tuyệt đối không SELECT.
--    Cho đọc là biếu không toàn bộ danh sách ứng viên — tên, email, số điện
--    thoại — cho bất kỳ ai biết URL.
--
-- 2. Chỉ nộp được vào tin tuyển dụng ĐANG MỞ.
--    Không có ràng buộc này thì một requisition đã đóng từ năm ngoái vẫn nhận
--    hồ sơ, và HR không bao giờ nhìn tới.
--
-- 3. Một email chỉ nộp một lần cho mỗi tin.
--    Vừa chặn bấm nhầm hai lần, vừa chặn kịch bản spam đơn giản nhất.
--
-- 4. Ứng viên tự nộp luôn vào giai đoạn APPLIED và nguồn WEB_FORM.
--    Không cho người ngoài tự đặt mình vào vòng phỏng vấn.
-- ============================================================================

-- Mã công khai để dựng link, thay vì phơi UUID nội bộ ra ngoài.
alter table public.recruitment_job_postings
  add column if not exists public_code text unique,
  add column if not exists accepts_applications boolean not null default false;

comment on column public.recruitment_job_postings.public_code is
  'Mã trong link công khai /tuyen-dung/<mã>. Để trống là không có trang công khai.';
comment on column public.recruitment_job_postings.accepts_applications is
  'Có nhận hồ sơ qua form công khai không. Tắt để đóng form mà vẫn giữ tin.';

-- ---------------------------------------------------------------------------
-- Thông tin công khai của một tin tuyển dụng
-- ---------------------------------------------------------------------------
-- Hàm riêng thay vì mở RLS đọc trên bảng: cách này lộ ĐÚNG những trường cần
-- cho trang ứng tuyển, không lộ chi phí đăng tin, người tạo hay requisition.
create or replace function public.public_job_posting(p_code text)
returns table (title text, is_open boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.title,
    (p.status = 'PUBLISHED' and p.accepts_applications and p.closed_at is null) as is_open
  from public.recruitment_job_postings p
  where p.public_code = p_code
  limit 1;
$$;

revoke all on function public.public_job_posting(text) from public;
grant execute on function public.public_job_posting(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Nộp hồ sơ
-- ---------------------------------------------------------------------------
-- Toàn bộ việc ghi đi qua hàm này, KHÔNG mở policy INSERT trực tiếp trên
-- `recruitment_candidates` cho anon. Lý do: bảng đó có `stage`, `note`,
-- `created_by` — mở insert thẳng là cho người lạ tự đặt giai đoạn của mình.
create or replace function public.submit_public_application(
  p_code text,
  p_full_name text,
  p_email text,
  p_phone text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_posting record;
  v_candidate_id uuid;
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
    raise exception 'Tin tuyển dụng này đã đóng, không nhận hồ sơ nữa.'
      using errcode = 'check_violation';
  end if;

  if length(trim(coalesce(p_full_name, ''))) < 2 then
    raise exception 'Vui lòng nhập họ tên.' using errcode = 'check_violation';
  end if;

  if coalesce(p_email, '') !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Email không hợp lệ.' using errcode = 'check_violation';
  end if;

  -- Một email một lần cho mỗi tin.
  if exists (
    select 1 from public.recruitment_candidates c
    where c.requisition_id = v_posting.requisition_id
      and lower(c.email) = lower(trim(p_email))
  ) then
    raise exception 'Email này đã nộp hồ sơ cho vị trí này rồi.'
      using errcode = 'unique_violation';
  end if;

  insert into public.recruitment_candidates
    (requisition_id, full_name, email, phone, source, stage, note, consent_at, created_by)
  values (
    v_posting.requisition_id,
    trim(p_full_name),
    lower(trim(p_email)),
    nullif(trim(coalesce(p_phone, '')), ''),
    'WEB_FORM',
    'APPLIED',
    nullif(trim(coalesce(p_note, '')), ''),
    now(),
    null
  )
  returning id into v_candidate_id;

  return v_candidate_id;
end;
$fn$;

revoke all on function public.submit_public_application(text, text, text, text, text) from public;
grant execute on function public.submit_public_application(text, text, text, text, text) to anon, authenticated;

comment on function public.submit_public_application(text, text, text, text, text) is
  'RC2.5 — nhận hồ sơ từ form công khai. Người ẩn danh chỉ gọi được hàm này, không đọc được bảng ứng viên.';
