# ADR-0014: Content-addressed assets on S3-compatible storage (Cloudflare R2) with scanning

- **Status:** Accepted · 2026-10-30

## Decision
- Bucket layout: `u/{userId}/a/{sha256}` (user assets), `r/{userId}/{jobId}/…` (render outputs), `g/{modelId}/{version}/…` (garments, public via CDN), `t/{projectId}/{revision}.webp` (thumbnails).
- Upload: `POST /v1/assets/uploads` with sha256, size and mime → if the asset already exists for the user, return it (dedupe) → otherwise presigned **multipart** PUT URLs (resumable) → `POST /v1/assets/{id}/complete`.
- Validation: allowlist (PNG, JPEG, WebP, AVIF, SVG, PDF; AI via its PDF compatibility stream), max 50 MB (raster dimensions ≤ 12 000 px), magic-byte sniffing, an SVG sanitiser (no scripts, external refs or foreignObject), ClamAV scan queue. Assets are `pending` until clean; private reads are short-TTL presigned GETs.
- Garment assets are public, immutable and cached for a year on the CDN.
- Garbage collection: assets with no `ProjectAsset` refs and no render refs for 30 days are deleted (job).

## Consequences
Zero-egress R2 keeps render downloads cheap; the S3 API keeps us portable (MinIO in development).
