# Static editor served by Caddy (staging replica; Cloudflare Pages serves the same dist in production).
#   docker build -f apps/editor/Dockerfile --build-arg VITE_API_URL=/v1 -t garment-studio/editor .
FROM node:22.23.0-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
ARG VITE_API_URL=/v1
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm install --frozen-lockfile --filter @gs/editor... && pnpm --filter @gs/editor build

FROM caddy:2.10.2-alpine AS editor
COPY --from=build /repo/apps/editor/dist /srv
COPY apps/editor/Caddyfile /etc/caddy/Caddyfile
