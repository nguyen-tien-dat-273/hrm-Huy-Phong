#!/bin/sh
# ============================================================================
# Sao lưu HRM trên VPS — chạy trong container `backup` (deploy/vps/compose.yaml).
#
#   loop                     (mặc định) mỗi ngày một lần lúc BACKUP_HOUR giờ Việt Nam
#   once                     sao lưu ngay một lần rồi thoát   (./hrm.sh backup)
#   restore-storage <dir> …  nạp lại file Storage khi khôi phục (storage-restore.mjs)
#   verify <dir>             đối chiếu số dòng database với bản sao lưu
#
# Mỗi lần: kiểm chỗ trống → supabase-cloud-backup.mjs (DB + Auth + Storage, có checksum,
# chỉ hoàn tất khi có COMPLETE) → dọn bản cũ → chép ra ngoài bằng rclone (nếu cấu hình)
# → báo về trang giám sát (nếu cấu hình BACKUP_PING_URL, ví dụ healthchecks.io).
# ============================================================================
set -u
umask 077   # bản sao lưu chứa lương và mật khẩu băm: chỉ chủ sở hữu đọc được

BACKUP_ROOT=/backups
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
KEEP_MIN=3
REMOTE="${RCLONE_REMOTE:-}"
REMOTE_KEEP_DAYS="${BACKUP_REMOTE_KEEP_DAYS:-60}"
HOUR="${BACKUP_HOUR:-2}"
PING="${BACKUP_PING_URL:-}"

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

ping_monitor() { # $1 = "" | /start | /fail ; $2 = nội dung
  [ -n "$PING" ] || return 0
  curl -fsS -m 15 --retry 3 -o /dev/null --data-raw "${2:-}" "${PING%/}$1" || log "Không gửi được tín hiệu tới trang giám sát."
}

db_url() {
  node -e 'const e=encodeURIComponent,v=process.env;process.stdout.write(`postgresql://${e(v.DB_USER||"supabase_admin")}:${e(v.DB_PASSWORD||"")}@${v.DB_HOST||"db"}:${v.DB_PORT||5432}/${e(v.DB_NAME||"postgres")}`)'
}

list_backups() { # mới nhất trước
  ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{8}T[0-9]{6}Z$' | sort -r
}

latest_complete() {
  for d in $(list_backups); do
    if [ -f "$BACKUP_ROOT/$d/COMPLETE" ]; then echo "$d"; return 0; fi
  done
  return 0
}

prune_local() {
  cutoff=$(date -u -d "@$(( $(date -u +%s) - KEEP_DAYS * 86400 ))" +%Y%m%dT%H%M%SZ)
  n=0
  for d in $(list_backups); do
    n=$((n + 1))
    [ "$n" -le "$KEEP_MIN" ] && continue   # luôn giữ ít nhất 3 bản mới nhất
    if awk -v a="$d" -v b="$cutoff" 'BEGIN { exit !(a < b) }'; then
      rm -rf "${BACKUP_ROOT:?}/$d" && log "Đã xoá bản cũ $d (quá ${KEEP_DAYS} ngày)."
    fi
  done
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -name '.incomplete-*' -mtime +0 -exec rm -rf {} + 2>/dev/null
  return 0
}

offsite() {
  d="$1"
  log "Chép bản $d ra ngoài: $REMOTE"
  # Database + kiểm kê: mỗi ngày một thư mục riêng.
  rclone copy "$BACKUP_ROOT/$d" "$REMOTE/db/$d" --exclude "storage/**" \
    --transfers 2 --retries 3 --low-level-retries 10 --stats 0 || return 1
  # File Storage: một bản "gương" chung, chỉ gửi file mới/đổi, không bao giờ xoá ở ngoài.
  if [ -d "$BACKUP_ROOT/$d/storage" ]; then
    rclone copy "$BACKUP_ROOT/$d/storage" "$REMOTE/storage" \
      --transfers 2 --retries 3 --low-level-retries 10 --stats 0 || return 1
  fi
  # Xoá file quá hạn rồi xoá thư mục rỗng (không dùng `delete --rmdirs`: nó cố xoá cả
  # thư mục còn file và báo lỗi).
  rclone delete "$REMOTE/db" --min-age "${REMOTE_KEEP_DAYS}d" || return 1
  rclone rmdirs "$REMOTE/db" --leave-root || return 1
  date -u +%s > "$BACKUP_ROOT/.last-offsite"
  log "Đã chép ra ngoài."
}

run_once() {
  if [ -z "${DB_PASSWORD:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
    log "LỖI: thiếu DB_PASSWORD hoặc SUPABASE_SERVICE_ROLE_KEY (xem .env)."
    return 1
  fi

  # Chỗ trống: ≥ 2 × phần database của bản gần nhất + 1 GiB (file Storage không đổi
  # được hard link nên gần như không tốn thêm).
  last=$(latest_complete)
  need_kb=1048576
  if [ -n "$last" ]; then
    db_kb=$(du -ck "$BACKUP_ROOT/$last"/db-* 2>/dev/null | tail -1 | awk '{print $1}')
    need_kb=$((need_kb + 2 * ${db_kb:-0}))
  fi
  free_kb=$(df -Pk "$BACKUP_ROOT" | awk 'NR==2 {print $4}')
  if [ "$free_kb" -lt "$need_kb" ]; then
    log "LỖI: ổ đĩa còn $((free_kb / 1024)) MiB, cần ít nhất $((need_kb / 1024)) MiB. Không sao lưu để tránh đầy ổ."
    return 1
  fi

  SUPABASE_DB_URL="$(db_url)" BACKUP_DB_SSL=disable \
    node /opt/backup/supabase-cloud-backup.mjs "$BACKUP_ROOT" || return 1

  date -u +%s > "$BACKUP_ROOT/.last-success.tmp" && mv "$BACKUP_ROOT/.last-success.tmp" "$BACKUP_ROOT/.last-success"
  prune_local

  if [ -n "$REMOTE" ]; then
    offsite "$(latest_complete)" || { log "LỖI: sao lưu trên VPS đã xong nhưng CHÉP RA NGOÀI THẤT BẠI."; return 2; }
  else
    log "Chưa cấu hình RCLONE_REMOTE: bản sao lưu CHỈ nằm trên VPS này."
  fi
  return 0
}

do_backup() {
  ping_monitor /start
  out=$(mktemp)
  rcfile=$(mktemp)
  { run_once; echo $? > "$rcfile"; } 2>&1 | tee "$out"
  rc=$(cat "$rcfile")
  if [ "$rc" = "0" ]; then
    ping_monitor "" "$(tail -c 1500 "$out")"
  else
    ping_monitor /fail "$(tail -c 3000 "$out")"
  fi
  rm -f "$out" "$rcfile"
  return "$rc"
}

seconds_until_next() { # tới BACKUP_HOUR giờ Việt Nam (UTC+7)
  now=$(date -u +%s)
  h=$(( (HOUR - 7 + 24) % 24 ))
  t=$(( now - now % 86400 + h * 3600 ))
  [ "$t" -le "$now" ] && t=$((t + 86400))
  echo $((t - now))
}

mode="${1:-loop}"
[ $# -gt 0 ] && shift
case "$mode" in
  once)
    do_backup
    exit $?
    ;;
  loop)
    log "Container sao lưu chạy. Lịch: mỗi ngày lúc ${HOUR}:00 giờ Việt Nam; giữ trên VPS ${KEEP_DAYS} ngày."
    while :; do
      s=$(seconds_until_next)
      log "Lần sao lưu tới sau $((s / 3600)) giờ $((s % 3600 / 60)) phút."
      sleep "$s"
      attempt=1
      while :; do
        do_backup
        rc=$?
        [ "$rc" = "0" ] && break
        # rc=2: bản trên VPS đã có, chỉ khâu chép ra ngoài lỗi → không sao lưu lại cả bản.
        [ "$rc" = "2" ] && { log "Lần sao lưu sau sẽ chép ra ngoài lại."; break; }
        [ "$attempt" -ge 3 ] && { log "Thất bại 3 lần, chờ tới lịch hôm sau."; break; }
        attempt=$((attempt + 1))
        log "Thử lại sau 30 phút (lần $attempt/3)."
        sleep 1800
      done
    done
    ;;
  restore-storage)
    exec node /opt/backup/storage-restore.mjs "$@"
    ;;
  verify)
    DB_URL="$(db_url)"
    export DB_URL
    exec node /opt/backup/verify-counts.mjs "$@"
    ;;
  *)
    echo "Lệnh không hợp lệ: $mode (dùng: loop | once | restore-storage | verify)" >&2
    exit 2
    ;;
esac
