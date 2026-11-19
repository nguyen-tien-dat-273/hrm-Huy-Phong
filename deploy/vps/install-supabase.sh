#!/bin/sh
# ============================================================================
# Cài Supabase tự host (bản rút gọn) vào /opt/supabase và tạo /opt/hrm/.env.
# Chạy bằng user deploy, SAU setup-server.sh:
#
#   sh /opt/hrm/install-supabase.sh hrm.congty.vn
#
# Lần đầu: tải đúng bản Supabase đã ghim, SINH KHOÁ MỚI (JWT, anon, service, mật khẩu DB),
# đặt URL theo tên miền, bật lớp phủ rút gọn, chạy và kiểm tra.
# Chạy lại: KHÔNG sinh lại khoá (sinh lại = mất truy cập dữ liệu). Chỉ cập nhật lớp phủ,
# khởi động lại và kiểm tra.
# ============================================================================
set -eu

DOMAIN="${1:-}"
SUPA_DIR="${SUPABASE_DIR:-/opt/supabase}"
HRM_DIR="$(cd "$(dirname "$0")" && pwd)"
REF="self-hosted/v0.8.4"   # đổi bản thì phải đọc lại docker-compose.yml mới và kiểm lớp phủ

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[!] %s\033[0m\n' "$*"; }
die() { printf '\033[1;31m[LỖI] %s\033[0m\n' "$*" >&2; exit 1; }

# Ghi KEY=VALUE vào file .env mà không cần thoát ký tự (giá trị có / + = vẫn đúng).
set_env() {
  file="$1" key="$2" val="$3"
  if grep -q "^${key}=" "$file"; then
    K="$key" V="$val" awk 'BEGIN { k = ENVIRON["K"]; v = ENVIRON["V"] }
      index($0, k "=") == 1 { print k "=" v; next } { print }' "$file" > "$file.tmp"
    cat "$file.tmp" > "$file" && rm -f "$file.tmp"
  else
    printf '%s=%s\n' "$key" "$val" >> "$file"
  fi
}
get_env() { grep "^$2=" "$1" | head -1 | cut -d= -f2-; }

[ "$(id -u)" != "0" ] || die "Chạy bằng user deploy, không phải root."
docker info >/dev/null 2>&1 || die "User này chưa dùng được Docker (đăng xuất rồi đăng nhập lại sau setup-server.sh)."
compose_ver=$(docker compose version --short | sed 's/^v//')
[ "$(printf '%s\n%s\n' "2.24.4" "$compose_ver" | sort -V | head -1)" = "2.24.4" ] || die "Cần Docker Compose ≥ 2.24.4 (đang có $compose_ver)."
[ -f "$HRM_DIR/supabase/docker-compose.hrm-lean.yml" ] || die "Không thấy $HRM_DIR/supabase/docker-compose.hrm-lean.yml (chạy script từ thư mục gói triển khai)."

if [ -f "$SUPA_DIR/.env" ]; then
  FIRST=0
  installed_domain=$(get_env "$SUPA_DIR/.env" SUPABASE_PUBLIC_URL | sed 's#^https://##')
  if [ -n "$DOMAIN" ] && [ "$DOMAIN" != "$installed_domain" ]; then
    die "Supabase đã cài cho $installed_domain. Đổi tên miền cần làm tay (xem README.md, mục Đổi tên miền)."
  fi
  DOMAIN="$installed_domain"
  say "Supabase đã cài ($DOMAIN) — giữ nguyên khoá, chỉ cập nhật lớp phủ và kiểm tra"
else
  FIRST=1
  [ -n "$DOMAIN" ] || die "Cách dùng: sh install-supabase.sh <ten-mien>   (vd hrm.congty.vn)"
  echo "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' \
    || die "Tên miền không hợp lệ: $DOMAIN (chữ thường, không có http://)."
fi

# ---------------------------------------------------------------------------
if [ "$FIRST" = "1" ]; then
  say "1/5 Tải Supabase $REF"
  [ -z "$(ls -A "$SUPA_DIR" 2>/dev/null)" ] || die "$SUPA_DIR không rỗng nhưng không có .env — kiểm tra tay trước."
  src=$(mktemp -d)
  git -c advice.detachedHead=false clone -q --depth 1 --branch "$REF" --filter=blob:none --sparse \
    https://github.com/supabase/supabase "$src/supabase"
  git -C "$src/supabase" sparse-checkout set docker
  cp -a "$src/supabase/docker/." "$SUPA_DIR/"
  rm -rf "$src"
  echo "$REF" > "$SUPA_DIR/.hrm-supabase-ref"

  say "2/5 Sinh khoá và cấu hình"
  cd "$SUPA_DIR"
  umask 077
  cp .env.example .env
  chmod 600 .env
  sh utils/generate-keys.sh --update-env >/dev/null
  rm -f .env.old
  set_env .env SUPABASE_PUBLIC_URL "https://$DOMAIN"
  set_env .env API_EXTERNAL_URL "https://$DOMAIN/auth/v1"
  set_env .env SITE_URL "https://$DOMAIN"
  set_env .env ADDITIONAL_REDIRECT_URLS "https://$DOMAIN/**"
  # HRM tạo tài khoản qua API quản trị; không cho ai tự đăng ký.
  set_env .env DISABLE_SIGNUP true
  set_env .env ENABLE_ANONYMOUS_USERS false
  # Chưa có nhà cung cấp SMS: tắt kênh điện thoại (HRM báo "kênh không khả dụng").
  set_env .env ENABLE_PHONE_SIGNUP false
  set_env .env ENABLE_PHONE_AUTOCONFIRM false
  set_env .env STUDIO_DEFAULT_ORGANIZATION "Huy Phong"
  set_env .env STUDIO_DEFAULT_PROJECT "HRM"
  set_env .env OPENAI_API_KEY ""
  set_env .env POOLER_TENANT_ID "hrm"
  set_env .env SMTP_SENDER_NAME "HRM Huy Phong"
fi

cd "$SUPA_DIR"
say "3/5 Bật lớp phủ rút gọn"
cp "$HRM_DIR/supabase/docker-compose.hrm-lean.yml" "$SUPA_DIR/docker-compose.hrm-lean.yml"
set_env .env COMPOSE_FILE "docker-compose.yml:docker-compose.hrm-lean.yml"

services=$(docker compose config --services | sort | tr '\n' ' ')
expected="api-gw auth db realtime rest storage "
[ "$services" = "$expected" ] || die "Dịch vụ sẽ chạy: [$services], mong đợi: [$expected]. Bản Supabase/lớp phủ lệch nhau — dừng."
public_ports=$(docker compose config --format json \
  | jq -r '.services[] | (.ports // [])[] | select((.host_ip // "") != "127.0.0.1") | "\(.published)->\(.target)"')
[ -z "$public_ports" ] || die "Có cổng mở ra Internet: $public_ports — dừng."
echo "Dịch vụ: $services(không cổng nào mở ra ngoài)"

say "4/5 Kéo image và chạy"
docker compose pull -q
docker compose up -d --remove-orphans

containers="supabase-db supabase-auth supabase-rest realtime-dev.supabase-realtime supabase-storage supabase-envoy"
deadline=$(( $(date +%s) + 300 ))
while :; do
  pending=""
  for c in $containers; do
    st=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)
    [ "$st" = "healthy" ] || pending="$pending $c($st)"
  done
  [ -z "$pending" ] && break
  if [ "$(date +%s)" -ge "$deadline" ]; then
    docker compose ps
    die "Quá 5 phút vẫn chưa sẵn sàng:$pending  — xem: docker compose -f $SUPA_DIR/docker-compose.yml logs --tail 80 <dịch vụ>"
  fi
  sleep 5
done
echo "Mọi dịch vụ healthy."

say "5/5 Kiểm tra qua cổng API"
ANON_KEY=$(get_env .env ANON_KEY)
SERVICE_ROLE_KEY=$(get_env .env SERVICE_ROLE_KEY)
POSTGRES_PASSWORD=$(get_env .env POSTGRES_PASSWORD)
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" http://127.0.0.1:8000/auth/v1/health)
[ "$code" = "200" ] || die "Auth qua api-gw trả $code (mong đợi 200)."
code=$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" http://127.0.0.1:8000/storage/v1/bucket)
[ "$code" = "200" ] || die "Storage qua api-gw trả $code (mong đợi 200)."
docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select 1' >/dev/null || die "Không truy vấn được Postgres."
echo "Auth, Storage, Postgres: OK."

# ---------------------------------------------------------------------------
env_file="$HRM_DIR/.env"
if [ ! -f "$env_file" ]; then
  ( umask 077; cp "$HRM_DIR/.env.example" "$env_file" )
fi
chmod 600 "$env_file"
set_env "$env_file" DOMAIN "$DOMAIN"
set_env "$env_file" SUPABASE_ANON_KEY "$ANON_KEY"
set_env "$env_file" SUPABASE_SERVICE_ROLE_KEY "$SERVICE_ROLE_KEY"
set_env "$env_file" POSTGRES_PASSWORD "$POSTGRES_PASSWORD"
[ -n "$(get_env "$env_file" CRON_SECRET)" ] || set_env "$env_file" CRON_SECRET "$(openssl rand -hex 32)"
uid=$(id -u); gid=$(id -g)
set_env "$env_file" BACKUP_UID "$uid"
set_env "$env_file" BACKUP_GID "$gid"

smtp_host=$(get_env .env SMTP_HOST)
say "XONG"
cat <<EOF
Supabase: $SUPA_DIR  (khoá trong $SUPA_DIR/.env — SAO LƯU file này vào trình quản lý mật khẩu)
HRM:      $env_file đã có tên miền, khoá Supabase, mật khẩu DB, CRON_SECRET.

Khoá anon (công khai, dùng để dựng giao diện trên máy bạn):
  $ANON_KEY

Còn phải làm:
  - Trên máy bạn: node tools/vps/make-bundle.mjs --domain $DOMAIN --anon-key <khoá anon ở trên>
    rồi chép gói lên và chạy: ./hrm.sh deploy <gói>.tgz
EOF
if [ "$smtp_host" = "supabase-mail" ] || [ -z "$smtp_host" ]; then
  warn "Chưa cấu hình SMTP: email mã xác minh (quên mật khẩu) CHƯA gửi được. Sửa SMTP_* trong $SUPA_DIR/.env rồi: ./hrm.sh supabase up -d auth"
fi
