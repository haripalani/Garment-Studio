# Feature Parity Matrix

Status values: **Implemented and verified** · **Implemented but not verified** · **Partially implemented** · **Not implemented** · **Inaccessible in reference** · **Not applicable**.
IDs map to FEATURE_INVENTORY.md. Nothing is built yet (Stage 1), so every accessible feature is *Not implemented*. Target stage in brackets.

| ID | Feature | Reference access | Status | Stage |
|---|---|---|---|---|
| A1 | View modes pattern/split/3D | Observed | **Implemented and verified** (tests + browser) | 3 |
| A2 | Light/dark theme | Observed | **Implemented and verified** | 3 |
| A3 | i18n EN/FR/ZH/RU | Present | Partially implemented (EN; keys in place) | 3 (EN) / later |
| A4 | Quick tour | Observed | **Implemented and verified** | 3 |
| A5 | Undo/redo | Observed | **Implemented and verified** (patch history, gestures = 1 step) | 4 |
| A6 | New design | Present | **Implemented and verified** (the previous design is kept in the project list) | 4 / 8 |
| A7 | Project browser | **Inaccessible** (login) | **Implemented and verified**, independent design (device + account, thumbnails, rename/duplicate/trash/restore) | 8 |
| A8 | Save project (cloud) | **Inaccessible** (login) | **Implemented and verified**: autosave to the cloud, revisions, three-way merge, conflicted copies | 8 |
| A9 | 3D snapshot | Present | **Implemented and verified** (E2E: PNG download) | 5 |
| A10 | Export menu | Observed | **Implemented and verified** (all items work) | 7 |
| A11 | Auth modal (password, magic link, reset, sign-up) | UI observed, flow inaccessible | **Implemented and verified** (3 browsers, real API); Google/Apple need credentials | 8 |
| A14 | Mobile gate | Observed | Not implemented (we'll offer a viewer mode instead) | 9 |
| B1–B7 | Pattern pieces, sides, rulers, units, cursor read-out, zoom, markings | Observed | **Implemented and verified** on the development garment (real garments: Stage 5) | 4 |
| B8–B10 | Tools, shapes, transform handles | Observed | **Implemented and verified** (manipulation maths unit-tested; handles checked in browser) | 4 |
| B11 | Move between pieces | Observed | **Implemented and verified** | 4 |
| B12–B13 | Paste / drag-drop images | Present / inferred | Drop: **verified**. Clipboard paste: implemented but not verified (needs a real OS clipboard) | 4 |
| C1–C9 | Layers, transform, align, mirror/copy/delete, presets | Observed | **Implemented and verified** | 4 |
| C10 | Wrap over seams + bleed | Observed | **Implemented and verified**: 2D, 3D and print output (a bleed bug found and fixed in Stage 7, pixel-tested) | 4 / 5 / 7 |
| C11 | Multi-select / grouping | Not present in reference | Not applicable (candidate enhancement) | – |
| D1–D6 | Image upload, invert, crop/trim, hue/sat, fill, reset | Observed | **Implemented and verified** (pixel ops unit-tested; crop/trim in browser) | 4 |
| D7 | Vector (SVG/PDF/AI) print pass-through | Inferred | SVG upload works (drawn as an image); vector print pass-through not implemented; PDF/AI not accepted yet | 7 |
| E1–E7 | Text properties | Observed | **Implemented**: text, 18 fonts, weight, B/I/AA, align, line height, letter spacing, solid/gradient. Verified in browser except per-font rendering of every family | 4 |
| F1–F4 | Shape kinds, gradient editor, outline, dashed | Observed | **Implemented and verified** (gradient editor: add/move/remove stops, linear/radial, angle) | 4 |
| G1–G2 | Fabric colour / gradient | Observed | **Implemented and verified** (2D + 3D, colour-fidelity E2E) | 5 |
| G3 | 9 knit materials | Observed | **Implemented** (procedural normal maps); visual quality to be reviewed on real garments | 5 |
| G4–G7 | AO, wrinkles, texture, knit size, brightness, contrast | Observed | **Implemented**; AO/fold geometry unit-tested | 5 |
| G8 | Key light | Observed | **Implemented** (side, height, power, soft shadow) | 5 |
| G9 | Look defaults (save/reset/factory) | Observed | **Implemented and verified** (stored on device) | 3 |
| H1–H3 | Camera, presets, quality, auto-rotate | Observed | **Implemented and verified** (E2E) | 5 |
| H4 | Garment catalogue (28 models) | Observed; **assets proprietary, not reused** | Partially implemented: picker UI, catalogue API (public, cacheable) and the procedural development tee; real garments need our own or licensed models (D2) | 5+ |
| H5–H10 | HDRI, backdrop, gobos (30), hanger, neck label, markings | Observed | **Implemented**: generated HDRI, backdrop, 8 procedural gobos (reference: 30), hanger, 5 label shapes, markings | 5 |
| I1 | Catalogue render dialog | UI observed | **Implemented and verified**: live path-traced preview, sizes, frames, qualities, transparent | 7 |
| I2 | Cloud / local render execution | **Inaccessible** (plan) | Local: **verified**. Cloud: **verified** API + GPU worker; editor flow implemented (live progress, cancel, save); its E2E needs a GPU worker | 7 / 8 |
| I3 | Save PNG / WebP / transparent | UI observed | **Implemented and verified** (PNG E2E; transparent alpha verified in worker tests; WebP header verified) | 7 |
| I4 | Print files ZIP | Present, not run | **Implemented and verified**: our own format (real size, DPI in file, manifest) | 7 |
| I5 | Sublimation panels ZIP | Present, not run | **Implemented and verified** (pixel-checked fill, bleed, cut line) | 7 |
| I6 | Spec sheet PDF | Present, not run | **Implemented and verified**: our own layout (views, placements, pieces) | 7 |
| I7 | Turntable video | Present, not run | **Implemented and verified** in Chromium/Firefox (MP4); WebKit build without WebCodecs gets a clear message | 7 |
| I8 | Watermark (Free) | Inferred | **Implemented**: client for local outputs, server for cloud renders; watermark pixels not asserted by a test | 8 |
| J1 | Account auth flows | **Inaccessible** | API **implemented and verified**, independent design (password, magic link, verify, reset, sessions, desktop PKCE, deletion, data export). OAuth providers: not configured | 6 |
| J2–J5 | Plans, packs, quotas, grace | Inferred from public config | Partially implemented: entitlements engine, plans as data, quotas (402), credits, signed offline snapshot **verified**; prices/provider depend on D3 | 6+ |
| – | Cloud sync across devices | Inaccessible in reference | **Implemented and verified** (live sync between two devices, offline conflict E2E in 3 browsers) | 8 |
| – | Offline editing, PWA install | Not offered by reference | Not implemented (new requirement) | 9 |
| – | Desktop app (Win/macOS) | Not offered by reference | Not implemented (new requirement) | 10 |
