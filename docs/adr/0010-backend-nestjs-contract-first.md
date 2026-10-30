# ADR-0010: NestJS REST + WebSocket, contract-first OpenAPI

- **Status:** Accepted · 2026-10-30

## Decision
- `apps/api` on NestJS 11 (Fastify adapter). Modules: auth, users, settings, projects, assets, garments, renders, exports, entitlements, billing (adapter), audit, health.
- **Contract-first:** `architecture/openapi.yaml` is the source of truth during Stage 2. From Stage 6, DTOs are zod schemas in `packages/core` and the spec is generated (nestjs-zod) and diffed in CI against the committed spec (breaking-change check with oasdiff). The client is generated into `packages/api-client`.
- Errors follow **RFC 9457 problem+json** with a stable `code`.
- Pagination is cursor-based (`?cursor=&limit=`).
- Idempotency: `Idempotency-Key` header on POSTs that create jobs or charge credits.
- WebSocket (Socket.IO-free, plain `ws` gateway) at `/v1/ws`, authenticated with the access token; events `render.progress`, `render.finished`, `project.updated`, `entitlements.changed`.
- Rate limiting: Redis token bucket per IP and per user, with route classes (auth: 10/min, write: 120/min, read: 600/min, render create: 10/min).

## Consequences
Breaking API changes need a new `/v2` path or an additive change; CI blocks accidental breaks.
