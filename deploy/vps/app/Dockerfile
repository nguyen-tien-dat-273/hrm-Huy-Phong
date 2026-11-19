# Image chạy HRM trên VPS từ bản ĐÃ DỰNG SẴN trên máy dev (tools/vps/make-bundle.mjs).
# VPS nhỏ không chạy `pnpm build` (eslint + tsc + vite ngốn 1–2 GB RAM, dễ làm Postgres
# bị giết vì hết bộ nhớ). Ở đây chỉ cài thư viện chạy (--prod) rồi chép kết quả build.
#
# Thư mục này trong repo chỉ có Dockerfile; gói triển khai chép thêm vào:
#   package.json, pnpm-lock.yaml, client/dist/, server/index.mjs, server/dist/api/
FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@10.28.0 --no-fund --no-audit \
  && pnpm install --prod --frozen-lockfile --ignore-scripts \
  && pnpm store prune \
  && npm uninstall -g pnpm \
  && rm -rf /root/.cache /root/.npm /root/.local/share/pnpm

COPY --chown=node:node client/dist ./client/dist
COPY --chown=node:node server/dist/api ./server/dist/api
COPY --chown=node:node server/index.mjs ./server/index.mjs

RUN test -f client/dist/index.html && test -f server/dist/api/iclock/cdata.js

USER node

EXPOSE 8080

CMD ["node", "server/index.mjs"]
