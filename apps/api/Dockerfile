# API image (also the base of the render worker). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t garment-studio/api .
FROM node:22.23.0-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter @gs/api... \
 && pnpm --filter @gs/api build \
 && pnpm --filter @gs/api deploy --legacy --prod /out \
 && cp -r apps/api/dist /out/dist \
 && cd /out && npx prisma generate

FROM node:22.23.0-bookworm-slim AS api
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
# Release step (before traffic shifts): node node_modules/prisma/build/index.js migrate deploy
CMD ["node", "dist/main.js"]
