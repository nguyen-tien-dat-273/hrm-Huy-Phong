-- Minh chung cho KPI.
--
-- Theo user flow cua khach: admin dinh kem minh chung vao TIEU CHI (mo ta cai
-- gi duoc tinh la dat), con nhan vien dinh kem minh chung hoac giai trinh vao
-- DIEM TU CHAM cua minh. Nguoi duyet doi chieu hai thu do roi moi chot diem.
--
-- Thieu bang nay thi buoc "Xem bang doi chieu Diem NV + Minh chung" khong co
-- gi de doi chieu: nhan vien tu cho minh 4 diem va khong ai kiem duoc.
--
-- File nam o Storage bucket `kpi-evidence` (Private). Bang nay chi giu duong
-- dan va mo ta.
--
-- Chay lai duoc nhieu lan.

create table if not exists public.kpi_evidence (
  id uuid primary key default gen_random_uuid(),

  -- Dung MOT trong hai. Tach hai cot thay vi mot cot chung kem cot "loai" vi
  -- khoa ngoai moi la thu giu cho du lieu khong tro vao khoang khong.
  criteria_id uuid references public.kpi_template_criteria(id) on delete cascade,
  score_id uuid references public.performance_review_scores(id) on delete cascade,

  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint,

  -- Giai trinh bang chu. Co the dung mot minh, khong bat buoc phai co file:
  -- nhieu tieu chi khong co gi de chup anh.
  note text,

  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint kpi_evidence_one_target check (num_nonnulls(criteria_id, score_id) = 1)
);

create index if not exists kpi_evidence_criteria_idx on public.kpi_evidence(criteria_id);
create index if not exists kpi_evidence_score_idx on public.kpi_evidence(score_id);

alter table public.kpi_evidence enable row level security;

-- Doc.
--
-- Minh chung cua TIEU CHI la mo ta cua bo KPI, ai bi cham bang bo do cung can
-- doc duoc -> mo cho moi nguoi dang nhap.
--
-- Minh chung cua DIEM thi rieng tu: chinh chu, nguoi quan ly ho, va nguoi co
-- quyen bao cao.
drop policy if exists kpi_evidence_read on public.kpi_evidence;
create policy kpi_evidence_read on public.kpi_evidence for select to authenticated
using (
  criteria_id is not null
  or exists (
    select 1
    from public.performance_review_scores s
    join public.performance_reviews r on r.id = s.review_id
    where s.id = kpi_evidence.score_id
      and (
        r.user_id = auth.uid()
        or public.is_admin()
        or public.can('reports')
        or public.manages_employee(r.user_id)
      )
  )
);

-- Ghi minh chung cua TIEU CHI: nguoi quan tri KPI.
drop policy if exists kpi_evidence_criteria_manage on public.kpi_evidence;
create policy kpi_evidence_criteria_manage on public.kpi_evidence for all to authenticated
using (criteria_id is not null and (public.is_admin() or public.can('reports')))
with check (criteria_id is not null and (public.is_admin() or public.can('reports')));

-- Ghi minh chung cua DIEM: chinh chu, va chi khi phieu CHUA gui duyet.
--
-- Gui roi ma con them bot duoc file la nguoi duyet doi chieu mot bo ho so
-- khac voi bo ho so luc ho mo ra xem.
drop policy if exists kpi_evidence_score_own on public.kpi_evidence;
create policy kpi_evidence_score_own on public.kpi_evidence for all to authenticated
using (
  score_id is not null and exists (
    select 1
    from public.performance_review_scores s
    join public.performance_reviews r on r.id = s.review_id
    where s.id = kpi_evidence.score_id
      and r.user_id = auth.uid()
      and r.self_submitted_at is null
      and r.locked_at is null
  )
)
with check (
  score_id is not null and exists (
    select 1
    from public.performance_review_scores s
    join public.performance_reviews r on r.id = s.review_id
    where s.id = kpi_evidence.score_id
      and r.user_id = auth.uid()
      and r.self_submitted_at is null
      and r.locked_at is null
  )
);

-- Nguoi duyet van don duoc minh chung rac sau khi phieu da gui.
drop policy if exists kpi_evidence_score_manage on public.kpi_evidence;
create policy kpi_evidence_score_manage on public.kpi_evidence for all to authenticated
using (score_id is not null and (public.is_admin() or public.can('reports')))
with check (score_id is not null and (public.is_admin() or public.can('reports')));

grant select, insert, update, delete on public.kpi_evidence to authenticated;
