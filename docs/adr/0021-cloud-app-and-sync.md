# ADR-0021: Cloud app and sync implementation (amends ADR-0009, ADR-0011, ADR-0016)

- **Status:** Accepted · 2026-10-31 (Stage 8)

## Decisions

1. **Local library on idb-keyval, not Dexie (amends ADR-0009).**
   - One IndexedDB store holds every design with its sync bookkeeping: the last cloud revision, the document at that revision (the merge base), `dirty`, owner and conflict link.
   - It is a small key-value need, so no extra database layer was added.
   - The Stage 4–7 single working copy is migrated once. The migration is deterministic, so running it twice can't create copies.

2. **IDs are created on the device and valid in the cloud.** `newId()` makes 24-character lowercase IDs (`/^[a-z0-9]{20,32}$/`), so designs created offline keep their ID when uploaded. Images are keyed by content (`a` + SHA-256 prefix), so they have the same ID on every device.

3. **Sync engine** (`apps/editor/src/cloud/sync.ts`):
   - **Push:** after each local save, upload missing images (presigned, deduplicated by hash), then create the project or push a revision with `baseRevision` and the canonical-JSON `docSha256`.
   - **Pull:** on focus, on reconnecting, on a live `project.updated` event from another device, and every 60 s. A conditional GET (`If-None-Match: "r{rev}"`) makes "no change" cheap.
   - **Merge** (`mergeDocs` in `packages/core`):
     - Three-way, per layer ID and per look section (fabric, light, scene).
     - Stacking order goes to whichever side reordered.
     - Additions are placed next to their neighbours.
     - Both sides changing the same thing, or a delete against an edit, is a **conflict**: the cloud version stays, and this device's version is saved as **"‹name› (conflicted copy)"** with `conflictOf` set.
   - **Cloud changes in the editor** arrive as **one undoable step** (`useDoc.replace`), never as a silent reload.
   - **Ordering:** one operation at a time per design. A drag or typing gesture is pushed when it ends.

4. **Auth in the browser.**
   - The access token lives in memory; refresh uses the HttpOnly cookie plus the CSRF header.
   - Refreshes are serialised across tabs with the **Web Locks API**, so tabs never trip refresh-token reuse detection.
   - Refresh moved from the strict sign-in rate class (10/min per IP) to the write class: every page load in every tab refreshes, and offices share IPs.
   - The sign-in limit is configurable (`RATE_AUTH_PER_MIN`, default 10).
   - A refresh that fails for a temporary reason (network, 429, 5xx) means "offline", not "signed out".

5. **Plans in the editor.**
   - Exports are recorded (`POST /exports`) **before** the file is built, so a used-up quota stops them. Offline exports are queued and reported later.
   - Free-plan watermarks: added by the client for local renders, snapshots and video, and by the **server** (render worker) for cloud renders.
   - Signed-out use stays unlimited and local (product decision pending, D3).

6. **Deployment shape.**
   - Three images: API (Node, also runs migrations and the seed), render worker (Playwright Chromium + the built editor) and editor (Caddy static, or Cloudflare Pages).
   - `S3_PUBLIC_ENDPOINT` signs browser URLs for the address browsers use, separate from the API's internal storage address.
   - `COOKIE_DOMAIN` lets `app.` and `api.` subdomains share the readable CSRF cookie.
   - The **staging replica** (`infra/staging`) runs the production images behind one HTTPS origin (Caddy), path-routed `/v1` to the API, plus a storage host.

7. **Local http development uses non-Secure cookies** (`COOKIE_SECURE=false` in the dev `.env` only). WebKit won't store Secure cookies on `http://localhost`. Production refuses `false` (config check), and the API tests assert the production flags.

## Consequences
- Real-time co-editing remains out of scope. Simultaneous edits to the same layer produce a conflicted copy rather than a live merge.
- The real staging deploy is configuration plus the owner's accounts (see `infra/DEPLOY.md`).
