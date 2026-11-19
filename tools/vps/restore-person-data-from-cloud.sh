#!/usr/bin/env bash
# Chép cơ chế lương + KPI cá nhân từ Supabase Cloud cũ sang nhân viên hiện có trên VPS (ghép theo tên).
# Chạy TRÊN VPS, cạnh restore-person-data-from-cloud.sql, cần ~/cloud.env (SUPABASE_DB_URL của Cloud):
#   bash restore-person-data-from-cloud.sh          # chạy thử, không ghi
#   bash restore-person-data-from-cloud.sh --apply  # ghi thật (nhớ ./hrm.sh backup trước)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
apply=0; [ "${1:-}" = "--apply" ] && apply=1
set -a; . "${CLOUD_ENV:-$HOME/cloud.env}"; set +a
stage=/tmp/cloud_stage.tsv
umask 077
cloud() { docker exec -i supabase-db psql "$SUPABASE_DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"; }
{
  cloud -c "copy (select 'profiles', jsonb_build_object('id', id, 'name', name, 'employee_code', employee_code) from profiles) to stdout"
  for t in employee_pay_items kpi_sets kpi_set_items kpi_exemptions; do
    cloud -c "copy (select '$t', to_jsonb(x) from public.$t x) to stdout"
  done
} > "$stage"
echo "Đã đọc từ Cloud: $(wc -l < "$stage") dòng."
docker exec -i supabase-db sh -c 'cat > /tmp/cloud_stage.tsv' < "$stage"
docker exec -i supabase-db psql -X -U supabase_admin -d postgres -v apply="$apply" -f - < "$here/restore-person-data-from-cloud.sql"
docker exec supabase-db rm -f /tmp/cloud_stage.tsv; shred -u "$stage" 2>/dev/null || rm -f "$stage"
