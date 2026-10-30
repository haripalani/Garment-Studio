# ADR-0017: Observability

- **Status:** Accepted · 2026-10-30

## Decision
- **Errors:** Sentry in editor (web and desktop, with release + source maps), API and worker. PII scrubbing on; no artwork or document contents in events.
- **Traces/metrics/logs:** OpenTelemetry SDK in API and workers → Grafana Cloud (Tempo, Prometheus, Loki). Structured JSON logs (pino) with request id and user id hash.
- **Key metrics and alerts:** API p95 latency and 5xx rate; auth failures; upload failures; sync 409 rate and conflict-copy count; render queue depth, wait time, failure rate, GPU seconds per job; WS connections; DB connections and slow queries; Redis memory.
- **Client RUM:** web-vitals + editor-specific timings (garment load, bake ms per piece, frame time during orbit), sampled at 10 %.
- **Uptime:** synthetic checks on `/health`, login, project save and a tiny render job every 15 min (staging and production).
- Dashboards and runbooks live in `docs/ops/` (written in Stage 12).

## Consequences
Every Stage from 6 on ships with its metrics; no "add monitoring at the end".
