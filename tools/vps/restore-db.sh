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

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"; docker exec "$container" rm -f /tmp/db-public.dump /tmp/nofk.list /tmp/fk.list >/dev/null 2>&1 || true' EXIT

echo "==> 1/5 Schema public (cấu trúc + dữ liệu + GRANT)"
# Thứ tự: pre-data (bảng) → data (dữ liệu) → post-data TRỪ khoá ngoại (chỉ mục, trigger,
# chính sách…) → khoá ngoại. Trigger chỉ tạo sau khi nạp dữ liệu nên không sinh bản ghi giả.
# Đọc từ file trong container (không phải pipe) vì pg_restore cần tua lại khi chia phần.
docker cp "$dir/db-public.dump" "$container:/tmp/db-public.dump"
restore --exit-on-error -n public --section=pre-data /tmp/db-public.dump
restore --exit-on-error -n public --section=data /tmp/db-public.dump

docker exec "$container" pg_restore --list -n public /tmp/db-public.dump > "$tmp/public.list"
grep -v ' FK CONSTRAINT ' "$tmp/public.list" > "$tmp/nofk.list"
grep ' FK CONSTRAINT ' "$tmp/public.list" > "$tmp/fk.list" || true
docker cp "$tmp/nofk.list" "$container:/tmp/nofk.list"
docker cp "$tmp/fk.list" "$container:/tmp/fk.list"
restore --exit-on-error -n public --section=post-data -L /tmp/nofk.list /tmp/db-public.dump

# Khoá ngoại: Cloud có thể chứa dữ liệu "mồ côi" (bảng con trỏ tới bản ghi cha đã bị xoá khi
# kiểm tra khoá ngoại bị tắt — ví dụ script xoá dữ liệu thử). Không sửa/xoá dữ liệu: tạo mọi
# khoá ngoại ở dạng NOT VALID (vẫn chặn dữ liệu lệch MỚI); sau bước 4 xác thực từng cái, cái nào
# bị dữ liệu cũ vi phạm thì giữ NOT VALID và liệt kê ra. Bản trên VPS giống hệt Cloud.
echo "    Khoá ngoại: $(wc -l < "$tmp/fk.list" | tr -d ' ') ràng buộc"
docker exec "$container" pg_restore -n public -L /tmp/fk.list -f - /tmp/db-public.dump \
  | sed -E '/REFERENCES .*;$/ { / NOT VALID;$/! s/;$/ NOT VALID;/ }' > "$tmp/fk.sql"
psql_db -q < "$tmp/fk.sql" >/dev/null
expected_fk="$(wc -l < "$tmp/fk.list" | tr -d ' ')"
actual_fk="$(psql_db -Atc "select count(*) from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype = 'f'")"
if [ "$actual_fk" != "$expected_fk" ]; then
  echo "LỖI: bản sao lưu có $expected_fk khoá ngoại nhưng chỉ tạo được $actual_fk. Dừng." >&2
  exit 1
fi

echo "==> 2/5 Danh sách bucket Storage"
restore --exit-on-error --data-only -n storage -t buckets < "$dir/db-storage-data.dump"

# Chính sách RLS trên storage.objects và các bảng đã vào publication realtime nằm trong
# db-full.dump (không nằm trong dump public) — lọc đúng các mục đó bằng danh sách.
echo "==> 3/5 Chính sách Storage + publication realtime"
docker exec -i "$container" pg_restore --list < "$dir/db-full.dump" > "$tmp/all.list"
# Chỉ kênh realtime `supabase_realtime` cho bảng public (HRM dùng). Cloud còn có kênh nội bộ
# (vd supabase_realtime_messages_publication cho realtime.messages) mà bản tự host không có.
grep -E ' POLICY storage | PUBLICATION TABLE public supabase_realtime ' "$tmp/all.list" > "$tmp/pick.list" || true
pubs=$(grep -c ' PUBLICATION TABLE ' "$tmp/pick.list" || true)
echo "    $(wc -l < "$tmp/pick.list" | tr -d ' ') mục ($(grep -c ' POLICY storage ' "$tmp/pick.list" || true) chính sách Storage, $pubs bảng realtime)"
skipped=$(grep ' PUBLICATION TABLE ' "$tmp/all.list" | grep -vc ' PUBLICATION TABLE public supabase_realtime ' || true)
[ "$skipped" = "0" ] || echo "    Bỏ qua $skipped mục realtime nội bộ của Supabase Cloud (không dùng cho HRM)."
[ "$pubs" != "0" ] || echo "    CẢNH BÁO: không có bảng nào trong kênh realtime — thông báo thời gian thực sẽ không chạy." >&2
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

# Xác thực khoá ngoại SAU khi đã có tài khoản (profiles → auth.users) và bucket: làm sớm hơn
# thì mọi hồ sơ đều bị coi là mồ côi.
echo "==> Xác thực khoá ngoại"
psql_db -q <<'SQL'
create temp table _fk_invalid(tbl text, conname text);
do $$
declare r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'f' and not c.convalidated
    order by 1, 2
  loop
    begin
      execute format('alter table %s validate constraint %I', r.tbl, r.conname);
    exception when foreign_key_violation then
      insert into _fk_invalid values (r.tbl, r.conname);
    end;
  end loop;
end $$;
\copy (select tbl || ' → ' || conname from _fk_invalid order by 1) to '/tmp/fk_invalid.txt'
SQL
invalid="$(docker exec "$container" sh -c 'cat /tmp/fk_invalid.txt 2>/dev/null; rm -f /tmp/fk_invalid.txt')"
if [ -n "$invalid" ]; then
  echo "    $(printf '%s\n' "$invalid" | wc -l | tr -d ' ') khoá ngoại có dữ liệu mồ côi sẵn từ Cloud — giữ NOT VALID (không đổi dữ liệu):"
  printf '%s\n' "$invalid" | sed 's/^/      /'
fi

echo "==> 5/5 Báo PostgREST tải lại schema"
psql_db -c "notify pgrst, 'reload schema'" >/dev/null

cat <<'MSG'

XONG phần database. (./hrm.sh restore tự làm tiếp hai bước dưới; chạy tay trong /opt/hrm thì:)
  1. Nạp file Storage:  docker compose run --rm -v <thư-mục>:/restore:ro backup restore-storage /restore --url http://api-gw:8000
  2. Đối chiếu số dòng: docker compose run --rm -v <thư-mục>:/restore:ro backup verify /restore
  3. Tuỳ chọn: chạy restore/check_migrations.sql để xem migration nào chưa có đối tượng tương ứng.
MSG
