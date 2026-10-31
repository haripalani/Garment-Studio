// Contract between the cloud render worker (apps/api, Node + Playwright) and the render page
// (apps/editor render.html), which runs the editor's own path tracer in headless Chromium (ADR-0013).
import type { GarmentModel } from './garment';

export interface RenderPageInput {
  /** ProjectDoc JSON as stored for the revision (validated and migrated by the page). */
  doc: unknown;
  garment: GarmentModel;
  /** Image bytes for every asset id in doc.assets, base64-encoded. */
  assets: Record<string, { mime: string; base64: string }>;
  width: number;
  height: number;
  quality: 'draft' | 'good' | 'high' | 'max';
  frame: 'preview' | 'front' | 'back' | 'side';
  camera?: { azimuth: number; polar: number; distance: number; target: [number, number, number] } | undefined;
  transparent: boolean;
  formats: ('png' | 'webp')[];
  /** The user's plan requires a watermark (decided by the worker, not the client). */
  watermark?: boolean | undefined;
  /** Test environments only: render fewer samples than the quality calls for. */
  samplesOverride?: number | undefined;
}

export interface RenderPageOutput {
  outputs: { format: 'png' | 'webp'; mime: string; base64: string }[];
  samples: number;
  ms: number;
}

/** Functions the render page exposes on `window`, and the progress callback the worker provides. */
export interface RenderPageApi {
  gsRender(input: RenderPageInput): Promise<RenderPageOutput>;
  gsCancel(): void;
  gsReady: true;
}
export type RenderProgressFn = (samplesDone: number, total: number) => void;
