# Deploying staging (ADR-0016)

The staging **replica** (`infra/staging/`) runs the production images on this machine over HTTPS. The **real** staging deployment needs accounts only the owner can create: billing, legal terms and domains are theirs. Nothing below has been run against those services yet.

## 1. Accounts and resources (owner)
| Service | What to create | Becomes |
|---|---|---|
| Domain | e.g. `garmentstudio.example` with DNS on Cloudflare | `app.staging.…`, `api.staging.…`, `cdn.staging.…` |
| Cloudflare | Pages project (editor); R2 buckets `gs-staging` (private) and `gs-staging-public` (public, custom domain `cdn.staging.…`); R2 API token | `S3_*`, `PUBLIC_ASSET_BASE` |
| Fly.io | App `garment-studio-api-staging`; a ClamAV app (or a ClamAV sidecar machine) | API hosting, `CLAMAV_HOST` |
| Neon | Project `garment-studio`, branch `staging` | `DATABASE_URL` |
| Upstash | Redis database (TLS) | `REDIS_URL` (`rediss://…`) |
| Postmark | Server with a verified sending domain (SPF, DKIM, DMARC) | `SMTP_URL`, `MAIL_FROM` |
| GPU (cloud renders) | RunPod (ADR-0013) or any NVIDIA GPU host running `apps/api/Dockerfile.worker` | render worker |
| GitHub | Repository secrets for deploys: `FLY_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | CI/CD |

## 2. API (Fly.io)
1. Create the API app:
   ```bash
   fly apps create garment-studio-api-staging
   ```
2. Set every secret listed in `infra/fly/api.staging.toml` with `fly secrets set …`.
   - `JWT_PRIVATE_JWK` and `IP_HASH_SECRET` come from:
     ```bash
     corepack pnpm --filter @gs/api keys
     ```
   - `S3_PUBLIC_ENDPOINT` is the R2 endpoint browsers use for uploads.
3. Deploy. The release command runs `prisma migrate deploy` before traffic moves.
   ```bash
   fly deploy -c infra/fly/api.staging.toml
   ```
4. Seed once:
   ```bash
   fly ssh console -C "sh -c 'SEED_PUBLISH_DEV=true node dist/seed.js'"
   ```
   This publishes the development garment until real garments exist.
5. Check the API:
   ```bash
   curl https://api.staging.…/v1/health
   ```
   Expect `database`, `redis`, `storage` and `antivirus` all `ok`.

## 3. Editor (Cloudflare Pages)
- **Build command:**
  ```bash
  corepack pnpm install --frozen-lockfile && corepack pnpm --filter @gs/editor build
  ```
- **Output directory:** `apps/editor/dist`.
- **Environment:** `VITE_API_URL=https://api.staging.…/v1`.
- **SPA fallback:** add `apps/editor/public/_redirects` with `/* /index.html 200` when Pages is set up.

## 4. Storage (R2)
- The API sets the private bucket's CORS policy at start (the app origin, GET/PUT/HEAD, `ETag` exposed). Confirm in the R2 dashboard that it applied.
- Add a lifecycle rule to delete `x/` (data-export ZIPs) after 7 days.

## 5. Render worker (GPU)
- **Image:** `docker build -f apps/api/Dockerfile.worker -t garment-studio/render-worker .`, then push it to the GPU host's registry.
- **Settings:** the API's environment, plus `RUN_WORKERS=false`, `RENDER_PROFILE_DIR` on a persistent volume, and `RENDER_CHROMIUM_ARGS` for the GPU (Linux NVIDIA: start with `--use-angle=vulkan`).
- **Start-up check:** the worker logs `GPU: …` when it starts. It must name the NVIDIA GPU, not SwiftShader.

## 6. Verify staging
- **Browser tests:** run the editor E2E suite against staging, with `baseURL` set to the staging app and the cloud tests pointed at a staging inbox. Mail-reading tests need Mailpit or Postmark's API.
- **Manual checks:**
  - sign up and confirm the email (real email)
  - save on one device, open on another
  - a cloud render
  - an export over quota on the free plan

## Staging replica (this machine)
1. Write fresh secrets:
   ```bash
   node infra/staging/make-env.mjs
   ```
2. Build and start:
   ```bash
   docker compose -f infra/staging/compose.yaml --env-file infra/staging/.env up -d --build
   ```
3. Open https://gs.localhost:8443. Caddy uses a local certificate: accept it, or trust Caddy's root certificate.
4. Emails: http://localhost:58125. The GPU worker is opt-in: add `--profile gpu` and set `RENDER_CHROMIUM_ARGS`.
