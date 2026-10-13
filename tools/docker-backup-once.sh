#!/bin/sh
set -eu
umask 077

backup_root="${BACKUP_DIR:-/backups}"
retention_days="${RETENTION_DAYS:-30}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
work_dir="$backup_root/.incomplete-$timestamp-$$"
final_dir="$backup_root/$timestamp"

mkdir -p "$backup_root"
mkdir "$work_dir"
trap 'rm -rf "$work_dir"' EXIT HUP INT TERM

pg_dump --format=custom --no-owner --no-acl --file="$work_dir/database.dump"
tar -czf "$work_dir/storage.tar.gz" -C /supabase-storage .
(cd "$work_dir" && sha256sum database.dump storage.tar.gz > SHA256SUMS)
printf 'completed_at=%s\n' "$timestamp" > "$work_dir/COMPLETE"
mv "$work_dir" "$final_dir"
trap - EXIT HUP INT TERM

date -u +%s > "$backup_root/.last-success.tmp"
mv "$backup_root/.last-success.tmp" "$backup_root/.last-success"
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '20*T*Z' -mtime "+$retention_days" -exec rm -rf {} +

echo "Backup completed: $final_dir"
