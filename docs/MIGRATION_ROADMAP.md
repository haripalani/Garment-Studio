# Migration Roadmap

## Decisions (all resolved 2026-10-30: recommendations approved → ADR-0002, 0007, 0012, 0004, 0013, 0015)
| ID | Decision | Recommendation |
|---|---|---|
| D1 | **Brand and visual identity.** The reference's name, logo, artwork, garment renders and copy can't be reused. Matching its exact look for a competing product also carries trade-dress risk. | Keep the layout, density and interaction model; use our own name, logo and accent colour; tokens otherwise as measured |
| D2 | **Garment 3D assets.** The reference meshes are proprietary. We need our own cut-and-sewn models (CLO3D / Marvelous Designer) with UV islands matching pattern pieces. | Commission or author 3 launch garments (tee flat, tee on body, hoodie), then expand. A procedural fallback is for development only. |
| D3 | **Subscriptions and billing.** The reference has Free/Basic/Pro/Ultra plus credit packs via Paddle. | Build entitlement checks behind an adapter from day 1; decide plan numbers and provider later |
| D4 | **Editor framework.** Vite SPA (recommended) vs Next.js as in the brief. | Vite SPA for the editor, Next.js for the site (see TECHNICAL_ARCHITECTURE §2) |
| D5 | **Cloud GPU provider** for path-traced renders | Start with an autoscaled pool on RunPod or AWS g6; behind a queue adapter |
| D6 | **Languages at launch** (reference: EN/FR/ZH/RU) | EN first, i18n keys from day 1 |

## Stages (each ends at an approval gate)
| # | Stage | Main outputs | Est. effort* |
|---|---|---|---|
| 1 | Discovery | These 12 docs and screenshots | done |
| 2 | Architecture sign-off | Final stack, OpenAPI v1 draft, Prisma schema, infra diagram, ADRs | 1 wk |
| 3 | Design system and shell | `packages/ui`, tokens, header, stages, inspector, modals, tour, light/dark, i18n scaffold; visual diff vs the reference layout | 2–3 wk |
| 4 | 2D editor | engine-2d: pieces, rulers, units, zoom/pan, select/move/scale/rotate, image/text/shape layers, crop and trim, colour adjust, gradients, outlines, layers, presets, align, inside/outside, seam wrap, undo/redo, clipboard, shortcuts | 6–8 wk |
| 5 | 3D engine | Garment loader, texture baking worker, materials (9), wrinkles/AO/knit, key light, HDRI, backdrop and gobos, hanger, neck labels, camera presets, adaptive quality, snapshot; garment-tools CLI | 6–8 wk (+ asset production in parallel) |
| 6 | Backend | Auth, users, settings, projects, versions, assets (presign + scan), garments API, rate limits, audit | 4–5 wk |
| 7 | Rendering and export | Path-trace local render, render modal, BullMQ GPU worker, progress over WS, cancel/retry; print ZIP, sublimation ZIP, spec PDF, turntable video, PNG/WebP/transparent | 5–6 wk |
| 8 | Cloud app on staging | Integration, sync engine and conflict UI, project browser, autosave, staging deploy | 3 wk |
| 9 | PWA | Manifest, icons, splash, SW caching strategy, offline launch, offline-edit and sync tests | 1–2 wk |
| 10 | Desktop | Tauri 2 shell, native file import/export, deep-link auth, keychain, updater, signing (Win Authenticode, macOS notarisation), MSI/NSIS + DMG | 2–3 wk |
| 11 | Integration | End-to-end matrix web × PWA × desktop, parity matrix verification | 2 wk |
| 12 | Production | Security review, load tests, runbooks, backups and restore drill, release | 2 wk |

\*One senior full-stack engineer plus one 3D/graphics engineer. Garment asset production is separate (a 3D artist; roughly 1–2 weeks per garment family for quality meshes and pattern data). **Total: about 8–10 months** to production-grade parity on the accessible feature set.

## Top risks
| Risk | Impact | Mitigation |
|---|---|---|
| Garment asset quality and availability | Critical: the 3D view's realism depends on it | Start asset production in Stage 2; define the GarmentModel contract early; validate with garment-tools |
| Pattern ↔ UV accuracy | Prints misplaced on the sewn garment | True-scale UV export from CLO/MD; automated checks (piece area vs UV area ratio) |
| Path-trace performance on weak GPUs | Slow or failed local renders | Adaptive samples, tiling, cloud fallback |
| Headless GPU in the cloud | Infra complexity and cost | Containerised Chromium + EGL on GPU nodes; spot instances; queue back-pressure |
| Sync conflicts | Data loss | Revisioned writes, 409 + merge + conflicted copy, never overwrite |
| Trade dress / IP | Legal | D1, D2; no reference code, assets or copy |
| Scope (12 stages, 3 platforms) | Schedule | Strict gates; parity matrix as the backlog |
