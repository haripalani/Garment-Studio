# ADR-0004: Editor is a Vite + React SPA; Next.js only for the public site (D4)

- **Status:** Accepted · 2026-10-30 (deviates from the brief's Next.js proposal)

## Context
The editor is entirely client-side (Canvas2D, WebGL, workers, IndexedDB). Tauri 2 loads a static bundle, so Next.js SSR, route handlers and server actions are unavailable there. A PWA needs a deterministic precache manifest.

## Decision
- `apps/editor`: Vite 6 + React 19 + TypeScript + Tailwind v4 + Radix primitives. One bundle with two build flavours:
  - `web`: served from the CDN at `app.<domain>`, with a vite-plugin-pwa service worker
  - `desktop`: `PLATFORM=tauri` swaps the `packages/platform` adapter at build time
- `apps/site`: Next.js 15 (App Router) for marketing, pricing, docs, account pages and the auth callback landing pages.
- State: Zustand for UI state; the document store is a command/patch store (ADR-0008).
- Editor routing: TanStack Router with a few routes (`/`, `/p/:id`, `/projects`).

## Consequences
One editor codebase for all three delivery forms. SSR SEO is limited to the site, which is fine because the editor has no SEO value.
