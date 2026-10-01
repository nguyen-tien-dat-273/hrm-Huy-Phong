-- ============================================================================
-- Cach tinh diem chuyen tu cap BO KPI xuong cap TUNG TIEU CHI.
-- ----------------------------------------------------------------------------
-- Truoc day `score_method` nam tren `kpi_position_templates`, tuc la ca bo
-- KPI dung chung mot cach cong diem. Thuc te mot bo thuong tron nhieu loai
-- tieu chi khac han nhau:
--
--   "Doanh so thang"        -> quy ve % theo thang roi nhan trong so
--   "So lan giao hang sai"  -> dem so lan, cang it cang tot
--   "Tuan thu quy trinh"    -> cham theo muc 4/3/2/1
--
-- Ep chung mot cach tinh thi hoac phai tach lam ba bo KPI, hoac phai bop
-- tieu chi cho vua cach tinh - ca hai deu la lam meo nghiep vu de chieu long
-- cau truc du lieu.
--
-- Them `score_method` vao tieu chi; cot tren bo KPI GIU LAI lam mac dinh cho
-- tieu chi chua khai rieng, nen du lieu dang co khong doi ket qua.
-- ============================================================================

alter table public.kpi_template_criteria
  add column if not exists score_method text;

alter table public.kpi_template_criteria
  add column if not exists description text;

comment on column public.kpi_template_criteria.score_method is
  'Cach tinh rieng cua tieu chi. Null = theo cach tinh cua ca bo KPI.';
comment on column public.kpi_template_criteria.description is
  'Mo ta tieu chi: do cai gi, lay so o dau, the nao la dat.';

-- Khoa ngoai dat SAU khi cot ton tai, va xoa ban cu truoc vi `add constraint`
-- khong idempotent.
alter table public.kpi_template_criteria
  drop constraint if exists kpi_template_criteria_score_method_fk;
alter table public.kpi_template_criteria
  add constraint kpi_template_criteria_score_method_fk
  foreign key (score_method) references public.kpi_score_methods(code)
  on update cascade on delete restrict;

-- ---------------------------------------------------------------------------
-- Tinh lai ket qua theo cach tinh CUA TUNG TIEU CHI
-- ---------------------------------------------------------------------------
-- Moi tieu chi tu quy diem cua no theo bon tham so cua chinh no, roi tat ca
-- cong lai. Mau so va he so van lay theo cach tinh cua BO: chung mo ta phep
-- gop cuoi cung, khong phai phep quy tung tieu chi.
create or replace function public.recalc_kpi_review()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_review_id uuid;
  v_template_id uuid;
  v_cap numeric;
  v_floor numeric;
  v_normalize text;
  v_weight_mode text;
  v_denominator_mode text;
  v_scale numeric;
  v_numerator numeric;
  v_denominator numeric;
  v_pct numeric;
  v_total_weight numeric;
  v_live_weight numeric;
  v_ratio numeric;
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

  select t.result_cap_percent, t.result_floor_percent,
         m.normalize_mode, m.weight_mode, m.denominator_mode, m.scale
    into v_cap, v_floor, v_normalize, v_weight_mode, v_denominator_mode, v_scale
  from public.kpi_position_templates t
  left join public.kpi_score_methods m on m.code = t.score_method
  where t.id = v_template_id;

  if v_normalize is null then
    v_normalize := 'RATIO';
    v_weight_mode := 'WEIGHTED';
    v_denominator_mode := 'NONE';
    v_scale := 1;
  end if;

  -- Ty trong HIEU LUC: tieu chi khong phat sinh nhuong ty trong cho phan con
  -- lai thay vi bi tinh 0 diem (BRD 6.6.2).
  select sum(c.weight_percent),
         sum(c.weight_percent) filter (where not s.not_applicable)
    into v_total_weight, v_live_weight
  from public.performance_review_scores s
  join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
  where s.review_id = v_review_id;

  if coalesce(v_live_weight, 0) <= 0 then
    v_pct := 0;
  else
    v_ratio := v_total_weight / v_live_weight;

    -- `coalesce(cm.*, v_*)`: tieu chi chua khai cach tinh rieng thi dung cach
    -- tinh cua bo, nen du lieu cu ra dung con so nhu truoc migration nay.
    select
      sum(
        case when coalesce(cm.normalize_mode, v_normalize) = 'RATIO'
             then coalesce(s.manager_score, 0) / c.max_score
             else coalesce(s.manager_score, 0)
        end
        * case when coalesce(cm.weight_mode, v_weight_mode) = 'WEIGHTED'
               then c.weight_percent * v_ratio
               else 1
          end
      ),
      case v_denominator_mode
        when 'WEIGHT_SUM' then sum(c.weight_percent * v_ratio)
        when 'MAX_SUM' then sum(
          c.max_score * case when coalesce(cm.weight_mode, v_weight_mode) = 'WEIGHTED'
                             then c.weight_percent * v_ratio else 1 end
        )
        else 1
      end
      into v_numerator, v_denominator
    from public.performance_review_scores s
    join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
    left join public.kpi_score_methods cm on cm.code = c.score_method
    where s.review_id = v_review_id and not s.not_applicable;

    if coalesce(v_denominator, 0) = 0 then
      v_pct := 0;
    else
      v_pct := round((coalesce(v_numerator, 0) / v_denominator * v_scale)::numeric, 2);
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

  -- AFTER trigger: gia tri tra ve bi Postgres bo qua.
  return null;
end;
$fn$;
