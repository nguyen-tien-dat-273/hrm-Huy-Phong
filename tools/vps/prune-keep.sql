-- ============================================================================
-- Thu gọn dữ liệu HRM: CHỈ GIỮ tài khoản admin/ceo + nhân viên tên "Vượng" (kèm toàn bộ
-- lịch sử của họ) + mọi cấu hình (công thức lương/công/KPI, cơ cấu tổ chức, lịch, ngày lễ,
-- máy chấm công, quy chế…). Xoá các nhân viên khác và dữ liệu phát sinh.
--
-- Chạy qua:  ./hrm.sh prune-keep            (chạy thử: báo cáo rồi HUỶ, không ghi gì)
--            ./hrm.sh prune-keep --apply    (ghi thật)
-- Trực tiếp: psql -v apply=0|1 -f prune-keep.sql   (bằng supabase_admin)
--
-- Toàn bộ trong MỘT giao dịch: lỗi ở bất kỳ bước nào → không đổi gì.
--
-- Cách xoá: tắt trigger/khoá ngoại (session_replication_role = replica) để không vướng các
-- trigger khoá kỳ công/chặn xoá, rồi TỰ lan theo khoá ngoại thật của database (đọc từ
-- pg_constraint): ON DELETE CASCADE/RESTRICT/NO ACTION → xoá dòng con mồ côi; SET NULL → đặt
-- rỗng. Lặp tới khi không còn gì. Cuối cùng kiểm KHÔNG còn dòng mồ côi nào và xác thực mọi
-- khoá ngoại — sai một chỗ là huỷ hết.
-- ============================================================================
\set ON_ERROR_STOP on
\pset footer off
\pset tuples_only on
\if :{?apply}
\else
\set apply 0
\endif

begin;

create temp table _keep on commit drop as
  select id from public.profiles
  where role in ('admin', 'ceo') or name ilike '%vượng%' or name ilike '%vuong%';

select '== GIỮ ' || (select count(*) from _keep) || ' / ' || count(*) || ' hồ sơ:' from public.profiles;
select '   ' || p.role || ' | ' || p.name || ' | ' || p.email
from public.profiles p join _keep k on k.id = p.id order by p.role, p.name;

do $$
begin
  if not exists (select 1 from _keep k join public.profiles p on p.id = k.id where p.role in ('admin', 'ceo')) then
    raise exception 'Không có tài khoản admin/ceo nào trong danh sách giữ — dừng.';
  end if;
end $$;

-- Điều kiện "dòng con mồ côi" của một khoá ngoại (MATCH SIMPLE: có cột rỗng thì không tính).
create function pg_temp.fk_orphan_cond(con oid) returns text language sql stable as $f$
  select string_agg(format('ch.%I is not null', ca.attname), ' and ' order by k.ord)
    || format(' and not exists (select 1 from %s pa where ', c.confrelid::regclass)
    || string_agg(format('pa.%I = ch.%I', pa.attname, ca.attname), ' and ' order by k.ord) || ')'
  from pg_constraint c
  cross join lateral unnest(c.conkey, c.confkey) with ordinality as k(ckey, pkey, ord)
  join pg_attribute ca on ca.attrelid = c.conrelid and ca.attnum = k.ckey
  join pg_attribute pa on pa.attrelid = c.confrelid and pa.attnum = k.pkey
  where c.oid = con
  group by c.confrelid
$f$;

create function pg_temp.fk_cols(con oid) returns text[] language sql stable as $f$
  select array_agg(a.attname::text order by k.ord)
  from pg_constraint c
  cross join lateral unnest(c.conkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.oid = con
$f$;

create function pg_temp.run_if(tbl text, sql text) returns void language plpgsql as $f$
begin
  if to_regclass('public.' || tbl) is not null then execute sql; end if;
end $f$;

create temp table _cnt(tbl text primary key, before bigint, after bigint) on commit drop;
insert into _cnt(tbl, before)
select c.relname,
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', c.relname), false, true, '')))[1]::text::bigint
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r';
create temp table _auth_before on commit drop as select count(*) as n from auth.users;

set local session_replication_role = replica;

-- ---- 1. Dữ liệu phát sinh không gắn với người được giữ --------------------------------
select pg_temp.run_if('audit_logs', 'delete from public.audit_logs');
select pg_temp.run_if('attendance_device_sync_runs', 'delete from public.attendance_device_sync_runs');
select pg_temp.run_if('attendance_device_auth_failures', 'delete from public.attendance_device_auth_failures');
select pg_temp.run_if('recruitment_requisition_hires', 'delete from public.recruitment_requisition_hires');
select pg_temp.run_if('recruitment_requisitions', 'delete from public.recruitment_requisitions');
select pg_temp.run_if('recruitment_orders', 'delete from public.recruitment_orders');
-- Lần quét thô của người khác (kể cả lần quét chưa ghép được người).
select pg_temp.run_if('attendance_device_events',
  'delete from public.attendance_device_events where profile_id is null or profile_id not in (select id from _keep)');
select pg_temp.run_if('kpi_logs',
  'delete from public.kpi_logs where user_id is null or user_id not in (select id from _keep)');
-- Bộ KPI CÁ NHÂN của người không giữ: phải xoá hẳn. Nếu chỉ đặt user_id rỗng (như khoá ngoại
-- SET NULL) thì bộ đó biến thành "bộ mẫu" áp cho mọi người — sai công thức.
select pg_temp.run_if('kpi_sets',
  'delete from public.kpi_sets where user_id is not null and user_id not in (select id from _keep)');
-- Dự án: giữ dự án mà người được giữ làm trưởng hoặc là thành viên.
do $$
begin
  if to_regclass('public.projects') is null then return; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'project_members' and column_name = 'project_id') then
    delete from public.projects p
    where not (coalesce(p.lead_id in (select id from _keep), false)
      or exists (select 1 from public.project_members m where m.project_id = p.id and m.user_id in (select id from _keep)));
  else
    delete from public.projects p where not coalesce(p.lead_id in (select id from _keep), false);
  end if;
end $$;

-- ---- 2. Hồ sơ của người không giữ ----------------------------------------------------
delete from public.profiles where id not in (select id from _keep);

-- ---- 3. Lan theo khoá ngoại (như ON DELETE của database), lặp tới khi hết --------------
\echo '== Lan theo khoá ngoại:'
do $$
declare
  r record;
  n bigint;
  total bigint;
  pass int := 0;
  cond text;
begin
  loop
    pass := pass + 1;
    total := 0;
    for r in
      select c.oid, c.conname, c.confdeltype, c.conrelid::regclass as child
      from pg_constraint c
      join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
      join pg_class pc on pc.oid = c.confrelid join pg_namespace pns on pns.oid = pc.relnamespace
      where c.contype = 'f' and ns.nspname = 'public' and pns.nspname <> 'auth'
      order by c.conname
    loop
      cond := pg_temp.fk_orphan_cond(r.oid);
      if r.confdeltype = 'n' then
        begin
          execute format('update %s ch set %s where %s', r.child,
            (select string_agg(format('%I = null', x), ', ') from unnest(pg_temp.fk_cols(r.oid)) x), cond);
          get diagnostics n = row_count;
        exception when not_null_violation then
          execute format('delete from %s ch where %s', r.child, cond);
          get diagnostics n = row_count;
        end;
      else
        execute format('delete from %s ch where %s', r.child, cond);
        get diagnostics n = row_count;
      end if;
      if n > 0 then
        raise notice '   % — % dòng (%)', r.conname, n, case r.confdeltype when 'n' then 'đặt rỗng' else 'xoá' end;
      end if;
      total := total + n;
    end loop;
    exit when total = 0;
    if pass > 30 then raise exception 'Vòng lan theo khoá ngoại không dừng — huỷ.'; end if;
  end loop;
end $$;

-- ---- 4. Tài khoản đăng nhập (bật lại khoá ngoại để bảng con trong auth tự xoá theo) ----
set local session_replication_role = origin;
delete from auth.users where id not in (select id from _keep);

-- ---- 5. Kiểm tra: không còn dòng mồ côi; xác thực mọi khoá ngoại -----------------------
do $$
declare
  r record;
  n bigint;
  bad text := '';
begin
  for r in
    select c.oid, c.conname, c.conrelid::regclass as child
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where c.contype = 'f' and ns.nspname = 'public'
  loop
    execute format('select count(*) from %s ch where %s', r.child, pg_temp.fk_orphan_cond(r.oid)) into n;
    if n > 0 then bad := bad || format('%s=%s ', r.conname, n); end if;
  end loop;
  if bad <> '' then raise exception 'Còn dòng mồ côi sau khi dọn: % — huỷ.', bad; end if;

  for r in
    select c.conrelid::regclass as child, c.conname
    from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where c.contype = 'f' and ns.nspname = 'public' and not c.convalidated
  loop
    execute format('alter table %s validate constraint %I', r.child, r.conname);
  end loop;
end $$;

-- ---- Báo cáo ---------------------------------------------------------------------------
update _cnt set after =
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', tbl), false, true, '')))[1]::text::bigint;
\echo '== Số dòng thay đổi (trước → sau):'
select '   ' || rpad(tbl, 38) || lpad(before::text, 7) || ' → ' || lpad(after::text, 7)
from _cnt where before is distinct from after order by tbl;
select '   ' || rpad('auth.users (tài khoản đăng nhập)', 38) || lpad(b.n::text, 7) || ' → ' || lpad(count(*)::text, 7)
from auth.users, _auth_before b group by b.n;
select '== Khoá ngoại chưa xác thực còn lại: ' || count(*)
from pg_constraint c join pg_class cl on cl.oid = c.conrelid join pg_namespace ns on ns.oid = cl.relnamespace
where c.contype = 'f' and ns.nspname = 'public' and not c.convalidated;

\if :apply
commit;
\echo '== ĐÃ GHI THẬT.'
\else
rollback;
\echo '== CHẠY THỬ: đã HUỶ, database không đổi. Đúng ý thì chạy lại với --apply.'
\endif
