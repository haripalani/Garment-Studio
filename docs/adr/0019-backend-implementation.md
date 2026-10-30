# ADR-0019: Backend implementation choices (amends ADR-0010, ADR-0011, ADR-0014)

- **Status:** Accepted · 2026-10-30 (Stage 6)

## Context
Stage 6 built `apps/api` against real Postgres, Redis, S3-compatible storage, SMTP and ClamAV. Building and testing it changed or settled these details.

## Decisions

1. **Contract tests instead of a generated spec (amends ADR-0010).** Request DTOs are zod schemas in `packages/core/src/api.ts`, shared with clients. `architecture/openapi.yaml` stays hand-written. The integration test client checks **every response** against it: an undocumented status or a body that breaks the schema fails the test. In Stage 6 this found 6 specific gaps. It also led to a sweep that documented the shared 401, 422 and 429 responses on every operation. Generating the spec (nestjs-zod) and diffing it in CI (oasdiff) is deferred to the CI setup, once there is a remote repository.

2. **Explicit `@Inject()` tokens on every constructor.** No reliance on `emitDecoratorMetadata`, so tsx, esbuild and Vitest all run the app without SWC. The production build is one esbuild bundle (`dist/main.js`) with workspace packages inlined.

3. **Sessions (refines ADR-0011).**
   - One `Session` row per issued refresh token; rotations share a `familyId`. The access token carries the family as `sid`.
   - Rotation is a compare-and-set, so two concurrent refreshes cannot both succeed.
   - Presenting a rotated or revoked token revokes the whole family.
   - Revocation also writes a Redis deny-list entry (TTL = access-token lifetime), so access tokens die immediately on logout, reset, reuse or account deletion.
   - `authAt` (last real sign-in) is carried across rotations. Magic-link-only accounts need `authAt` within 10 minutes for sensitive changes.
   - Clients must send refreshes one at a time (single-flight across tabs); otherwise reuse detection signs them out. This is a Stage 8 client requirement.

4. **CSRF:** double-submit token (readable `gs_csrf` cookie, matching `X-CSRF-Token` header), plus an Origin allow-list, on cookie-authenticated refresh. The refresh cookie is `HttpOnly; Secure; SameSite=Lax; Path=/v1/auth`.

5. **Desktop PKCE.** Added `POST /auth/desktop/code`: a signed-in browser mints a 2-minute, single-use code bound to the app's S256 challenge, then redirects to `garmentstudio://auth/callback?code=…`. The app exchanges the code and verifier at `/auth/desktop/token`. Browser sign-in endpoints refuse `platform: desktop`.

6. **Storage (amends ADR-0014).**
   - **Two buckets:** private (user files) and **public** (garment files). R2 grants public access per bucket, not per prefix.
   - User keys are `u/{ownerId}/{kind}/{sha256}`, because the same bytes can be both artwork and a thumbnail.
   - **Locally SeaweedFS replaces MinIO**: MinIO stopped publishing images.

7. **Scanning order and SVG policy (amends ADR-0014).**
   - The scan job runs: SHA-256 check → **antivirus first** (so malware is always reported as such) → magic-byte type check → raster size (≤ 12 000 px) → SVG rules.
   - Unsafe SVGs (scripts, foreignObject, event handlers, external references, entities) are **rejected rather than sanitised**. Changing the bytes would break content addressing.
   - Downloads are presigned with `Content-Disposition: attachment`.

8. **Email verification gates cloud saves.** Project create, push and duplicate return `403 email_unverified` until the address is confirmed (ADR-0011).

9. **Account deletion.**
   - The email is released immediately (renamed to `deleted-{id}@deleted.invalid`), so the person can sign up again.
   - Data and files are purged by the hourly maintenance job after 30 days.

## Consequences
- Contract drift is caught by tests now, not by CI tooling yet.
- OAuth (Google/Apple) answers `501 oauth_not_configured` until the owner creates provider credentials.
