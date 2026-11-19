-- ============================================================================
-- Chép cơ chế lương riêng từng người + bộ KPI cá nhân + miễn KPI từ bản Supabase Cloud cũ
-- sang nhân viên hiện có trên VPS, ghép theo TÊN (bỏ dấu, không phân biệt hoa thường).
--
-- Cách chạy (trên VPS; $1 = 0 chạy thử, 1 ghi thật):
--   1. Xuất từ Cloud ra /tmp/cloud_stage.tsv (chỉ ĐỌC):  xem tools/vps/restore-person-data-from-cloud.sh
--   2. docker exec -i supabase-db psql -X -U supabase_admin -d postgres -v apply=0 -f - < file này
--      (tệp phải nằm trong container tại /tmp/cloud_stage.tsv; script .sh làm sẵn cả hai bước)
--
-- Quy tắc:
--  * Người nào trên VPS ĐÃ có dòng cơ chế (employee_pay_items) / bộ KPI cá nhân thì KHÔNG đụng vào.
--  * Giữ nguyên id gốc (an toàn chạy lại: trùng id thì bỏ qua). created_by không còn thì để trống.
--  * Trùng tên trên Cloud: lấy hồ sơ có nhiều dòng cơ chế nhất.
--  * Một giao dịch; chạy thử in báo cáo rồi HUỶ.
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off
\pset tuples_only on
\if :{?apply}
\else
\set apply 0
\endif

begin;

create temp table _st(t text, j jsonb) on commit drop;
\copy _st from '/tmp/cloud_stage.tsv'

create function pg_temp.nn(s text) returns text language sql immutable as $f$
  select btrim(regexp_replace(lower(replace(replace(regexp_replace(normalize(coalesce(s, ''), NFD), '[̀-ͯ]', '', 'g'), 'đ', 'd'), 'Đ', 'd')), '\s+', ' ', 'g'))
$f$;

-- Hồ sơ Cloud + số dòng dữ liệu của từng người
create temp table _cloud on commit drop as
select (j->>'id')::uuid id, j->>'name' name, j->>'employee_code' code, pg_temp.nn(j->>'name') nn,
  (select count(*) from _st i where i.t = 'employee_pay_items' and i.j->>'user_id' = p.j->>'id') n_items,
  (select count(*) from _st i where i.t = 'kpi_sets' and i.j->>'user_id' = p.j->>'id') n_sets,
  (select count(*) from _st i where i.t = 'kpi_exemptions' and i.j->>'user_id' = p.j->>'id') n_ex
from _st p where p.t = 'profiles';

create temp table _map on commit drop as
select distinct on (v.id) v.id vid, v.name vname, c.id cid, c.name cname, c.code ccode, c.n_items, c.n_sets, c.n_ex,
  (select count(*) from _cloud c2 where c2.nn = c.nn and (c2.n_items + c2.n_sets + c2.n_ex) > 0) as n_dup
from public.profiles v
join _cloud c on c.nn = pg_temp.nn(v.name) and (c.n_items + c.n_sets + c.n_ex) > 0
order by v.id, c.n_items desc, c.n_sets desc;

select '== GHÉP ĐƯỢC ' || count(*) || ' / ' || (select count(*) from public.profiles) || ' hồ sơ VPS' from _map;
select '   chưa ghép: ' || p.name || ' (' || coalesce(p.employee_code, '-') || ')'
from public.profiles p where not exists (select 1 from _map m where m.vid = p.id) order by p.employee_code;
select '   trùng tên Cloud: ' || vname || ' → chọn ' || ccode || ' (' || n_items || ' dòng)' from _map where n_dup > 1;

-- ---- 1. Cơ chế lương riêng từng người --------------------------------------------------
create temp table _cnt(k text, n bigint) on commit drop;

with ins as (
  insert into public.employee_pay_items
  select (jsonb_populate_record(null::public.employee_pay_items,
      s.j || jsonb_build_object('user_id', m.vid,
        'created_by', (select p.id from public.profiles p where p.id = (s.j->>'created_by')::uuid)))).*
  from _st s join _map m on m.cid = (s.j->>'user_id')::uuid
  where s.t = 'employee_pay_items'
    and not exists (select 1 from public.employee_pay_items e where e.user_id = m.vid)
    and exists (select 1 from public.payroll_components c where c.id = (s.j->>'component_id')::uuid)
  on conflict (id) do nothing
  returning 1)
insert into _cnt select 'dòng cơ chế lương chép', count(*) from ins;

select '   bỏ qua dòng cơ chế (khoản không còn trong danh mục): ' || count(*)
from _st s join _map m on m.cid = (s.j->>'user_id')::uuid
where s.t = 'employee_pay_items' and not exists (select 1 from public.payroll_components c where c.id = (s.j->>'component_id')::uuid);

-- ---- 2. Bộ KPI cá nhân -----------------------------------------------------------------
create temp table _newset(id uuid) on commit drop;

with ins as (
  insert into public.kpi_sets
  select (jsonb_populate_record(null::public.kpi_sets,
      s.j || jsonb_build_object('user_id', m.vid, 'is_active', false,
        'unit_id', (select u.id from public.organization_units u where u.id = (s.j->>'unit_id')::uuid),
        'base_set_id', (select b.id from public.kpi_sets b where b.id = (s.j->>'base_set_id')::uuid),
        'created_by', (select p.id from public.profiles p where p.id = (s.j->>'created_by')::uuid)))).*
  from _st s join _map m on m.cid = (s.j->>'user_id')::uuid
  where s.t = 'kpi_sets'
    and not exists (select 1 from public.kpi_sets e where e.user_id = m.vid)
    and not exists (select 1 from public.kpi_sets e where e.id = (s.j->>'id')::uuid or e.code = s.j->>'code')
  returning id)
insert into _newset select id from ins;
insert into _cnt select 'bộ KPI cá nhân chép', count(*) from _newset;

with ins as (
  insert into public.kpi_set_items
  select (jsonb_populate_record(null::public.kpi_set_items, s.j)).*
  from _st s join _newset n on n.id = (s.j->>'set_id')::uuid
  where s.t = 'kpi_set_items'
  on conflict (id) do nothing
  returning 1)
insert into _cnt select 'tiêu chí KPI chép', count(*) from ins;

-- Bật lại sau khi đã có tiêu chí (trigger không cho bật bộ rỗng)
update public.kpi_sets k set is_active = true
from _st s where s.t = 'kpi_sets' and (s.j->>'id')::uuid = k.id and (s.j->>'is_active')::boolean
  and k.id in (select id from _newset);

-- ---- 3. Người không áp dụng KPI --------------------------------------------------------
with ins as (
  insert into public.kpi_exemptions(user_id, reason, created_by, created_at)
  select m.vid, s.j->>'reason', (select p.id from public.profiles p where p.id = (s.j->>'created_by')::uuid), (s.j->>'created_at')::timestamptz
  from _st s join _map m on m.cid = (s.j->>'user_id')::uuid
  where s.t = 'kpi_exemptions'
  on conflict (user_id) do nothing
  returning 1)
insert into _cnt select 'người miễn KPI chép', count(*) from ins;

select '== ' || k || ': ' || n from _cnt order by k;
select '   ' || m.vname || ': ' || (select count(*) from public.employee_pay_items e where e.user_id = m.vid) || ' dòng lương, '
  || (select count(*) from public.kpi_sets e where e.user_id = m.vid) || ' bộ KPI'
from _map m order by 1;

-- Khoá ngoại phải sạch
do $$
begin
  if exists (select 1 from public.employee_pay_items e where not exists (select 1 from public.profiles p where p.id = e.user_id)) then
    raise exception 'Có dòng cơ chế mồ côi';
  end if;
end $$;

\if :apply
commit;
select '>> ĐÃ GHI.';
\else
rollback;
select '>> CHẠY THỬ — đã HUỶ, chưa ghi gì. Thêm -v apply=1 để ghi thật.';
\endif
