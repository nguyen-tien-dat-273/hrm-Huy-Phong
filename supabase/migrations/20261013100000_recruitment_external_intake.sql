-- Nhận hồ sơ từ nền tảng form bên ngoài và lưu liên kết CV trong Kho ứng viên.
alter table public.recruitment_requisitions
  add column if not exists external_form_url text;

alter table public.recruitment_candidates
  add column if not exists cv_url text,
  add column if not exists external_submission_id text;

create unique index if not exists recruitment_candidate_external_submission_unique
  on public.recruitment_candidates(external_submission_id)
  where external_submission_id is not null;

comment on column public.recruitment_requisitions.external_form_url is
  'URL form tuyển dụng đặt trên nền tảng bên ngoài.';
comment on column public.recruitment_candidates.cv_url is
  'Liên kết CV được gửi từ nền tảng form ngoài; quyền truy cập theo chính sách lưu trữ của nguồn.';
