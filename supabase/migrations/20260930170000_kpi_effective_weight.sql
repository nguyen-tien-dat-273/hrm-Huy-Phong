-- ============================================================================
-- Tỷ trọng HIỆU LỰC và điểm vượt chuẩn, theo đúng công thức Huy Phong.
-- ----------------------------------------------------------------------------
-- BRD Mục 6.6.2, khối Văn phòng:
--   Điểm tiêu chí = (Điểm đạt / Điểm chuẩn) x Tỷ trọng HIỆU LỰC
--   KPI%          = min( Tong Diem tieu chi + Thuong trong diem ; 120% )
--
-- Hai quy tắc trong bảng "Cách áp dụng" mà hệ thống đang làm sai:
--
-- 1. KHÔNG PHÁT SINH - "Tỷ trọng chia lại cho các tiêu chí còn lại cùng hạng
--    mục; QL xác nhận kèm lý do."
--    Ví dụ trong tài liệu: nhân viên nhập khẩu, tháng không có tham vấn giá.
--
--    Hệ thống đang dùng `weight_percent` TĨNH, nên tiêu chí không phát sinh bị
--    tính 0 điểm và kéo tụt KPI của người KHÔNG có lỗi gì. Đây là tính SAI,
--    không phải thiếu tính năng - và nó trừ vào tiền lương thật.
--
-- 2. ĐIỂM VƯỢT CHUẨN - "Chỉ ở tiêu chí được bật và có mô tả mức; tổng KPI tối
--    đa 120%." Ví dụ: KTT chấm 4,5/4.
--
--    Hệ thống đang KẸP điểm ở `max_score`, nên không chấm vượt được. Trần thật
--    nằm ở tổng KPI (120%), không nằm ở từng tiêu chí.
-- ============================================================================

alter table public.performance_review_scores
  -- Tiêu chí tháng này không phát sinh. Tỷ trọng của nó chia lại cho các tiêu
  -- chí còn lại, không tính thành 0 điểm.
  add column if not exists not_applicable boolean not null default false,
  -- BRD đòi "QL xác nhận kèm lý do" - không cho tắt một tiêu chí mà không nói
  -- vì sao, vì việc đó làm tăng KPI của người được tắt.
  add column if not exists not_applicable_reason text;

alter table public.performance_review_scores
  drop constraint if exists review_score_na_needs_reason;
alter table public.performance_review_scores
  add constraint review_score_na_needs_reason
  check (not not_applicable or nullif(trim(coalesce(not_applicable_reason, '')), '') is not null);

comment on column public.performance_review_scores.not_applicable is
  'Tháng này tiêu chí không phát sinh. Tỷ trọng chia lại cho các tiêu chí còn lại (BRD 6.6.2).';

alter table public.kpi_template_criteria
  -- Tiêu chí có được chấm vượt điểm chuẩn hay không. Mặc định KHÔNG: BRD ghi
  -- "chỉ ở tiêu chí được bật và có mô tả mức".
  add column if not exists allow_over_standard boolean not null default false;

comment on column public.kpi_template_criteria.allow_over_standard is
  'Cho chấm vượt điểm chuẩn (vd 4,5/4). Trần thật nằm ở tổng KPI, không ở tiêu chí.';

-- ---------------------------------------------------------------------------
-- Tính lại theo tỷ trọng hiệu lực
-- ---------------------------------------------------------------------------
create or replace function public.recalc_kpi_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_review_id uuid;
  v_template_id uuid;
  v_method text;
  v_cap numeric;
  v_floor numeric;
  v_pct numeric;
  v_total_weight numeric;
  v_live_weight numeric;
begin
  if tg_op = 'DELETE' then
    v_review_id := old.review_id;
  else
    v_review_id := new.review_id;
  end if;

  select template_id into v_template_id
    from public.performance_reviews where id = v_review_id;

  if v_template_id is null then
    return null;
  end if;

  select score_method, result_cap_percent, result_floor_percent
    into v_method, v_cap, v_floor
  from public.kpi_position_templates
  where id = v_template_id;

  if v_method = 'TOTAL_POINTS' then
    -- Tổng điểm trên tổng thang. Tiêu chí không phát sinh bị loại khỏi CẢ tử
    -- số lẫn mẫu số, nếu không thì nó vẫn kéo tụt kết quả qua đường mẫu số.
    select case
             when sum(c.max_score) > 0
               then round((sum(coalesce(s.manager_score, 0)) / sum(c.max_score) * 100)::numeric, 2)
             else 0
           end
      into v_pct
    from public.performance_review_scores s
    join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
    where s.review_id = v_review_id and not s.not_applicable;
  else
    -- Tỷ trọng HIỆU LỰC: tổng tỷ trọng của mọi tiêu chí đang hiệu lực, chia
    -- lại cho phần còn sống. Tiêu chí bị tắt "không phát sinh" nhường tỷ trọng
    -- của mình cho các tiêu chí khác thay vì biến thành 0 điểm.
    select
      sum(c.weight_percent),
      sum(c.weight_percent) filter (where not s.not_applicable)
      into v_total_weight, v_live_weight
    from public.performance_review_scores s
    join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
    where s.review_id = v_review_id;

    if coalesce(v_live_weight, 0) <= 0 then
      -- Mọi tiêu chí đều không phát sinh: không có căn cứ nào để chấm.
      v_pct := 0;
    else
      select round(sum(
               coalesce(s.manager_score, 0) / c.max_score
               * (c.weight_percent * v_total_weight / v_live_weight)
             )::numeric, 2)
        into v_pct
      from public.performance_review_scores s
      join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
      where s.review_id = v_review_id and not s.not_applicable;
    end if;
  end if;

  v_pct := coalesce(v_pct, 0);
  v_pct := greatest(v_pct, coalesce(v_floor, 0));
  if v_cap is not null then
    v_pct := least(v_pct, v_cap);
  end if;

  update public.performance_reviews
    set final_pct = v_pct,
        rating = public.compute_kpi_rating(v_pct, v_template_id),
        updated_at = now()
    where id = v_review_id;

  -- AFTER trigger: giá trị trả về bị Postgres bỏ qua.
  return null;
end;
$fn$;

-- Tính lại khi ai đó bật/tắt "không phát sinh", không chỉ khi đổi điểm.
drop trigger if exists performance_review_scores_recalc on public.performance_review_scores;
create trigger performance_review_scores_recalc
  after insert or update or delete on public.performance_review_scores
  for each row execute function public.recalc_kpi_review();

-- ---------------------------------------------------------------------------
-- Cho phép điểm vượt chuẩn ở tiêu chí được bật
-- ---------------------------------------------------------------------------
create or replace function public.auto_score_kpi_criteria()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_levels jsonb;
  v_max_score numeric;
  v_allow_over boolean;
  v_score numeric;
begin
  if new.actual_value is null then
    new.auto_scored := false;
    return new;
  end if;

  select c.score_levels, c.max_score, c.allow_over_standard
    into v_levels, v_max_score, v_allow_over
  from public.kpi_template_criteria c
  where c.id = new.criteria_id;

  v_score := public.kpi_score_from_levels(v_levels, new.actual_value);

  if v_score is null then
    new.auto_scored := false;
    return new;
  end if;

  -- Kẹp trần CHỈ khi tiêu chí không cho vượt chuẩn. Trần thật của công thức
  -- nằm ở tổng KPI (120%), không ở từng tiêu chí.
  new.manager_score := case
    when v_allow_over then greatest(v_score, 0)
    else least(greatest(v_score, 0), v_max_score)
  end;
  new.auto_scored := true;
  new.scored_manager_at := now();
  return new;
end;
$fn$;
