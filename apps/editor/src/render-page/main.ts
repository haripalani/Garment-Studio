// The cloud render page: no editor UI, just the editor's document parsing, 2D baking and path tracer,
// driven by the render worker through `window.gsRender` (ADR-0013). Same code, same image as local renders.
import { parseDoc, type RenderPageApi, type RenderPageInput, type RenderPageOutput, type RenderProgressFn } from '@gs/core';
import { canvasBlob, pathTrace, renderPlan } from '@gs/engine-3d';
import { registerAsset } from '../store/assets';
import { withStudio } from '../render/scene';
import { watermark } from '../render/watermark';

declare global {
  interface Window extends RenderPageApi {
    gsProgress?: RenderProgressFn;
  }
}

let abort: AbortController | null = null;

function fromBase64(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function gsRender(input: RenderPageInput): Promise<RenderPageOutput> {
  const doc = parseDoc(input.doc);
  await Promise.all(Object.entries(input.assets).map(([id, a]) => registerAsset(id, fromBase64(a.base64, a.mime))));
  const plan = renderPlan(input.width, input.height, input.quality);
  const samples = input.samplesOverride ?? plan.samples;
  abort = new AbortController();
  const r = await withStudio(input.garment, doc, plan.bakePxPerMm, (studio) =>
    pathTrace(studio, {
      width: input.width,
      height: input.height,
      frame: input.frame,
      ...(input.camera ? { orbit: input.camera } : {}),
      transparent: input.transparent,
      samples,
      bounces: plan.bounces,
      tiles: plan.tiles,
      textureSize: plan.textureSize,
      signal: abort!.signal,
      onProgress: (done, total) => window.gsProgress?.(done, total),
    }),
  );
  const outputs: RenderPageOutput['outputs'] = [];
  const image = input.watermark ? watermark(r.canvas) : r.canvas;
  for (const format of input.formats) {
    const mime = format === 'png' ? 'image/png' : 'image/webp';
    const blob = await canvasBlob(image, mime, 0.95);
    if (blob.type !== mime) throw new Error(`This browser cannot encode ${format}`);
    outputs.push({ format, mime, base64: await toBase64(blob) });
  }
  return { outputs, samples: r.samples, ms: r.ms };
}

window.gsRender = gsRender;
window.gsCancel = () => abort?.abort();
window.gsReady = true;
