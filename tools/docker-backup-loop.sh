#!/bin/sh
set -eu

while true; do
  if /bin/sh /backup/backup-once.sh; then
    sleep 86400
  else
    echo "Backup failed; retrying in 5 minutes." >&2
    sleep 300
  fi
done
