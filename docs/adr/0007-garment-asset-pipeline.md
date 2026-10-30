# ADR-0007: Garment asset pipeline: CLO3D / Marvelous Designer → GLB + GarmentModel manifest (D2)

- **Status:** Accepted · 2026-10-30

## Context
Print placement in 3D is only accurate if each UV island is the pattern piece at true scale. The reference meshes are proprietary and may not be reused.

## Decision
- Author garments in **CLO3D or Marvelous Designer** (cut-and-sewn simulation). Export:
  1. GLB with **UV islands = pattern pieces in mm**
  2. the pattern as **DXF-AAMA** (outlines, notches, grain lines)
  3. baked normal, AO and knit-mask maps
- `packages/garment-tools` CLI `gt build <dir>`:
  - parses DXF-AAMA into `PieceDef.outlineMm` and matches pieces to UV islands (shape match, with a manual override file)
  - computes `uvRect` per piece and **validates** that UV area ÷ pattern area is constant within ±1 %
  - derives seam pairs from coincident sewn edges, for wrap-over-seams
  - meshopt-compresses the GLB, renders thumbnails, and writes `garment.json` (GarmentModel, DATA_MODEL.md §2)
- Launch set: **Tee (flat), Tee (on body), Hoodie (flat)**; the rest is backlog.
- Development fallback: a procedural "flat tee" in engine-3d so Stages 4–5 aren't blocked on assets. It is never shipped as a catalogue item.

## Consequences
Needs a 3D garment artist from now on, budgeted at 1–2 weeks per garment family. Asset versions are immutable; each project stores `modelVersion`.
