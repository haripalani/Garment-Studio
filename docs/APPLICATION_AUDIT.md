# Application Audit: BlankBuilder (reference)

- **Reference:** https://blankbuilder.app/app/ (v1.5.1)
- **Audited:** 2026-10-30, signed out, in a Chromium browser pane at 1440×900, 1024×768 and 375×812
- **Method:** manual walkthrough, DOM and accessibility-tree inspection, and passive network observation of what the page requests on its own. No authentication bypass, no account creation, no requests to private endpoints.
- **Screenshots:** `docs/screenshots/` (19 files, listed at the end)

## 1. What the product is

BlankBuilder is a browser-based **apparel mock-up and print-file tool**. A user:

1. picks a garment model (T-shirt, polo, hoodie, long sleeve, jersey, gloves, pants)
2. places images, text and shapes on the garment's **real sewing-pattern pieces**, sized in physical units
3. sees a **live 3D preview** of the sewn garment with those prints mapped onto it
4. styles the fabric (colour, gradient, knit material, wrinkles) and the studio scene (HDRI, backdrop, light gobos, hanger, neck label)
5. exports print-ready files per piece, sublimation panels, a spec sheet, 3D snapshots, path-traced "catalogue renders" and turntable videos

The editor is a desktop-only, single-page app. On a phone it shows a "send me the link" gate with a small 3D teaser.

## 2. Workspace anatomy (1440×900, dark theme)

| Region | Size | Contents |
|---|---|---|
| Header | full width × 56 px | Exit, logo, version, document name and cut, **view mode** (Sewing pattern / Split / 3D), theme toggle, Quick tour, language (EN/FR/中文/RU), Undo/Redo, New / Your files / Save, 3D snapshot, Export split-button, Log in |
| Pattern stage | flex 1 (560 px) | Header ("Sewing pattern", piece count, Outside/Inside), rulers, dot grid, pattern pieces, floating **tool rail** (Select, Hand, Image, Text, Shapes), **unit box** (mm/cm/in), cursor read-out, **zoom bar** (−, %, +, Fit, Pattern markings) |
| 3D stage | flex 1 (560 px) | Header ("3D Preview", quality: Adaptive/Full/Half/Quarter, Front/Back/Side), WebGL canvas, **garment picker** pill, "It's 3D, move it" hint, Live-preview badge, **view bar** (Auto-rotate, Reset view, Neck label, Hanger) |
| Inspector | 320 px | Tabs **Design** / **Scene**, then sections (see Feature Inventory) and a "Default settings" card |
| Floating "Selected item" panel | ~300 px | Context properties for the selected layer (anchored at the pattern/3D boundary) |

## 3. Technology observed in the reference (from public requests)

| Area | Observation |
|---|---|
| Front end | Vanilla JS, no framework. One ~480 KB inline script plus small modules. CSS custom-property theming (`data-theme`). |
| 3D | three.js self-hosted, with OrbitControls, EffectComposer, **GTAOPass** (ambient occlusion), RGBELoader (`studio.hdr`), SimplexNoise |
| Garments | `garments.js` manifest (28 models) and, per model, `model.bin` (custom binary mesh), `normal.jpg`, `knitmask.png`, `thumb.webp` |
| Fabric textures | `wrinkles_normal.jpg`, `knit_normal.jpg`, `fabric/band_cotton_normal.jpg` |
| Default art | `defaults/front.png`, `sleeve.png`, `inside-label.png`, placed with normalised piece coordinates (`fx, fy, fw`) |
| Fonts | about 40 self-hosted woff2 files (Google Fonts families, OFL) |
| Light gobos | `gobos-holiday.js` plus about 30 backdrop light patterns |
| Auth / DB | **Supabase** (public URL and anon key in `config.js`). Comments mention `public.plan_limits()` and `public.credit_packs`. |
| Billing | **Paddle** (production) with 3 tiers × monthly/yearly plus 3 credit packs. ProfitWell. |
| Other | `/api/geo` (geo lookup), Cloudflare RUM, GA4, Meta pixel, cookie consent |
| Local state | `localStorage`: `theme`, `viewMode`, `unit`, `tourDone`. The design itself persists across reloads. |

## 4. Plans observed (`plans.js`, public)

| Tier | $/mo | $/yr | Images | Exports | Cloud renders/mo | Max render px | Projects | Storage | Notes |
|---|---|---|---|---|---|---|---|---|---|
| Free | 0 | 0 | 3 | 3 | 0 | none | 1 | 50 MB | watermark |
| Basic | 11.99 | 95.88 | 10 | 30 | 3 | 2500 | 10 | 200 MB | "good" quality only |
| Pro | 28.99 | 227.88 | 50 | 150 | 50 | 3000 | 60 | 500 MB | local render |
| Ultra | 58.99 | 467.88 | unlimited | unlimited | 300 | 3840 | unlimited | 2 GB | local and priority render |

Garment gating: the first model is Free, T-shirts are Basic, polo and hoodies are Pro, and "early" models are Ultra. Packs: 10 renders for $5, 30 renders for $12, 50 exports for $5.

## 5. What is accessible vs. not

**Fully observable while signed out:** the whole editor UI; pattern editing; layers; text, shape and image properties; crop; wrap-over-seams; colour tools; garment picker; scene settings; the render dialog UI; the export menu; theme, language and tour; undo/redo.

**Not accessible (needs an account or a paid plan, and was not attempted):**
- "Your files" and "Save project" open a Log in / Sign up modal (email + password, magic link, "remember me", forgot password)
- cloud project storage, versioning and thumbnails
- cloud render execution and results, credit consumption, the local-render (Pro) path
- contents of the exported ZIP/PDF/video, and per-plan export gating (exports were not triggered, to avoid unrequested downloads and quota use)
- the server-side schema (Supabase tables and RPCs), storage buckets, webhooks
- the proprietary garment meshes and their pattern data (these are the vendor's assets and must not be reused)

## 6. Key findings that drive the architecture

1. **The pattern is the source of truth.** Every print lives on a pattern piece in physical units. The 3D view is a projection of that through per-piece UV islands. The rebuild needs garment assets whose UV islands are true to scale with the pattern pieces (a CLO3D / Marvelous Designer export pipeline).
2. **Renders count "passes".** Draft 150 through Maximum 1500 means progressive path tracing. The same engine can run locally on a GPU or headless on cloud GPU workers.
3. **Outside / Inside printing.** There are separate layer sets per side, plus extra inside-only pieces (hem facings, label).
4. **Wrap over seams.** Artwork overflowing a piece continues onto the neighbouring piece, using seam adjacency, plus an adjustable bleed ("extra past the seams", in cm).
5. **Placement presets.** Chest, left chest logo, front bottom, back, back neck, right/left sleeve, label and printed label are defined per garment as normalised positions.

## 7. Screenshot index

| File | State |
|---|---|
| 00-first-load-1024.jpg | First load at 1024 px, empty layers |
| 01-onboarding-tour-step1.jpg | Quick tour, step 1 of 6 |
| 02-workspace-split-outside.jpg | Default Split view, outside, sample design |
| 03-selected-image-panel-inside-view.jpg | Selected image: properties, transform, inside view |
| 04-scene-tab.jpg | Scene tab |
| 05-inside-view-9-pieces.jpg | Inside view (label, hem facings) |
| 06-garment-picker.jpg | Models panel: search, categories, tier badges |
| 07-export-menu.jpg | Export menu |
| 08-catalogue-render-modal.jpg | Catalogue render dialog |
| 09-text-layer-properties.jpg | Text layer properties |
| 10-shapes-popover.jpg | Shapes popover |
| 11-shape-selected-solid.jpg | Shape: solid colour, outline, thickness |
| 12-shape-gradient-editor.jpg | Gradient editor (stops, linear/radial, angle) |
| 13-image-crop-mode.jpg | Crop mode (trim empty edges, reset) |
| 14-wrap-over-seams.jpg | Wrap over seams on, with bleed |
| 15-light-theme-scene.jpg | Light theme |
| 16-3d-only-mode.jpg | 3D-only view mode |
| 17-login-modal.jpg | Login / Sign-up modal (gates files and save) |
| 18-mobile-gate.jpg | Mobile gate page |
