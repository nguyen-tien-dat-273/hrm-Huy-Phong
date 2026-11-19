# Container sao lưu HRM trên VPS: pg_dump 17 + Node (chạy tools/backup/*.mjs) + rclone.
# Gói triển khai chép tools/backup/*.mjs vào ./tools/ cạnh Dockerfile này.
FROM node:22-alpine3.22

RUN apk add --no-cache postgresql17-client rclone curl \
  && pg_dump --version && pg_restore --version && rclone version | head -1

WORKDIR /opt/backup
RUN npm init -y >/dev/null \
  && npm install --omit=dev --no-fund --no-audit pg@8.23.0 \
  && npm cache clean --force

COPY tools/*.mjs ./
COPY backup-loop.sh ./

ENTRYPOINT ["/bin/sh", "/opt/backup/backup-loop.sh"]
CMD ["loop"]
