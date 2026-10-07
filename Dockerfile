FROM node:22-alpine AS build

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}

RUN test -n "$VITE_SUPABASE_URL" \
  && test -n "$VITE_SUPABASE_ANON_KEY" \
  && pnpm build \
  && pnpm prune --prod

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app

COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/server/dist/api ./server/dist/api
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --chown=node:node server/index.mjs ./server/index.mjs

USER node

EXPOSE 8080

CMD ["node", "server/index.mjs"]
