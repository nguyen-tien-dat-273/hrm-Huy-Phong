#!/bin/sh
# ============================================================================
# Vận hành HRM trên VPS. Chạy trong /opt/hrm bằng user deploy:   ./hrm.sh <lệnh>
#
#   status                 tình trạng: container, RAM, ổ đĩa, sao lưu, HTTPS, máy chấm công
#   up                     chạy (hoặc chạy lại) hrm + caddy + backup
#   deploy <gói.tgz>       cài bản mới; lỗi thì tự quay về bản trước
#   rollback               quay về image của lần deploy trước
#   logs [dịch vụ]         xem log (hrm | caddy | backup), Ctrl+C để thoát
#   backup                 sao lưu ngay
#   cloud-backup <file>    sao lưu Supabase CLOUD (khi chuyển nhà) vào /opt/hrm-backups/cloud
#   restore <thư-mục>      khôi phục một bản sao lưu vào Supabase TRỐNG trên VPS
#   wipe-supabase          XOÁ SẠCH dữ liệu Supabase trên VPS (giữ khoá) — trước khi khôi phục lại
#   prune-keep [--apply]   chỉ giữ admin/ceo + nhân viên "Vượng" + cấu hình; mặc định CHẠY THỬ
#   studio on|off          bật/tắt trang quản trị Supabase (chỉ vào được qua đường hầm SSH)
#   supabase <lệnh…>       docker compose trong /opt/supabase (vd: ./hrm.sh supabase ps)
# ============================================================================
set -eu

HRM_DIR="$(cd "$(dirname "$0")" && pwd)"
SUPA_DIR="${SUPABASE_DIR:-/opt/supabase}"
cd "$HRM_DIR"

say() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[LỖI] %s\033[0m\n' "$*" >&2; exit 1; }
env_get() { grep "^$1=" "$HRM_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2-; }

[ -f "$HRM_DIR/.env" ] || die "Chưa có $HRM_DIR/.env — chạy install-supabase.sh trước."
DOMAIN="$(env_get DOMAIN)"
BACKUP_DIR="$(env_get BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/opt/hrm-backups}"

wait_healthy() { # chờ /healthz của hrm tối đa 90 giây
  i=0
  while [ "$i" -lt 45 ]; do
    if curl -fsS -m 3 http://127.0.0.1:8080/healthz >/dev/null 2>&1; then return 0; fi
    i=$((i + 1)); sleep 2
  done
  return 1
}

cmd_up() {
  docker network inspect supabase_default >/dev/null 2>&1 || die "Chưa có mạng supabase_default — Supabase chưa chạy (./hrm.sh supabase up -d)."
  [ -f app/client/dist/index.html ] || die "Chưa có bản dựng app. Dùng: ./hrm.sh deploy <gói.tgz>"
  docker compose up -d
  wait_healthy && ok "hrm đã chạy" || die "hrm không lên — xem: ./hrm.sh logs hrm"
}

cmd_deploy() {
  bundle="${1:-}"
  [ -f "$bundle" ] || die "Cách dùng: ./hrm.sh deploy <gói.tgz>"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  tar -xzf "$bundle" -C "$tmp"
  [ -f "$tmp/BUNDLE-INFO.txt" ] || die "Không phải gói triển khai HRM (thiếu BUNDLE-INFO.txt)."
  [ -f "$tmp/app/client/dist/index.html" ] || die "Gói này chỉ có script, không có bản dựng app (dựng lại với --domain và --anon-key)."
  b_domain=$(grep '^domain=' "$tmp/BUNDLE-INFO.txt" | cut -d= -f2)
  b_key=$(grep '^anon_key_sha256_8=' "$tmp/BUNDLE-INFO.txt" | cut -d= -f2)
  e_key=$(printf '%s' "$(env_get SUPABASE_ANON_KEY)" | sha256sum | cut -c1-8)
  [ "$b_domain" = "$DOMAIN" ] || die "Gói dựng cho tên miền '$b_domain' nhưng VPS là '$DOMAIN'. Dựng lại gói."
  [ "$b_key" = "$e_key" ] || die "Gói dựng với khoá anon KHÁC khoá của Supabase trên VPS. Dựng lại gói với khoá trong /opt/supabase/.env."
  say "Cài $(grep '^created=' "$tmp/BUNDLE-INFO.txt" | cut -d= -f2) (commit $(grep '^commit=' "$tmp/BUNDLE-INFO.txt" | cut -d= -f2))"

  caddy_before=$(sha256sum Caddyfile 2>/dev/null | cut -c1-64 || true)
  for img in hrm-app hrm-backup; do
    if docker image inspect "$img:current" >/dev/null 2>&1; then docker image tag "$img:current" "$img:previous"; fi
  done

  # Thay từng mục bằng mv (không ghi đè tại chỗ — an toàn cả với chính script đang chạy).
  # Giữ nguyên: .env, secrets/.
  for item in $(ls -A "$tmp"); do
    case "$item" in .env|secrets) continue ;; esac
    rm -rf "$HRM_DIR/.old-$item"
    if [ -e "$HRM_DIR/$item" ]; then mv "$HRM_DIR/$item" "$HRM_DIR/.old-$item"; fi
    mv "$tmp/$item" "$HRM_DIR/$item"
  done
  for old in "$HRM_DIR"/.old-*; do [ -e "$old" ] && rm -rf "$old"; done
  chmod +x "$HRM_DIR"/*.sh 2>/dev/null || true

  say "Dựng image (chỉ cài thư viện chạy, không build lại giao diện)"
  docker compose build hrm backup
  docker compose up -d
  caddy_after=$(sha256sum Caddyfile | cut -c1-64)
  if [ "$caddy_before" != "$caddy_after" ]; then
    docker compose up -d --force-recreate caddy
    ok "Caddyfile đổi — đã nạp lại Caddy"
  fi

  if wait_healthy; then
    ok "Bản mới chạy tốt: http://127.0.0.1:8080/healthz"
  else
    bad "Bản mới không lên. Quay về bản trước…"
    docker compose logs --tail 40 hrm || true
    cmd_rollback
    exit 1
  fi
}

cmd_rollback() {
  docker image inspect hrm-app:previous >/dev/null 2>&1 || die "Không có image bản trước (hrm-app:previous)."
  docker image tag hrm-app:previous hrm-app:current
  if docker image inspect hrm-backup:previous >/dev/null 2>&1; then docker image tag hrm-backup:previous hrm-backup:current; fi
  docker compose up -d --no-build --force-recreate hrm backup
  wait_healthy && ok "Đã quay về bản trước" || die "Bản trước cũng không lên — xem ./hrm.sh logs hrm"
  warn "Mã nguồn trong $HRM_DIR vẫn là bản mới; lần 'up' sau dùng image đang chạy (không build lại)."
}

cmd_status() {
  say "Container"
  docker compose ps --format 'table {{.Service}}\t{{.Status}}' 2>/dev/null || true
  (cd "$SUPA_DIR" && docker compose ps --format 'table {{.Service}}\t{{.Status}}') 2>/dev/null || bad "Không đọc được Supabase ở $SUPA_DIR"

  say "Bộ nhớ"
  free -m | awk 'NR==1 {print "  " $0} NR>1 {print "  " $0}'
  docker stats --no-stream --format '  {{.Name}}: {{.MemUsage}}' 2>/dev/null | sort
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  swap_used=$(free -m | awk '/Swap/ {print $3}')
  [ "$avail" -ge 300 ] && ok "RAM còn trống ${avail} MB" || bad "RAM chỉ còn ${avail} MB — cân nhắc nâng gói VPS"
  [ "${swap_used:-0}" -le 512 ] && ok "Swap đang dùng ${swap_used} MB" || warn "Swap đang dùng ${swap_used} MB (nhiều) — theo dõi; thường xuyên như vậy thì nâng gói"

  say "Ổ đĩa"
  df -h / | awk 'NR==2 {print "  Dùng " $3 " / " $2 " (" $5 "), còn " $4}'
  use=$(df -P / | awk 'NR==2 {print int($5)}')
  [ "$use" -lt 85 ] && ok "Ổ đĩa ${use}%" || bad "Ổ đĩa ${use}% — dọn: docker image prune -a; giảm BACKUP_KEEP_DAYS"
  [ -d "$BACKUP_DIR" ] && echo "  Sao lưu: $(du -sh "$BACKUP_DIR" 2>/dev/null | cut -f1) trong $BACKUP_DIR"

  say "Sao lưu"
  now=$(date +%s)
  if [ -f "$BACKUP_DIR/.last-success" ]; then
    age=$(( (now - $(cat "$BACKUP_DIR/.last-success")) / 3600 ))
    [ "$age" -le 26 ] && ok "Bản gần nhất cách đây ${age} giờ" || bad "Bản gần nhất cách đây ${age} giờ (quá 26 giờ) — xem ./hrm.sh logs backup"
  else
    warn "Chưa có bản sao lưu nào (chạy thử: ./hrm.sh backup)"
  fi
  if [ -n "$(env_get RCLONE_REMOTE)" ]; then
    if [ -f "$BACKUP_DIR/.last-offsite" ]; then
      age=$(( (now - $(cat "$BACKUP_DIR/.last-offsite")) / 3600 ))
      [ "$age" -le 26 ] && ok "Đã chép ra ngoài cách đây ${age} giờ" || bad "Lần chép ra ngoài gần nhất cách đây ${age} giờ"
    else
      warn "Chưa chép ra ngoài lần nào"
    fi
  else
    bad "Chưa cấu hình RCLONE_REMOTE: sao lưu CHỈ nằm trên VPS này"
  fi
  [ -n "$(env_get BACKUP_PING_URL)" ] && ok "Có giám sát sao lưu (BACKUP_PING_URL)" || warn "Chưa có BACKUP_PING_URL: sao lưu hỏng sẽ không ai biết"

  say "Truy cập"
  curl -fsS -m 5 http://127.0.0.1:8080/healthz >/dev/null 2>&1 && ok "hrm trả lời (nội bộ)" || bad "hrm không trả lời nội bộ"
  if curl -fsS -m 10 "https://$DOMAIN/healthz" >/dev/null 2>&1; then ok "https://$DOMAIN hoạt động"; else bad "https://$DOMAIN không vào được (DNS? cổng 443? chứng chỉ?)"; fi
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "https://$DOMAIN/auth/v1/health" -H "apikey: $(env_get SUPABASE_ANON_KEY)" || true)
  [ "$code" = "200" ] && ok "API Supabase qua https://$DOMAIN/auth/v1 hoạt động" || bad "API Supabase trả $code"
  end=$(echo | openssl s_client -connect "$DOMAIN:443" -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
  [ -n "$end" ] && ok "Chứng chỉ HTTPS hết hạn: $end (Caddy tự gia hạn)" || warn "Không đọc được chứng chỉ HTTPS"
  # Sê-ri giả: máy chủ trả 403 kèm số sê-ri đã khai; không ghi gì vào database.
  body=$(curl -s -m 10 "http://$DOMAIN/iclock/cdata?SN=HRM-KIEMTRA&options=all" || true)
  case "$body" in
    *"da khai 0 serial"*) bad "Máy chấm công: /iclock tới được qua HTTP nhưng ATTENDANCE_DEVICE_SERIALS đang TRỐNG" ;;
    *"da khai"*) ok "Máy chấm công: /iclock tới được qua HTTP cổng 80 ($(echo "$body" | sed -n 's/.*(\(da khai [0-9]* serial\)).*/\1/p'))" ;;
    *) bad "Máy chấm công: http://$DOMAIN/iclock không trả lời đúng (nhận: $(echo "$body" | head -c 80))" ;;
  esac

  say "Cấu hình còn thiếu"
  missing=0
  for k in VAPID_PUBLIC_KEY VAPID_PRIVATE_KEY ATTENDANCE_DEVICE_SERIALS; do
    [ -n "$(env_get "$k")" ] || { warn "$k trống"; missing=1; }
  done
  smtp=$(grep '^SMTP_HOST=' "$SUPA_DIR/.env" 2>/dev/null | cut -d= -f2-)
  { [ -n "$smtp" ] && [ "$smtp" != "supabase-mail" ]; } || { warn "Chưa cấu hình SMTP (email mã xác minh khi quên mật khẩu)"; missing=1; }
  [ "$missing" = "0" ] && ok "Đủ"
  return 0
}

cmd_cloud_backup() {
  envfile="${1:-}"
  [ -f "$envfile" ] || die "Cách dùng: ./hrm.sh cloud-backup <file>  (file có SUPABASE_DB_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY của Cloud)"
  set -a; . "$envfile"; set +a
  [ -n "${SUPABASE_DB_URL:-}" ] && [ -n "${SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ] || die "File thiếu SUPABASE_DB_URL / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY."
  mkdir -p "$BACKUP_DIR/cloud"
  docker compose run --rm --no-deps -e SUPABASE_DB_URL -e SUPABASE_URL -e SUPABASE_SERVICE_ROLE_KEY \
    --entrypoint node backup /opt/backup/supabase-cloud-backup.mjs /backups/cloud
  echo
  echo "Bản sao lưu Cloud nằm trong $BACKUP_DIR/cloud/. Xoá file khoá Cloud khi xong:  shred -u $envfile"
}

cmd_restore() {
  dir="${1:-}"
  [ -d "$dir" ] || die "Cách dùng: ./hrm.sh restore <thư-mục-sao-lưu>   (vd /opt/hrm-backups/cloud/20261120T150000Z)"
  dir=$(cd "$dir" && pwd)
  [ -f "$dir/COMPLETE" ] || die "Bản sao lưu chưa hoàn tất (thiếu COMPLETE)."
  say "1/3 Database (dừng nếu Supabase đích không trống)"
  sh "$HRM_DIR/restore/restore-db.sh" "$dir"
  say "2/3 File Storage"
  docker compose run --rm --no-deps -v "$dir:/restore:ro" backup restore-storage /restore --url http://api-gw:8000
  say "3/3 Đối chiếu số dòng"
  docker compose run --rm --no-deps -v "$dir:/restore:ro" backup verify /restore
  docker compose restart hrm >/dev/null
  ok "Khôi phục xong. Đăng nhập thử và đối chiếu vài phiếu lương trước khi mở cho người dùng."
}

cmd_wipe_supabase() {
  [ -f "$SUPA_DIR/.env" ] || die "Không thấy $SUPA_DIR/.env."
  users=$(docker exec supabase-db psql -U supabase_admin -d postgres -Atc 'select count(*) from auth.users' 2>/dev/null || echo "?")
  last="(chưa có)"
  [ -f "$BACKUP_DIR/.last-success" ] && last="$(( ($(date +%s) - $(cat "$BACKUP_DIR/.last-success")) / 3600 )) giờ trước"
  cat <<EOF

XOÁ SẠCH toàn bộ dữ liệu Supabase trên VPS này:
  - database ($users tài khoản đăng nhập, mọi bảng HRM)
  - mọi file Storage
Giữ lại: khoá trong $SUPA_DIR/.env, cấu hình HRM, các bản sao lưu trong $BACKUP_DIR.
Bản sao lưu gần nhất: $last.

Dùng khi: diễn tập khôi phục xong, chuẩn bị khôi phục bản cuối lúc chuyển hệ thống.
EOF
  printf 'Gõ  XOA HET  để xác nhận: '
  read -r answer < /dev/tty || answer=""
  [ "$answer" = "XOA HET" ] || die "Đã huỷ."
  # Gỡ container HRM (giữ volume chứng chỉ của Caddy) để mạng supabase_default xoá/tạo lại được.
  docker compose down
  (cd "$SUPA_DIR" && docker compose --profile admin down -v --remove-orphans)
  # Thư mục dữ liệu thuộc user trong container Postgres → xoá bằng một container.
  docker run --rm -v "$SUPA_DIR/volumes:/v" alpine:3.22 sh -c \
    'rm -rf /v/db/data && find /v/storage -mindepth 1 -maxdepth 1 ! -name .gitkeep -exec rm -rf {} +'
  sh "$HRM_DIR/install-supabase.sh"
  docker compose up -d
  ok "Supabase đã trống. Tiếp theo: ./hrm.sh restore <thư-mục-sao-lưu>"
}

cmd_prune_keep() {
  sql="$HRM_DIR/restore/prune-keep.sql"
  [ -f "$sql" ] || die "Không thấy $sql (gói triển khai cũ?)."
  apply=0
  if [ "${1:-}" = "--apply" ]; then
    apply=1
    cat <<EOF

GHI THẬT: xoá mọi nhân viên trừ admin/ceo và "Vượng", cùng dữ liệu phát sinh của họ.
Nên chạy thử trước (./hrm.sh prune-keep) và xem kỹ báo cáo. Bản sao lưu đầy đủ vẫn còn
trong $BACKUP_DIR để khôi phục lại nếu cần.
EOF
    printf 'Gõ  GIU LAI  để xác nhận: '
    read -r answer < /dev/tty || answer=""
    [ "$answer" = "GIU LAI" ] || die "Đã huỷ."
  fi
  docker exec -i supabase-db psql -X -q -U supabase_admin -d postgres -v apply="$apply" -f - < "$sql"
  if [ "$apply" = "1" ]; then
    docker exec supabase-db psql -U supabase_admin -d postgres -c "notify pgrst, 'reload schema'" >/dev/null
    docker compose restart hrm >/dev/null
    ok "Đã thu gọn. Nên sao lưu ngay: ./hrm.sh backup"
  fi
}

cmd_studio() {
  case "${1:-}" in
    on)
      (cd "$SUPA_DIR" && docker compose --profile admin up -d studio meta)
      user=$(grep '^DASHBOARD_USERNAME=' "$SUPA_DIR/.env" | cut -d= -f2-)
      cat <<EOF

Studio đã bật (tốn ~400 MB RAM — nhớ tắt khi xong: ./hrm.sh studio off).
Trên máy bạn mở đường hầm:   ssh -L 8000:127.0.0.1:8000 deploy@<IP-VPS>
rồi vào:                     http://localhost:8000
Tài khoản: $user — mật khẩu: DASHBOARD_PASSWORD trong $SUPA_DIR/.env
EOF
      ;;
    off)
      (cd "$SUPA_DIR" && docker compose --profile admin stop studio meta && docker compose --profile admin rm -f studio meta)
      ok "Đã tắt Studio"
      ;;
    *) die "Cách dùng: ./hrm.sh studio on|off" ;;
  esac
}

command="${1:-}"
[ $# -gt 0 ] && shift
case "$command" in
  status) cmd_status ;;
  up) cmd_up ;;
  deploy) cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  logs) docker compose logs -f --tail 100 "$@" ;;
  backup) docker compose run --rm --no-deps backup once ;;
  cloud-backup) cmd_cloud_backup "$@" ;;
  restore) cmd_restore "$@" ;;
  wipe-supabase) cmd_wipe_supabase ;;
  prune-keep) cmd_prune_keep "$@" ;;
  studio) cmd_studio "$@" ;;
  supabase) cd "$SUPA_DIR" && exec docker compose "$@" ;;
  *) sed -n '2,19p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
