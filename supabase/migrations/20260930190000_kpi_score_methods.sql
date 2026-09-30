-- ============================================================================
-- Danh mục CÁCH TÍNH KẾT QUẢ KPI.
-- ----------------------------------------------------------------------------
-- `score_method` đang là một chuỗi bị CHECK khoá cứng hai giá trị. Công ty có
-- cách chấm thứ ba là phải sửa code và deploy - đúng thứ vừa gỡ bỏ ở Khối
-- nghiệp vụ và biểu thuế.
--
-- KHÔNG dùng công thức tự do như khoản lương: phép gộp KPI chạy trong PL/pgSQL,
-- nhúng một bộ đánh giá biểu thức vào đó vừa lớn vừa mở thêm một bề mặt tấn
-- công. Thay vào đó tách cách tính thành BỐN THAM SỐ - hai cách đang có chỉ là
-- hai điểm trong không gian đó:
--
--   Quy đổi điểm : RATIO (điểm / thang)  hoặc RAW (điểm thô)
--   Trọng số     : WEIGHTED (nhân)       hoặc EQUAL (bỏ qua)
--   Mẫu số       : NONE / WEIGHT_SUM / MAX_SUM
--   Hệ số        : nhân ra thang phần trăm
--
--   Trung binh co trong so = RATIO + WEIGHTED + NONE      + he so 1
--   Tong diem / tong thang = RAW   + EQUAL    + MAX_SUM   + he so 100
--
-- Khai cách mới chỉ là chọn bốn ô, không viết công thức, không sửa code.
-- ============================================================================

create table if not exists public.kpi_score_methods (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]*$'),
  name text not null,
  description text,

  -- Mỗi tiêu chí quy về gì trước khi cộng.
  normalize_mode text not null default 'RATIO'
    check (normalize_mode in ('RATIO', 'RAW')),
  -- Có nhân trọng số của tiêu chí hay không.
  weight_mode text not null default 'WEIGHTED'
    check (weight_mode in ('WEIGHTED', 'EQUAL')),
  -- Chia tổng cho cái gì.
  denominator_mode text not null default 'NONE'
    check (denominator_mode in ('NONE', 'WEIGHT_SUM', 'MAX_SUM')),
  -- Nhân ra thang phần trăm.
  scale numeric(8, 4) not null default 1 check (scale > 0),

  is_system boolean not null default false,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.kpi_score_methods is
  'Danh mục cách gộp điểm tiêu chí thành KPI%. Bốn tham số thay cho công thức tự do.';

insert into public.kpi_score_methods
  (code, name, description, normalize_mode, weight_mode, denominator_mode, scale, is_system, sort_order)
values
  ('WEIGHTED_PERCENT', 'Trung bình có trọng số',
   'Mỗi tiêu chí quy về % theo thang của nó rồi nhân trọng số. Tổng trọng số phải đủ 100%.',
   'RATIO', 'WEIGHTED', 'NONE', 1, true, 10),
  ('TOTAL_POINTS', 'Tổng điểm / tổng điểm tối đa',
   'Cộng thẳng điểm các tiêu chí rồi chia tổng thang. Bỏ qua trọng số - được 17/20 điểm là 85%.',
   'RAW', 'EQUAL', 'MAX_SUM', 100, true, 20)
on conflict (code) do nothing;

alter table public.kpi_score_methods enable row level security;

drop policy if exists kpi_score_methods_read on public.kpi_score_methods;
create policy kpi_score_methods_read on public.kpi_score_methods
for select to authenticated using (true);

drop policy if exists kpi_score_methods_manage on public.kpi_score_methods;
create policy kpi_score_methods_manage on public.kpi_score_methods
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.kpi_score_methods to authenticated;

-- ---------------------------------------------------------------------------
-- Bộ KPI trỏ vào danh mục thay vì giữ chuỗi cố định
-- ---------------------------------------------------------------------------
-- Mã cách tính nào đang được dùng mà chưa có trong danh mục thì thêm nốt,
-- nếu không lệnh thêm khoá ngoại bên dưới sẽ hỏng giữa chừng.
insert into public.kpi_score_methods (code, name, sort_order)
select distinct t.score_method, t.score_method, 900
from public.kpi_position_templates t
where t.score_method is not null
  and not exists (select 1 from public.kpi_score_methods m where m.code = t.score_method)
on conflict (code) do nothing;

alter table public.kpi_position_templates
  drop constraint if exists kpi_position_templates_score_method_check;

alter table public.kpi_position_templates
  drop constraint if exists kpi_position_templates_score_method_fk;
alter table public.kpi_position_templates
  add constraint kpi_position_templates_score_method_fk
  foreign key (score_method) references public.kpi_score_methods(code)
  on update cascade on delete restrict;

-- ---------------------------------------------------------------------------
-- Tính kết quả theo bốn tham số
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

  -- Bộ chưa trỏ vào cách tính nào: dùng trung bình có trọng số, đúng mặc định
  -- cũ, thay vì trả 0 và làm mất lương của người đang chấm.
  if v_normalize is null then
    v_normalize := 'RATIO';
    v_weight_mode := 'WEIGHTED';
    v_denominator_mode := 'NONE';
    v_scale := 1;
  end if;

  -- Tỷ trọng HIỆU LỰC: tiêu chí không phát sinh nhường tỷ trọng cho phần còn
  -- lại thay vì bị tính 0 điểm (BRD 6.6.2).
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

    select
      sum(
        case when v_normalize = 'RATIO'
             then coalesce(s.manager_score, 0) / c.max_score
             else coalesce(s.manager_score, 0)
        end
        * case when v_weight_mode = 'WEIGHTED'
               then c.weight_percent * v_ratio
               else 1
          end
      ),
      case v_denominator_mode
        when 'WEIGHT_SUM' then sum(c.weight_percent * v_ratio)
        when 'MAX_SUM' then sum(
          c.max_score * case when v_weight_mode = 'WEIGHTED' then c.weight_percent * v_ratio else 1 end
        )
        else 1
      end
      into v_numerator, v_denominator
    from public.performance_review_scores s
    join public.kpi_template_criteria c on c.id = s.criteria_id and c.is_active
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

  -- AFTER trigger: giá trị trả về bị Postgres bỏ qua.
  return null;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Gán bộ KPI cho cả ĐƠN VỊ
-- ---------------------------------------------------------------------------
-- Một phòng 20 người cùng bộ KPI thì gán 20 lần, và mỗi người mới vào lại
-- phải nhớ gán lại - quên một người là người đó không chấm được mà không ai
-- thấy. Cùng vấn đề, cùng cách giải với khoản lương theo đơn vị.
--
-- Thứ tự ưu tiên khi mở phiếu chấm, từ hẹp tới rộng:
--   1. Bộ gán riêng cho người
--   2. Bộ gán cho đơn vị của người đó, hoặc đơn vị CẤP TRÊN gần nhất
--   3. Mẫu khớp vị trí
create table if not exists public.unit_kpi_schemes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.organization_units(id) on delete cascade,
  template_id uuid not null references public.kpi_position_templates(id) on delete restrict,

  effective_from date not null default current_date,
  note text,

  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (unit_id, effective_from)
);

create index if not exists unit_kpi_schemes_unit_idx
  on public.unit_kpi_schemes(unit_id, effective_from desc);

comment on table public.unit_kpi_schemes is
  'Bộ KPI áp cho cả đơn vị. Bản gán riêng từng người ghi đè bản này.';

drop trigger if exists unit_kpi_schemes_touch on public.unit_kpi_schemes;
create trigger unit_kpi_schemes_touch
before update on public.unit_kpi_schemes
for each row execute function public.touch_payroll_updated_at();

alter table public.unit_kpi_schemes enable row level security;

drop policy if exists unit_kpi_schemes_read on public.unit_kpi_schemes;
create policy unit_kpi_schemes_read on public.unit_kpi_schemes
for select to authenticated using (true);

drop policy if exists unit_kpi_schemes_manage on public.unit_kpi_schemes;
create policy unit_kpi_schemes_manage on public.unit_kpi_schemes
for all to authenticated
using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.unit_kpi_schemes to authenticated;

-- Bộ KPI đang áp cho một người, xét cả ba lớp.
create or replace function public.kpi_scheme_for(p_user uuid, p_on date default current_date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  with recursive lineage as (
    select u.id, u.parent_id, 1 as depth
    from public.organization_units u
    join public.profiles p on p.id = p_user
    where u.id = p.unit_id
    union all
    select parent.id, parent.parent_id, child.depth + 1
    from lineage child
    join public.organization_units parent on parent.id = child.parent_id
    where child.depth < 10
  )
  select coalesce(
    -- 1. Bản gán riêng cho người, hiệu lực gần nhất.
    (
      select s.template_id
      from public.employee_kpi_schemes s
      where s.user_id = p_user and s.effective_from <= p_on
      order by s.effective_from desc
      limit 1
    ),
    -- 2. Bản gán cho đơn vị, ưu tiên đơn vị GẦN nhất rồi tới cấp trên.
    (
      select s.template_id
      from public.unit_kpi_schemes s
      join lineage l on l.id = s.unit_id
      where s.effective_from <= p_on
      order by l.depth asc, s.effective_from desc
      limit 1
    ),
    -- 3. Mẫu khớp vị trí.
    (
      select t.id
      from public.kpi_position_templates t
      join public.profiles p on p.id = p_user
      where t.position_id is not null
        and t.position_id = p.position_id
        and t.is_active
      limit 1
    )
  );
$$;

comment on function public.kpi_scheme_for(uuid, date) is
  'Bộ KPI đang áp cho một người: gán riêng > gán theo đơn vị (gần nhất trước) > mẫu theo vị trí.';

revoke all on function public.kpi_scheme_for(uuid, date) from public;
grant execute on function public.kpi_scheme_for(uuid, date) to authenticated;
