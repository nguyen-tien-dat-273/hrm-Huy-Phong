-- ============================================================================
-- Tu cham diem KPI hai cap (RC6.2) + bit lo hong sua diem quan ly cham.
-- ----------------------------------------------------------------------------
-- Tai lieu doi hai cap: nhan vien tu cham truoc, quan ly cham lai. Cot
-- `self_score` da co tu lau nhung khong man hinh nao ghi vao, nen cap mot
-- chua bao gio chay.
--
-- QUAN TRONG HON: policy UPDATE hien tai cho ca nhan vien lan quan ly sua
-- CUNG MOT DONG, va comment ngay trong migration 20260927100000 da thua nhan
-- "chua tach duoc quyen theo cot self_score/manager_score o tang RLS". Nghia
-- la nhan vien goi thang API sua duoc `manager_score` cua chinh minh - keo
-- KPI% len, va KPI% nhan voi muc luong KPI ra tien that.
--
-- RLS cua Postgres khong loc duoc theo cot trong mot policy nhu vay, nhung
-- TRIGGER thi loc duoc. Dat o day thay vi tin vao giao dien: giao dien chi
-- la mot trong nhieu duong vao.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Moc nhan vien da gui ban tu cham
-- ---------------------------------------------------------------------------
-- Thieu moc nay thi quan ly khong biet khi nao nhan vien cham xong, va nhan
-- vien khong biet minh da gui hay chua - ca hai cung nhin mot bang diem roi
-- doan.
alter table public.performance_reviews
  add column if not exists self_submitted_at timestamptz;

comment on column public.performance_reviews.self_submitted_at is
  'Luc nhan vien gui ban tu cham. Null = chua gui.';

-- ---------------------------------------------------------------------------
-- 2. Chan nguoi duoc cham sua diem cua quan ly
-- ---------------------------------------------------------------------------
create or replace function public.guard_kpi_score_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid;
  v_reviewer uuid;
  v_self_submitted timestamptz;
begin
  select r.user_id, r.reviewer_id, r.self_submitted_at
    into v_user, v_reviewer, v_self_submitted
  from public.performance_reviews r
  where r.id = new.review_id;

  -- Nguoi co quyen quan tri KPI lam gi cung duoc.
  if public.can_function('admin.performance_manage') then
    return new;
  end if;

  -- Nguoi cham (quan ly truc tiep): duoc sua diem quan ly, khong dung toi
  -- diem tu cham cua nhan vien - do la y kien cua ho, khong phai cua minh.
  if auth.uid() = v_reviewer then
    if new.self_score is distinct from old.self_score then
      raise exception 'Chi nguoi duoc cham moi sua duoc diem tu cham.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Nguoi duoc cham: CHI duoc sua diem tu cham, va chi khi chua gui.
  if auth.uid() = v_user then
    if new.manager_score is distinct from old.manager_score then
      raise exception 'Diem nay do quan ly cham, ban khong sua duoc.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.not_applicable is distinct from old.not_applicable
       or new.not_applicable_reason is distinct from old.not_applicable_reason then
      raise exception 'Chi quan ly moi danh dau tieu chi khong phat sinh.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_self_submitted is not null and new.self_score is distinct from old.self_score then
      raise exception 'Ban da gui ban tu cham roi. Nho quan ly mo lai neu can sua.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'Khong co quyen sua diem cua phieu nay.'
    using errcode = 'insufficient_privilege';
end;
$fn$;

comment on function public.guard_kpi_score_columns() is
  'Nhan vien chi ghi self_score; manager_score va not_applicable danh cho nguoi cham. RLS khong loc duoc theo cot nen chan o day.';

drop trigger if exists performance_review_scores_guard_columns on public.performance_review_scores;
create trigger performance_review_scores_guard_columns
before update on public.performance_review_scores
for each row execute function public.guard_kpi_score_columns();

-- ---------------------------------------------------------------------------
-- 3. Gui ban tu cham
-- ---------------------------------------------------------------------------
-- Dong moc bang mot ham thay vi cho UPDATE thang len performance_reviews:
-- policy update cua bang do rong hon, va day la hanh dong mot chieu - gui
-- xong thi khoa diem tu cham lai.
create or replace function public.submit_kpi_self_scores(p_review uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user uuid;
  v_locked timestamptz;
  v_submitted timestamptz;
  v_missing integer;
begin
  select r.user_id, r.locked_at, r.self_submitted_at
    into v_user, v_locked, v_submitted
  from public.performance_reviews r
  where r.id = p_review;

  if v_user is null then
    raise exception 'Khong tim thay phieu cham.';
  end if;
  if auth.uid() <> v_user then
    raise exception 'Chi nguoi duoc cham moi gui duoc ban tu cham.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_locked is not null then
    raise exception 'Ky nay da khoa, khong gui duoc nua.'
      using errcode = 'check_violation';
  end if;
  if v_submitted is not null then
    return v_submitted;
  end if;

  -- Cham thieu thi khong cho gui: mot ban tu cham bo trong mot nua khien
  -- quan ly khong biet la nhan vien danh gia thap hay quen cham.
  select count(*) into v_missing
  from public.performance_review_scores s
  join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
  where s.review_id = p_review and s.self_score is null;

  if v_missing > 0 then
    raise exception 'Con % tieu chi chua tu cham. Cham du roi hay gui.', v_missing
      using errcode = 'check_violation';
  end if;

  update public.performance_reviews
     set self_submitted_at = now(), updated_at = now()
   where id = p_review
   returning self_submitted_at into v_submitted;

  return v_submitted;
end;
$fn$;

revoke all on function public.submit_kpi_self_scores(uuid) from public;
grant execute on function public.submit_kpi_self_scores(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Quan ly mo lai ban tu cham
-- ---------------------------------------------------------------------------
create or replace function public.reopen_kpi_self_scores(p_review uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_reviewer uuid;
  v_locked timestamptz;
begin
  select r.reviewer_id, r.locked_at into v_reviewer, v_locked
  from public.performance_reviews r where r.id = p_review;

  if not public.can_function('admin.performance_manage') and auth.uid() is distinct from v_reviewer then
    raise exception 'Chi quan ly cham phieu nay moi mo lai duoc.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_locked is not null then
    raise exception 'Ky da khoa thi khong mo lai ban tu cham duoc.'
      using errcode = 'check_violation';
  end if;

  update public.performance_reviews
     set self_submitted_at = null, updated_at = now()
   where id = p_review;
end;
$fn$;

revoke all on function public.reopen_kpi_self_scores(uuid) from public;
grant execute on function public.reopen_kpi_self_scores(uuid) to authenticated;
