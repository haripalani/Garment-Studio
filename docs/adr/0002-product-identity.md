# ADR-0002: Own product identity, with the reference used only for functionality (D1)

- **Status:** Accepted · 2026-10-30

## Context
The reference (BlankBuilder) owns its name, logo, wordmark, default artwork, garment renders, marketing copy and code. Reproducing its exact look for a competing product carries trade-dress risk.

## Decision
- Build under our own identity. **Working name: "Garment Studio"** (placeholder, swappable from one brand module and the app manifest).
- Match the reference's **layout, density, information architecture and interactions** (DESIGN_SYSTEM.md metrics).
- Use our own **accent colour, logo, icon set (Lucide) and illustrations**. Neutral tokens (greys, radii, spacing, type scale) may follow the measured values; the accent moves away from the reference sage green (final hue chosen in Stage 3).
- Never copy reference source code, garment meshes, textures, HDRIs, gobos, sample artwork or copy text. Fonts come from their original OFL sources (Google Fonts), not the reference's bundles.

## Consequences
Visual-diff tests compare **layout geometry** (element boxes) with the reference, not colours. The final name needs a trademark check before Stage 12.
