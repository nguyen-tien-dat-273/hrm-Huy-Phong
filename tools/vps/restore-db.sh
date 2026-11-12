#!/bin/sh
# ============================================================================
# Khôi phục bản sao lưu Supabase Cloud vào Supabase TỰ HOST trên VPS.
#
#   sh tools/vps/restore-db.sh <thư-mục-sao-lưu>
#
# Biến tuỳ chọn:
#   DB_CONTAINER   tên container Postgres của Supabase (mặc định supabase-db)
#   DB_USER        mặc định supabase_admin (superuser trong image Supabase)
#   DB_NAME        mặc định postgres
#   FORCE=1        cho phép chạy khi schema public không rỗng (KHÔNG khuyến nghị)
#
# Chạy trên VPS, SAU KHI stack Supabase đã lên và HRM CHƯA nhận người dùng.
# Script dừng ngay khi có lỗi. Không đụng Supabase Cloud.
# Thứ tự: kiểm checksum → public → buckets → chính sách Storage → publication realtime → auth.
# File Storage nạp riêng bằng tools/backup/storage-restore.mjs.
# ============================================================================
set -eu

dir="${1:?Cách dùng: sh tools/vps/restore-db.sh <thư-mục-sao-lưu>}"
container="${DB_CONTAINER:-supabase-db}"
dbuser="${DB_USER:-supabase_admin}"
dbname="${DB_NAME:-postgres}"

[ -f "$dir/COMPLETE" ] || { echo "Bản sao lưu chưa hoàn tất (thiếu COMPLETE): $dir" >&2; exit 1; }
echo "==> Kiểm checksum"
(cd "$dir" && sha256sum --check --quiet SHA256SUMS)

psql_db() { docker exec -i "$container" psql -U "$dbuser" -d "$dbname" -v ON_ERROR_STOP=1 "$@"; }
restore() { docker exec -i "$container" pg_restore -U "$dbuser" -d "$dbname" --no-owner "$@"; }

echo "==> Kiểm database đích"
existing="$(psql_db -Atc "select count(*) from pg_tables where schemaname='public'")"
if [ "$existing" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "Schema public đã có $existing bảng. Dừng để không ghi đè. (Dựng lại Supabase sạch, hoặc FORCE=1 nếu chắc chắn.)" >&2
  exit 1
fi
users="$(psql_db -Atc "select count(*) from auth.users")"
if [ "$users" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
  echo "auth.users đã có $users tài khoản. Dừng." >&2
  exit 1
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

echo "==> 1/5 Schema public (cấu trúc + dữ liệu + GRANT)"
restore --exit-on-error -n public < "$dir/db-public.dump"

echo "==> 2/5 Danh sách bucket Storage"
restore --exit-on-error --data-only -n storage -t buckets < "$dir/db-storage-data.dump"

# Chính sách RLS trên storage.objects và các bảng đã vào publication realtime nằm trong
# db-full.dump (không nằm trong dump public) — lọc đúng các mục đó bằng danh sách.
echo "==> 3/5 Chính sách Storage + publication realtime"
docker exec -i "$container" pg_restore --list < "$dir/db-full.dump" > "$tmp/all.list"
grep -E ' POLICY storage | PUBLICATION TABLE ' "$tmp/all.list" > "$tmp/pick.list" || true
echo "    $(wc -l < "$tmp/pick.list") mục"
if [ -s "$tmp/pick.list" ]; then
  docker cp "$tmp/pick.list" "$container:/tmp/pick.list"
  restore --exit-on-error -L /tmp/pick.list < "$dir/db-full.dump"
  docker exec "$container" rm -f /tmp/pick.list
fi

echo "==> 4/5 Tài khoản đăng nhập (auth) — bỏ auth.schema_migrations của GoTrue"
docker exec -i "$container" pg_restore --list < "$dir/db-auth-data.dump" > "$tmp/auth.list"
grep -v ' TABLE DATA auth schema_migrations ' "$tmp/auth.list" > "$tmp/auth.pick"
docker cp "$tmp/auth.pick" "$container:/tmp/auth.pick"
restore --exit-on-error --data-only --disable-triggers -L /tmp/auth.pick < "$dir/db-auth-data.dump"
docker exec "$container" rm -f /tmp/auth.pick

echo "==> 5/5 Báo PostgREST tải lại schema"
psql_db -c "notify pgrst, 'reload schema'" >/dev/null

cat <<'MSG'

XONG phần database. Còn lại:
  1. Nạp file Storage:  SUPABASE_SERVICE_ROLE_KEY=<khoá máy mới> node tools/backup/storage-restore.mjs <thư-mục-sao-lưu> --url https://<api-domain>
  2. Đối chiếu số dòng: xem docs/trien-khai-vps-mat-bao.md, mục 5.
  3. Chạy supabase/check_migrations.sql để xem migration nào chưa có đối tượng tương ứng.
MSG
