# Stage 6 Report: Backend

- **Status:** awaiting approval
- **Date:** 2026-10-30
- **Decisions:** ADR-0019 (amends ADR-0010, 0011, 0014)

## What was built

### `apps/api`: NestJS 11 on Fastify (ADR-0010)
- 46 operations under `/v1`.
- Errors are RFC 9457 `problem+json` with a stable `code` and a `requestId`.
- Cursor pagination, `Idempotency-Key` on creating POSTs, and Redis token-bucket rate limits:
  - auth: 10/min per IP
  - write: 120/min per user
  - read: 600/min per user
  - `RateLimit-*` and `Retry-After` headers
- Helmet security headers (CSP `default-src 'none'`), and CORS with credentials for allow-listed origins only.
- Config is validated at startup and fails fast, naming each bad variable. Production refuses antivirus off or insecure cookies.

### Authentication and accounts (ADR-0011, ADR-0019 §3–5)
- **Sign-in methods:**
  - Email and password (argon2id, 64 MB, t=3).
  - Magic link (15 min, single use; creates a verified account on first use).
  - Email verification and password reset (30 min; revokes every session).
  - Optional breached-password check (Have I Been Pwned, k-anonymity).
- **Lockout:** 15 minutes after 5 failures. Unknown emails take the same time and get the same answer as wrong passwords.
- **Tokens:**
  - Access tokens are EdDSA JWTs (10 min); `/auth/jwks` publishes the key.
  - Refresh tokens rotate, and reuse detection revokes the whole family.
  - Revocation takes effect immediately through a Redis deny-list.
- **Web sessions:** `HttpOnly; Secure; SameSite=Lax` refresh cookie on `/v1/auth`, plus CSRF double-submit and an Origin check.
- **Desktop:** PKCE flow. The browser mints a code, and the app exchanges it with its verifier, keeping the refresh token itself (for the OS keychain in Stage 10).
- **Account:**
  - Profile; email change (confirmed from the new inbox); password change (signs out other devices).
  - Settings (look defaults validated with the document's own schema).
  - Sessions list and revoke.
  - Deletion: password or recent sign-in required; signs out everywhere; purged after 30 days.
  - Data export: a ZIP of the account, every project revision and the original files, emailed as a 7-day link, once per hour.
- Security audit log with keyed-hash IPs.

### Projects and versions (ADR-0009)
- **Writes:**
  - Create (optional client id for offline-created work) and push revisions with **optimistic concurrency**. The head moves only from the current revision, in one compare-and-set statement.
  - A stale push gets `409` with the head document for a three-way merge. Of 5 concurrent pushes, exactly 1 wins.
  - `docSha256` over canonical JSON (shared `canonicalJson` in `packages/core`) verifies the document end to end.
- **Validation:**
  - Documents are validated with the editor's own zod schema; v1 documents are migrated.
  - Limit is 2 MB (413). Referenced images must already be uploaded (`asset_missing`).
  - Garment model and plan tier are checked.
- **Read and manage:**
  - ETag / `304`.
  - Version history with cursor pagination; any revision is retrievable.
  - Rename, trash and restore (30 days), sync pull with tombstones (`updatedSince`), duplicate, thumbnails.
- Saving to the cloud requires a confirmed email.

### Assets (ADR-0014, ADR-0019 §6–7)
- **Uploads:**
  - Files go **straight from the client to storage** with presigned multipart URLs (5 MiB parts, 15 min).
  - Resumable: list finished parts, re-issue URLs.
  - Deduplicated by SHA-256.
  - 50 MB limit; type allow-list (PNG, JPEG, WebP, AVIF, SVG, PDF/AI).
- **Scan job** (BullMQ, retried with backoff), each check in this order:
  - SHA-256 of the stored bytes
  - **ClamAV** antivirus
  - magic-byte type check
  - raster ≤ 12 000 px
  - SVG safety rules
- Rejected files are deleted. Downloads are 5-minute presigned `attachment` URLs, only once clean.

### Garments, entitlements, billing, health
- **Garments:** public catalogue and manifests (`Cache-Control`; versioned manifests are `immutable`). The thumbnail is drawn from our own pattern pieces and served from the public bucket. The development tee is seeded.
- **Entitlements engine:** plans are data (`dev` = no limits, `free` = test limits), with usage counts and a ledger. `402` carries `limit`/`used`. The Ed25519-signed offline snapshot lasts 24 h. Admins assign plans manually (ManualProvider).
- **Billing:** plans list (empty); checkout, portal and webhooks answer `501 billing_disabled` until pricing and a provider are decided (D3).
- **Health:** database, Redis, storage and antivirus (antivirus down = `degraded`, still serving).
- **Hourly maintenance job:**
  - purges accounts deleted more than 30 days ago (rows and files)
  - empties trash older than 30 days
  - garbage-collects unreferenced files after 30 days
  - aborts uploads left incomplete for 24 h
  - prunes expired tokens and sessions

### Local infrastructure (`infra/dev/compose.yaml`)
Postgres 17, Redis 7, SeaweedFS (S3), Mailpit, ClamAV 1.4, all on offset ports bound to `127.0.0.1`. SeaweedFS telemetry is turned off.

## Verification

| Check | Result |
|---|---|
| Typecheck, all 7 packages (`apps/api` incl. tests) | ✅ 0 errors |
| **API integration** (real Postgres/Redis/S3/SMTP/ClamAV over HTTP) | ✅ **75 / 75** (61 integration + 14 unit). Three consecutive full runs green (74 in the first two, before 1 test was added) |
| **Contract:** every response in those tests validated against `openapi.yaml` (status documented + body schema) | ✅ **46 / 46** implemented operations exercised, 93 distinct operation + status pairs. The other 8 spec operations (renders, exports, `/ws`) are Stage 7 |
| Unit (other packages) | ✅ **82**: core 16 (+1 canonical JSON), engine-2d 26, engine-3d 11, ui 6, editor 23 |
| `openapi.yaml` (Redocly recommended + project rules) | ✅ valid, 0 warnings |
| Production bundle (`dist/main.js`) started standalone | ✅ `/v1/health` ok |
| Editor E2E | not re-run: no editor code changed in this stage (core gained new exports only) |

**Integration coverage:**
- **Auth (27):**
  - cookie flags; lockout; per-IP rate limit
  - CSRF and Origin; rotation; reuse detection; concurrent refresh; logout; remember-me
  - session list and revoke; tampered tokens; JWKS
  - email verify, resend, magic link, reset; per-address email budget; expired tokens
  - PKCE; OAuth 501
  - profile, email and password change; settings; account deletion; recent-auth rule
- **Projects (18):**
  - verification gate; create; client ids; v1 migration; validation paths; 413
  - `asset_missing`; ETag; stale push 409; hash mismatch; concurrent pushes
  - version pagination; idempotency; trash, restore and tombstones; list pagination and search
  - duplicate; cross-user isolation; plan limits and admin assignment
- **Assets (12):**
  - presigned upload → clean → download hash match; 12 MB 3-part upload
  - dedupe; resume; 415 and 413; type spoofing; SHA-256 lie; size mismatch
  - clean SVG and scripted SVG; **EICAR caught by ClamAV**
  - private bucket and cross-user 404; images and thumbnails in projects
- **System (8):** health; problem+json; security headers and CORS; garment catalogue and public bucket; snapshot verification; billing 501 (checkout, portal, webhook); data-export ZIP contents; maintenance purge.
- **Unit (14):** sniffing; SVG rules (including self-closing tags); SVG size; raster limit; part size; HIBP k-anonymity (prefix only, fail-open); config fail-fast and production rules.

## Defects found and fixed during Stage 6

| # | Finding | Found by | Fix |
|---|---|---|---|
| 1 | SVG safety check missed self-closing `<foreignObject/>`, `<script/>`, `<iframe/>` | unit test | Patterns accept `/` after the tag name |
| 2 | A malware file could be reported as "wrong type" (EICAR fails the type check first) | ClamAV probe | Antivirus runs before content rules; the test asserts the malware reason |
| 3 | Oversized documents returned 422 (validation ran before the size check) | integration | Size checked on the raw input first (also cheaper) |
| 4 | Idempotency-key reuse body broke the `ValidationProblem` contract | contract check | `errors` array added |
| 5 | 6 responses the API really returns were undocumented (`use_pkce` 400, `invalid_cursor` 400, magic-link 422, `DELETE /me` 422, desktop refresh body shape, admin route); the shared 401/422/429 were missing on most operations | contract check | Spec revised (draft.2), lint clean |
| 6 | Prisma errors inside Vitest's module runner crash on a source-map bug, hiding the real error | test setup | Setup checks state instead of catching Prisma errors |
| 7 | MinIO images no longer published; SeaweedFS can't make one prefix public | environment | SeaweedFS plus a separate public bucket (matches how R2 public access works) |
| 8 | SeaweedFS sends usage telemetry by default | log review | `-master.telemetry=false` |

## Not done / limitations (transparent)
- **Google / Apple sign-in:** endpoints answer `501 oauth_not_configured`. They need OAuth client credentials from your Google Cloud and Apple Developer accounts (owner action), then implementation and testing against the real providers.
- **The editor is not connected to the API yet.** Sign-in UI wiring, cloud save, sync engine and conflict UI are Stage 8. Client requirement noted: refreshes must be single-flight across tabs (ADR-0019 §3).
- **WebSocket events** (`/ws`: render progress, `project.updated`) come with rendering (Stage 7) and sync (Stage 8).
- **Renders and exports endpoints** are Stage 7. The usage ledger they will charge is in place.
- **Billing:** no provider until pricing is decided (D3).
- **CI:** no generated spec diff (oasdiff), no GitHub Actions (no remote repository yet).
- **Breached-password check:** implemented and unit-tested with a stubbed service, off in local `.env`. It calls an external service, so turning it on is your call (recommended for staging and production).
- **Export ZIPs:** built in memory (fine at the 50 MB per file limit with modest counts; streaming for very large accounts later). Old export ZIPs (`x/`) should be removed by a storage lifecycle rule (7 days), configured with the staging bucket.
- **Not tested here:** real email deliverability (SPF/DKIM, Stage 8 staging); behaviour under load (Stage 12).
- `corepack pnpm typecheck` through Turbo fails on this machine ("cannot find package manager binary", pnpm only via Corepack). Each package's typecheck passes when run directly.
- Nothing is committed to git.
