# API Discovery

Scope: only requests the page made by itself while signed out, plus public static config. Nothing was replayed or fuzzed. No login was attempted and no private endpoints were probed. Keys and tokens are intentionally left out of this document.

## 1. Observed endpoints

| Method | URL | Purpose (observed or inferred) | Auth |
|---|---|---|---|
| GET | `/app/` | App HTML (inline app script, about 480 KB) | none |
| GET | `/config.js` | Public runtime config: Supabase URL, anon key, Paddle env, client token, price ids | none |
| GET | `/plans.js` | Plan tiers, limits, packs, garment-tier rules | none |
| GET | `/app/garments/garments.js` | Garment manifest (id, localised name and cut, defaults, flags: relief, new, plan, material, group, camFit, early) | none |
| GET | `/app/garments/{id}/model.bin` | Garment mesh, custom binary | none |
| GET | `/app/garments/{id}/normal.jpg`, `knitmask.png`, `thumb.webp` | Per-garment baked normal, knit mask, thumbnail | none |
| GET | `/app/textures/studio.hdr` | Studio HDRI (RGBE) | none |
| GET | `/app/textures/{wrinkles_normal,knit_normal}.jpg`, `/fabric/band_cotton_normal.jpg` | Fabric detail maps | none |
| GET | `/app/defaults/{front,sleeve,inside-label}.png` | Sample artwork | none |
| GET | `/app/vendor/three.module.js`, `jsm/*` | three.js plus addons | none |
| GET | `/app/gobos-holiday.js` | Seasonal gobo set | none |
| GET | `/app/fonts/*.woff2`, `fonts.css` | Self-hosted font families | none |
| GET | `/app/site/{supabase,account}.js`, `account.css` | Auth client and account UI | none |
| GET | `/api/geo` | Geo/country lookup (likely for pricing currency or consent) | none |
| POST | `/cdn-cgi/rum` | Cloudflare Web Analytics | none |
| 3rd-party | `cdn.paddle.com`, `profitwell.com`, `googletagmanager.com`, `connect.facebook.net` | Billing, retention, analytics | – |

## 2. Inferred backend (Supabase), not accessible

- Supabase Auth: email/password, magic link, password recovery.
- Postgres functions mentioned in public comments: `public.plan_limits()` (render_px, render_qualities, local_render, quotas) and `public.credit_packs`.
- Storage for artwork, project thumbnails and cloud renders (quota by plan, 30-day grace).
- Paddle webhooks → entitlement tables (inferred).
- Cloud render jobs (path-traced, "passes") with a credit counter ("0 of 0 cloud renders left this month").

## 3. Limitations
- No authenticated traffic was observed, so project CRUD, render job endpoints, upload endpoints and their request/response shapes are **unknown**.
- Our API (in TECHNICAL_ARCHITECTURE.md §5) is therefore an **independent design** meeting the same product needs, not a clone of their API.
- Original project files are not accessible. Importing projects from the reference is **not feasible** unless the vendor offers an export. Users can re-upload their source artwork.
