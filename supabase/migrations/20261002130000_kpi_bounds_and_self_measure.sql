-- Hai viec, cung mot cho vi chung deu nam o duong suy diem tu so do.
--
-- 1. BIEN MO / BIEN DONG cua moi muc tieu.
--    Bang KPI that cua khach viet "Tren 105%", "Tu 90 - 105%", "Duoi 75%".
--    Khoang hien tai luon bao gom hai dau, nen 105 roi vao CA HAI dong va he
--    thong phai doan. Voi tieu chi Cong no ("nho hon 2 lan" / "tu 2 den 3
--    lan") thi so dung bang 2 xay ra that, va no quyet dinh 4 diem hay 3.
--
--    Them hai co trong tung phan tu score_levels:
--      min_exclusive = true  ->  > min   thay vi  >= min
--      max_exclusive = true  ->  < max   thay vi  <= max
--    Khong co co = giu nguyen nhu cu, nen moi thang diem da khai van chay y het.
--
-- 2. SO DO CUA NHAN VIEN, tach khoi so do cua nguoi duyet.
--    Nhan vien dang phai tu quy doi ket qua thanh diem 1-4 trong dau. Cho ho
--    nhap thang con so va he thong suy diem - dung cach nguoi duyet dang lam.
--
--    KHONG dung chung cot `actual_value`: cot do co trigger suy ra
--    `manager_score`, nen nhan vien ghi vao do la tu dat diem chinh thuc cho
--    minh. Cot rieng `self_actual_value` suy ra `self_score`, hai duong khong
--    cham nhau.
--
-- Chay lai duoc nhieu lan.

-- ---------------------------------------------------------------------------
-- 1. Bien mo / bien dong
-- ---------------------------------------------------------------------------
create or replace function public.kpi_score_from_levels(
  p_levels jsonb,
  p_actual numeric
)
returns numeric
language plpgsql
immutable
set search_path = public
as $fn$
declare
  v_level jsonb;
  v_min numeric;
  v_max numeric;
  v_min_exc boolean;
  v_max_exc boolean;
begin
  if p_actual is null or p_levels is null or jsonb_typeof(p_levels) <> 'array' then
    return null;
  end if;

  -- Duyet theo dung thu tu khai va lay muc KHOP DAU TIEN. Thu tu la quy tac
  -- phan xu khi nguoi dung khai hai muc chong nhau: muc khai truoc thang, thay
  -- vi tra ve mot ket qua tuy tam trang cua bo toi uu.
  for v_level in select * from jsonb_array_elements(p_levels)
  loop
    v_min := nullif(v_level ->> 'min', '')::numeric;
    v_max := nullif(v_level ->> 'max', '')::numeric;
    v_min_exc := coalesce((v_level ->> 'min_exclusive')::boolean, false);
    v_max_exc := coalesce((v_level ->> 'max_exclusive')::boolean, false);

    -- Muc mo ta thuan, khong co nguong nao: bo qua khi tu cham.
    continue when v_min is null and v_max is null;

    if (v_min is null
        or (v_min_exc and p_actual > v_min)
        or (not v_min_exc and p_actual >= v_min))
       and (v_max is null
        or (v_max_exc and p_actual < v_max)
        or (not v_max_exc and p_actual <= v_max)) then
      return nullif(v_level ->> 'score', '')::numeric;
    end if;
  end loop;

  -- Khong muc nao khop: tra NULL chu KHONG tra 0. So do roi ngoai moi khoang
  -- la dau hieu thang diem khai thieu, va im lang cho 0 diem se tru oan tien
  -- luong cua nguoi bi cham.
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 2. So do cua nhan vien
-- ---------------------------------------------------------------------------
alter table public.performance_review_scores
  add column if not exists self_actual_value numeric,
  add column if not exists self_auto_scored boolean not null default false;

comment on column public.performance_review_scores.self_actual_value is
  'Ket qua thuc te do NHAN VIEN nhap. Suy ra self_score. Khac actual_value cua nguoi duyet.';

-- Suy self_score tu self_actual_value, dung bo muc tieu cua tieu chi.
create or replace function public.auto_score_kpi_self()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_levels jsonb;
  v_max_score numeric;
  v_score numeric;
begin
  if new.self_actual_value is null then
    new.self_auto_scored := false;
    return new;
  end if;

  select c.score_levels, c.max_score
    into v_levels, v_max_score
  from public.kpi_template_criteria c
  where c.id = new.criteria_id;

  v_score := public.kpi_score_from_levels(v_levels, new.self_actual_value);

  -- So do roi ngoai moi muc tieu: de diem TRONG chu khong cho 0. Thang khai
  -- thieu la loi cua nguoi khai, khong phai cua nguoi bi cham.
  if v_score is null then
    new.self_auto_scored := false;
    return new;
  end if;

  -- Kep trong thang cua tieu chi: muc tieu khai nham 5 diem tren thang 4 thi
  -- khong de no chay thang vao phieu.
  if v_max_score is not null and v_score > v_max_score then
    v_score := v_max_score;
  end if;

  new.self_score := v_score;
  new.self_auto_scored := true;
  return new;
end;
$fn$;

drop trigger if exists performance_review_scores_auto_self on public.performance_review_scores;
create trigger performance_review_scores_auto_self
before insert or update of self_actual_value on public.performance_review_scores
for each row execute function public.auto_score_kpi_self();

-- ---------------------------------------------------------------------------
-- 3. Hang rao cot: nhan vien duoc ghi so do CUA MINH, khong duoc ghi so do
--    cua nguoi duyet
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
    if new.self_score is distinct from old.self_score
       or new.self_actual_value is distinct from old.self_actual_value then
      raise exception 'Chi nguoi duoc cham moi sua duoc phan tu cham.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  -- Nguoi duoc cham: CHI duoc sua phan tu cham cua minh, va chi khi chua gui.
  if auth.uid() = v_user then
    if new.manager_score is distinct from old.manager_score then
      raise exception 'Diem nay do quan ly cham, ban khong sua duoc.'
        using errcode = 'insufficient_privilege';
    end if;
    -- `actual_value` co trigger suy ra manager_score, nen ghi duoc vao do la
    -- tu dat diem chinh thuc cho minh. So do cua nhan vien di duong rieng.
    if new.actual_value is distinct from old.actual_value then
      raise exception 'So do nay do quan ly nhap, ban khong sua duoc.'
        using errcode = 'insufficient_privilege';
    end if;
    if new.not_applicable is distinct from old.not_applicable
       or new.not_applicable_reason is distinct from old.not_applicable_reason then
      raise exception 'Chi quan ly moi danh dau tieu chi khong phat sinh.'
        using errcode = 'insufficient_privilege';
    end if;
    if v_self_submitted is not null
       and (new.self_score is distinct from old.self_score
            or new.self_actual_value is distinct from old.self_actual_value) then
      raise exception 'Ban da gui ban tu cham roi. Nho quan ly tra ve neu can sua.'
        using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  raise exception 'Khong co quyen sua diem cua phieu nay.'
    using errcode = 'insufficient_privilege';
end;
$fn$;

comment on function public.guard_kpi_score_columns() is
  'Nhan vien chi ghi self_score/self_actual_value; manager_score, actual_value va not_applicable danh cho nguoi cham. RLS khong loc duoc theo cot nen chan o day.';

drop trigger if exists performance_review_scores_guard_columns on public.performance_review_scores;
create trigger performance_review_scores_guard_columns
before update on public.performance_review_scores
for each row execute function public.guard_kpi_score_columns();
