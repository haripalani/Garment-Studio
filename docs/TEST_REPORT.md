# Test Report

- **Date:** 2026-10-30
- **Scope:** Stages 3–4 (shell, design system, 2D pattern editor)

## Suites

| Suite | Tool | Where | Result |
|---|---|---|---|
| Unit: core (geometry, dev garment, document schema, units) | Vitest | `packages/core` | ✅ 13 / 13 |
| Unit: engine-2d (view, layout, hit-test, seams, pixel effects, manipulation maths) | Vitest | `packages/engine-2d` | ✅ 26 / 26 |
| Unit: ui components | Vitest + Testing Library | `packages/ui` | ✅ 6 / 6 |
| Unit: editor (shell, history, commands) | Vitest + Testing Library | `apps/editor/src` | ✅ 21 / 21 |
| **End-to-end** across **Chromium, Firefox, WebKit** | Playwright 1.64 | `apps/editor/e2e` | ✅ **78 passed**, 6 skipped (visual baselines are Chromium-only by design) |
| Accessibility: axe-core, WCAG 2.1 A/AA, dark + light + gallery | @axe-core/playwright | `e2e/visual-a11y.spec.ts` | ✅ 0 serious/critical in all 3 browsers |
| Visual regression baselines (3 screens) | Playwright `toHaveScreenshot` | `e2e/__screenshots__/chromium` | ✅ created and passing |

**Total: 66 unit tests + 78 E2E runs, all passing.** Stability: Chromium ×5 repeated runs were clean after the fixes below. The full 3-browser run was clean twice in a row with 4 workers.

## E2E coverage (28 tests × 3 browsers)
- **Shell:** layout geometry vs. reference; view modes persisted across reload; theme; piece count per side; zoom and Fit; tour; auth validation, with a check that **no network request** is made.
- **Editor:**
  - add text and refit; drag across pieces (re-parenting)
  - corner scale keeping the ratio; rotate handle → 90°
  - draw a shape with the `R` shortcut
  - keyboard duplicate / delete / undo / redo; arrow nudges; Transform width
  - presets switching side; reordering layers by keyboard
- **Images:** upload via the file chooser; crop → trim → reset at constant physical scale; unsupported file rejected with a message; drag-and-drop onto the piece under the pointer; invert / fill / reset colours.
- **Persistence:** text and image restored after reload; New design (cancel and confirm) clears the work and history.
- **Wrap over seams:** pixel-sampled. Artwork off the front's side seam appears on the back's edge with wrap on and disappears with wrap off.

## Defects found by these tests and fixed

| # | Defect | Found by | Fix |
|---|---|---|---|
| 1 | **Data loss window:** "Saved on this device" stayed visible after a new change; a reload within 0.8 s lost the last edit | Chromium repeat runs (flaky persistence test) | Unsaved state is shown immediately on change; "saved" is reported only when the written revision is current; flush on `visibilitychange: hidden` as well as `pagehide` |
| 2 | **WebKit lost uploaded images on reload** (Blob in IndexedDB unsupported); the error was swallowed | WebKit persistence test | Originals stored as raw bytes + type (legacy Blobs still readable); a storage failure now warns the user instead of failing silently |
| 3 | Accent text below 4.5:1 on dark panels (stage titles, active segments, wordmark) | axe | New `accent-fg` text token per theme |
| 4 | Light-theme muted and faint greys below 4.5:1 (captions, unit suffixes, layer meta on the selected row) | axe | Darker `--muted` / `--faint` in light theme |
| 5 | Badge "success" and "warn" text below 4.5:1 | axe | `success-fg` / `warn-fg` tokens |
| 6 | `aria-haspopup` on a `<span>` (shapes popover trigger) | axe | Tool button forwards its ref so the trigger is the real button |
| 7 | Nested interactive controls (listbox options containing buttons; rename input inside a button) | axe | Layers list is a plain list with `aria-current`; rename replaces the row button; F2 renames |

Test-only issues corrected: a password label also matched "Show password"; a shape drag centred exactly on a seam line; slow axe runs under parallel load (timeout 60 s, 4 workers).

## How to run
```bash
corepack pnpm test
```
```bash
corepack pnpm --filter @gs/editor e2e
```
```bash
corepack pnpm --filter @gs/editor e2e:update
```
The last command regenerates the visual baselines after an intentional UI change. Review the diff in `e2e/__screenshots__` before committing it.

## Not covered yet
- Real OS clipboard image paste (Playwright cannot place images on the system clipboard portably).
- Touch input and tablets.
- Performance benchmarks (planned for Stage 12, with numbers).
- CI wiring (GitHub Actions) is defined in ADR-0016 but not set up, because there is no remote repository yet.

## Update: Stage 5 (3D engine)
- Unit: **81** (adds engine-3d 11, look migration and history-merge tests).
- E2E: **34 tests × 3 browsers → 96 passed, 6 skipped**. Adds 6 3D tests (colour fidelity, 2D→3D sync, camera presets, quality, snapshot PNG, undo of scene toggles).
- New defects found by the suites and fixed: WebKit blank editor (missing `OffscreenCanvas`), garment-pill accessible name, sleeve/back face orientation (unit), no-op edits polluting history (unit).
- Load notes: E2E runs with 3 workers and a 60 s test timeout because the live 3D preview uses software WebGL in headless browsers; the heaviest drag test is marked `test.slow()`.

## Update: Stage 6 (backend)
- **API integration: 75 tests** (`apps/api/test`, 61 integration + 14 unit) against real Postgres 17, Redis 7, S3 (SeaweedFS), SMTP (Mailpit) and ClamAV 1.4 over HTTP. Three consecutive full runs green.
- **Contract checking:** the test client validates every response against `architecture/openapi.yaml` (status must be documented, body must match). All 46 implemented operations are exercised, with 93 operation + status pairs.
- New defects found and fixed: SVG rules missed self-closing tags; malware could be reported as a type error; oversized documents got 422 instead of 413; 6 undocumented responses plus shared 401/422/429 (spec draft.2). Full list in `docs/STAGE6_REPORT.md`.
- Run with the local services up:
```bash
docker compose -f infra/dev/compose.yaml up -d
```
```bash
corepack pnpm --filter @gs/api test
```

## Update: Stage 7 (rendering and export)
- **Unit: 96** (engine-3d +4 render plan/framing; editor +6 PNG DPI chunk, print targets, durations).
- **API: 84**, including 9 render/export/live-event tests. A real GPU render worker (headless Chromium driving the editor's render page) renders end to end; outputs, alpha, events, cancellation, retries, quotas and credits are all checked. Every response is contract-checked, and all 53 HTTP operations are exercised.
- **Editor E2E:** 5 new tests, for print ZIP, sublimation ZIP (pixel check), spec PDF, turntable video and the GPU path-traced local render.
  - These heavy tests run in `*-exports` projects after the interaction tests, one browser at a time.
  - The GPU render test runs in Chromium with ANGLE/D3D11 on Windows and is skipped without a GPU.
  - Result: **109 passed, 8 skipped** (by design) on Chromium, Firefox and WebKit.
- **Load and stability changes:**
  - On-demand libraries are pre-bundled by the dev server; late discovery had reloaded every open page mid-test.
  - Heavy tests are isolated, because they starved interaction tests when run in parallel.
  - The persistence spec has a 120 s budget.

## Update: Stage 8 (cloud app and staging)
- **Unit: 105** (core +13: three-way merge, ids).
- **API: 87** (+ hash lookup, conflicted-copy link, refresh rate class, browser preflight for PUT/PATCH/DELETE).
- **Cloud E2E:** 5 tests × 3 browsers against the real API and Mailpit, with two browser contexts as two devices:
  - sign-up, email link and reload
  - wrong password, magic link and log out
  - live sync between devices
  - an offline conflict producing a conflicted copy
  - the project browser
- **Staging replica smoke:** 1 test × 3 browsers on the production images over HTTPS (`playwright.staging.config.ts`).
- **CI workflow** written (`.github/workflows/ci.yml`), not run yet: it needs a push.
- **Final full E2E run:** 105 passed, 6 skipped by design, 1 heavy-phase timeout (the GPU render test under load), so 20 chained heavy tests didn't run. Local runs now use 2 workers.
