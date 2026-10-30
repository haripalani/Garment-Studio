# Data Model (proposed)

## 1. Project document (portable, versioned JSON, the single source of truth for 2D, 3D and export)

```ts
interface ProjectDoc {
  schema: "garment-studio/project";
  schemaVersion: 1;                     // migrations: v(n) → v(n+1) pure functions
  id: string; name: string;
  createdAt: string; updatedAt: string;
  revision: number;                     // monotonically increasing; used for sync conflicts
  garment: { modelId: string; modelVersion: string; size?: string };
  units: "mm" | "cm" | "in";            // display only; all geometry stored in millimetres
  fabric: {
    fill: Paint;                        // solid or gradient
    material: MaterialId;               // cotton | cotton-blend | interlock | sport-knit | pique | rib | waffle | fleece | mesh
    ao: boolean; wrinkles: { on: boolean; strength: number };
    texture: number; knitScale: number; brightness: number; contrast: number;
  };
  light: { azimuthDeg: number; elevationDeg: number; power: number };
  scene: {
    hdri: { on: boolean; id: string; intensity: number; rotationDeg: number };
    backdrop: { on: boolean; color: string; shadow: boolean;
                gobo: { id: string | null; invert: boolean; brightness: number; contrast: number } };
    hanger: { on: boolean; color: string };
    neckLabel: { on: boolean; shape: "small-woven" | "wide" | "square" | "tall-satin" | "loop"; color: string };
    autoRotate: boolean; patternMarkings: boolean;
  };
  camera: { azimuth: number; polar: number; distance: number; target: [number, number, number] };
  layers: Layer[];                      // index 0 = top of stack
  assets: Record<string, AssetRef>;     // content-addressed
}

type Side = "outside" | "inside";
interface LayerBase {
  id: string; name: string; visible: boolean; locked?: boolean;
  pieceId: string; side: Side;
  // placement in the piece's local frame, millimetres, origin = piece bbox top-left
  x: number; y: number; w: number; h: number; rotationDeg: number;
  opacity: number; flipX: boolean;
  wrap: { on: boolean; bleedMm: number };
}
interface ImageLayer extends LayerBase { type: "image"; assetId: string;
  crop: { l: number; t: number; r: number; b: number } | null;   // normalised 0..1
  adjust: { invert: boolean; hueDeg: number; saturation: number; fill: string | null } }
interface TextLayer extends LayerBase { type: "text"; text: string; font: string; weight: number;
  italic: boolean; caps: boolean; align: "left" | "center" | "right";
  lineHeight: number; letterSpacing: number; paint: Paint }
interface ShapeLayer extends LayerBase { type: "shape";
  kind: "rect" | "square" | "circle" | "triangle" | "star" | "diamond" | "line" | "dashed-line";
  paint: Paint; outline: { on: boolean; thicknessMm: number; dashed: boolean } }
type Layer = ImageLayer | TextLayer | ShapeLayer;

type Paint = { kind: "solid"; color: string }
           | { kind: "linear" | "radial"; angleDeg: number; stops: { at: number; color: string; alpha: number }[] }; // ≤5 stops

interface AssetRef { sha256: string; mime: string; bytes: number; width?: number; height?: number;
  vector?: boolean; storageKey?: string; localOnly?: boolean }
```

## 2. Garment definition (authored asset, versioned, served from the CDN)

```ts
interface GarmentModel {
  id: string; version: string; category: "tee" | "polo" | "hoodie" | "longsleeve" | "jersey" | "accessory";
  name: Localised; cut: Localised; tier: PlanId; thumb: string;
  mesh: string;                        // GLB (Draco/meshopt), UV islands = pattern pieces at true scale
  maps: { normal: string; knitMask?: string; ao?: string };
  pieces: PieceDef[];                  // outline polygons in mm, grain line, notches, side availability
  seams: { a: [pieceId, edgeIdx]; b: [pieceId, edgeIdx]; reversed: boolean }[];  // for wrap-over-seams
  presets: Record<PresetId, { pieceId: string; side: Side; fx: number; fy: number; fw: number }>;
  camera: { fit?: boolean; presets: Record<"front" | "back" | "side", CameraPose> };
}
interface PieceDef { id: string; role: "front" | "back" | "sleeveL" | "sleeveR" | "rib" | "facing" | "label" | "hood" | "pocket" | string;
  name: Localised; outlineMm: [number, number][]; cut: number; sides: Side[];
  uvRect: [u0: number, v0: number, u1: number, v1: number]; layoutMm: { outside: [number, number]; inside: [number, number] } }
```

## 3. Relational schema (PostgreSQL / Prisma)

| Table | Key columns | Notes |
|---|---|---|
| users | id, email (citext unique), password_hash nullable, email_verified_at, created_at, deleted_at | soft delete, then a purge job |
| auth_identities | id, user_id, provider, provider_uid | OAuth or magic link |
| sessions | id, user_id, refresh_hash, device, platform(web/pwa/desktop), expires_at, revoked_at | rotating refresh tokens |
| user_settings | user_id PK, theme, unit, locale, look_defaults jsonb, hints jsonb | |
| projects | id, owner_id, name, garment_model_id, head_revision, thumb_asset_id, created_at, updated_at, deleted_at | |
| project_versions | id, project_id, revision, doc jsonb, doc_sha256, author_device, created_at | append-only; unique (project_id, revision) |
| assets | id, owner_id, sha256, mime, bytes, width, height, storage_key, scan_status, created_at | unique (owner_id, sha256) |
| project_assets | project_id, asset_id | reference counting for GC |
| garment_models | id, version, tier, manifest jsonb, published_at | |
| render_jobs | id, user_id, project_id, revision, params jsonb, status(queued/running/succeeded/failed/cancelled), progress, attempts, error, output_asset_ids, credits_charged, created/started/finished_at | |
| export_records | id, user_id, project_id, kind(print_zip/sublimation_zip/spec_pdf/video/snapshot), output_asset_id, created_at | quota accounting |
| plans / subscriptions / credit_ledger | only if billing is approved (decision D3) | ledger is append-only |
| audit_logs | id, actor_id, action, target, ip_hash, meta jsonb, created_at | |

## 4. Local store (IndexedDB via Dexie; Tauri uses the same through the webview)
`projects` (doc, revision, base_revision, dirty), `assets` (blob by sha256), `outbox` (pending ops/uploads with retry state), `garmentCache`, `settings`.

## 5. Schema evolution
`schemaVersion` on every document; a `migrate(doc)` chain in `packages/core`, run on load (client) and on write (server). Golden-file tests for each migration. Unknown future versions open read-only with a prompt to update.
