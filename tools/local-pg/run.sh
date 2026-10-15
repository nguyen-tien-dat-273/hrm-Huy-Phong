#!/usr/bin/env bash
# Postgres tạm để thử migration lương — KHÔNG đụng Supabase / dữ liệu thật.
# Dùng:  bash tools/local-pg/run.sh        (dựng cụm ở .local-pg/, cổng 54329, DB hrm_pay)
#        bash tools/local-pg/run.sh stop   (tắt cụm)
set -eu
BIN="${PGBIN:-/c/Program Files/PostgreSQL/18/bin}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="$ROOT/.local-pg/data"; PORT=54329; DB=hrm_pay
export PGHOST=localhost PGPORT=$PORT PGUSER=postgres PGCLIENTENCODING=UTF8
if [ "${1:-}" = stop ]; then "$BIN/pg_ctl.exe" -D "$DATA" stop -m fast; exit 0; fi
[ -d "$DATA" ] || "$BIN/initdb.exe" -D "$DATA" -U postgres -A trust -E UTF8 --locale=C >/dev/null
"$BIN/pg_isready.exe" -q || "$BIN/pg_ctl.exe" -D "$DATA" -o "-p $PORT -c listen_addresses=localhost" -l "$ROOT/.local-pg/server.log" start >/dev/null
"$BIN/psql.exe" -q -d postgres -c "drop database if exists $DB" -c "create database $DB" >/dev/null 2>&1
for f in "$ROOT"/tools/local-pg/0*.sql; do "$BIN/psql.exe" -q -v ON_ERROR_STOP=1 -d $DB -f "$f" >/dev/null 2>&1; done
M="$ROOT/supabase/migrations"
for f in 20260921090000_payroll_engine 20260921130000_payroll_settings 20260928120000_overtime_tax_exemption \
 20260928140000_payroll_adjustments 20260928150000_unit_pay_items 20260928160000_payroll_caps_and_minimums \
 20260930210000_huyphong_pay_components 20260930220000_pay_component_groups 20261004100000_pay_component_is_base \
 20261007100000_pay_item_tax_flags 20261007110000_payroll_named_params 20261007120000_catalog_from_spec \
 20261013100000_m06_f0601_payroll_catalog 20261013110000_m06_f0602_payroll_params_formulas \
 20261013120000_m06_f0603_payroll_scheme_approval 20261013130000_m06_f0604_payroll_lock_publish \
 20261017100000_m06_f0601_catalog_dmkl 20261017110000_m06_formula_mechanism \
 20261018100000_m06_scheme_apply_direct 20261019100000_m06_unit_mechanism \
 20261020100000_m06_adjustment_component; do
  "$BIN/psql.exe" -q -v ON_ERROR_STOP=1 -1 -d $DB -f "$M/$f.sql" >/dev/null 2>"$ROOT/.local-pg/err.txt" || { echo "LỖI ở $f"; grep -v NOTICE "$ROOT/.local-pg/err.txt" | tail -5; exit 1; }
done
echo "OK: psql -h localhost -p $PORT -U postgres -d $DB"
