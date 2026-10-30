# Stage 3 Report: Monorepo, Design System and Application Shell

- **Status:** awaiting approval
- **Date:** 2026-10-30

## What was built

| Area | Location | Contents |
|---|---|---|
| Monorepo | `/` | pnpm 10 workspaces, Turborepo, TypeScript strict (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), Prettier |
| Core | `packages/core` | Brand constants (ADR-0002), unit system: mm storage, mm/cm/in display, parsing, locale default unit |
| Platform | `packages/platform` | Platform adapter interface + web implementation (prefs with a fallback when storage is blocked; detects web / PWA / Tauri) |
| Design system | `packages/ui` | Tokens (light/dark CSS variables mapped into Tailwind v4), Button / IconButton / SplitChevron, Segmented (radio group with arrow keys), Select, Switch, ToggleRow, SliderRow, NumberField, FieldRow, Swatches (+ custom colour + EyeDropper), Section, CollapsibleSection, Tabs, FloatingBar, Glass, Badge, StageNotice, Modal, Menu, Popover, Tooltip. Built on Radix primitives + Lucide icons. |
| Editor shell | `apps/editor` | Vite 8 + React 19 SPA, TanStack Router (`/` editor, `/ui` gallery), i18next (EN), Zustand stores |
| Gallery | `/ui` | Every component in its states, both themes, plus a preview of the Selected-item panel |

## Shell features that work now
- View modes Sewing pattern / Split / 3D (persisted)
- Light / dark theme: persisted, applied before first paint, `theme-color` meta follows it
- Units mm / cm / in (persisted; the default comes from the locale)
- Tool rail with shapes popover; zoom − / + / Fit; pattern-markings toggle
- Outside / Inside switch
- 3D quality select; Front / Back / Side; auto-rotate, neck label and hanger toggles
- Garment panel: search, category chips, grid/list toggle, empty state
- **Inspector Design tab:** fabric swatches, custom colour, eyedropper, solid/gradient; 9 materials; AO and wrinkles; 5 sliders; key light (collapsible)
- **Inspector Scene tab:** HDRI on/off with intensity and rotation; backdrop on/off, colour and shadow; 9 backdrop lights with invert, brightness and contrast; hanger and colours; neck label, shape and colours; auto-rotate; markings
- **The backdrop preview responds live** to the backdrop colour, brightness, contrast and on/off
- Default settings: Save as default / Reset to saved / Restore factory (persisted)
- Export split-button and menu; catalogue render dialog (size × 14 across 7 aspect ratios, frame, quality, transparent background with a checkerboard preview)
- Auth dialog: log in, sign up, reset, magic link; client-side validation; correct label/error association
- Quick tour: 6 steps, spotlight, auto-runs on first visit, re-runs from "?", Escape to skip
- Narrow-window notice under 900 px. At 1024–1199 px the header collapses (logo mark only, icon-only snapshot) and stage headers use container queries (icon-only quality select, piece count hidden).

**Clearly marked as later stages** (disabled, with a "Stage N" tooltip or notice, and nothing faked): undo/redo, artwork and layers (4); the pattern canvas (4); the 3D garment and snapshot (5); new/files/save (8); account requests (6); renders and print/sublimation/spec/video exports (7).

## Verification

| Check | Result |
|---|---|
| `tsc` (4 packages) | ✅ 0 errors |
| Vitest: core (4), ui (6), editor shell (8) | ✅ 18 / 18 passing |
| `vite build` | ✅ largest chunk 219 kB (react) / 68 kB gzip; editor code 64 kB; Lucide tree-shaken to 17 kB; gallery lazy-loaded |
| Browser console (dev) | ✅ no errors |
| Manual check in browser at 1440×900 and 1024×768, dark and light | ✅ after fixes below |

### Layout geometry vs. reference (1440×900, measured with `getBoundingClientRect`)
| Element | Reference | Ours |
|---|---|---|
| Header height | 56 | 56 |
| Pattern stage x / width | 0 / 560 | 0 / 560 |
| 3D stage x / width | 560 / 560 | 560 / 561 (incl. 1 px divider) |
| Inspector x / width | 1120 / 320 | 1120 / 320 |
| Inspector tabs height | 53 | 53 |
| Stage header height | 52 | 52 |
| Tool rail box | 36,149 · 50×210 | 36,149 · 50×210 |
| View-mode segmented width | 231 | 231 |

### Bugs found and fixed during verification
1. NumberField: the unit suffix leaked into the accessible name ("Width cm"). Fixed with an explicit `aria-label`; covered by a test.
2. Auth fields: once an error appeared, its text became part of the input's label. Fixed with `htmlFor` + `aria-describedby`; covered by a test.
3. The quality select was truncated at 1440; the render dialog's "Render on this computer" button was truncated.
4. At 1024 px the wordmark overlapped the view switcher and the 3D header wrapped. Fixed with responsive collapse.
5. Stage notices were hard to read on light backdrops (now on a panel background).

## Deviations from the reference (intentional)
- Own identity: "Garment Studio" working name, own logo, **cobalt accent** (#4a5fd1 light / #5867e0 dark) instead of sage green (ADR-0002).
- Dark-mode `--faint` raised from #6f747c to #8d939c for WCAG AA text contrast.
- Tour and UI copy are our own wording.
- The garment pill reads "Models" plus "No garment loaded" until garments exist (Stage 5).

## How to run
```bash
corepack pnpm install
```
```bash
corepack pnpm dev
```
Then open http://localhost:5173 (editor) or http://localhost:5173/ui (design system).

## Known limitations / follow-ups
- Only English strings exist (other locales are a content task, ADR-0015).
- Not yet verified in Firefox or Safari (Chromium only). Cross-browser checks are scheduled with the Stage 4 E2E setup (Playwright).
- No visual regression baseline yet; Playwright screenshot tests are added in Stage 4, once the canvas exists.
- The repository is initialised (`git init`) but nothing is committed.
