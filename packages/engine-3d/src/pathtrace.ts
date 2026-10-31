// Final renders: progressive path tracing of the live studio scene (three-gpu-pathtracer, WebGL).
// The same function runs in the editor (local render) and in headless Chromium (cloud worker, ADR-0013),
// so both produce the same image for the same inputs.
import * as THREE from 'three';
import { createCanvas, type Orbit, type RenderFrame, type Studio } from './studio';

export type RenderQuality = 'draft' | 'good' | 'high' | 'max';

/** Samples per pixel per quality (OpenAPI CreateRenderRequest). */
export const QUALITY_SAMPLES: Record<RenderQuality, number> = { draft: 150, good: 500, high: 1000, max: 1500 };

export interface RenderPlan {
  samples: number;
  /** Light bounces: more for higher qualities (fabric interreflection). */
  bounces: number;
  /** Tiles per side: large frames render in tiles so the GPU stays responsive. */
  tiles: number;
  /** Size of the path tracer's texture atlas layers (every map is resampled to this). */
  textureSize: number;
  /** Resolution to bake the printed pieces at for this render (px per mm). */
  bakePxPerMm: number;
}

export function renderPlan(width: number, height: number, quality: RenderQuality): RenderPlan {
  const long = Math.max(width, height);
  const fine = quality === 'high' || quality === 'max';
  return {
    samples: QUALITY_SAMPLES[quality],
    bounces: quality === 'draft' ? 4 : 6,
    tiles: Math.max(1, Math.ceil(long / 1280)),
    textureSize: fine ? 2048 : 1024,
    bakePxPerMm: fine && long > 2000 ? 4 : 2,
  };
}

export interface PathTraceOptions {
  width: number;
  height: number;
  frame: RenderFrame;
  /** Exact view for "preview" renders made away from the live viewer (cloud worker). */
  orbit?: Orbit;
  transparent: boolean;
  samples: number;
  bounces?: number;
  tiles?: number;
  textureSize?: number;
  signal?: AbortSignal;
  /** Called after each sample with the number of complete samples. */
  onProgress?: (samples: number, total: number) => void;
  /** Draw into this canvas (e.g. the live preview in the render dialog) instead of a new one. */
  canvas?: HTMLCanvasElement | OffscreenCanvas;
}

export interface PathTraceResult {
  /** A 2D canvas holding the finished image (the WebGL context is released). */
  canvas: HTMLCanvasElement | OffscreenCanvas;
  samples: number;
  ms: number;
  /** Time until the first sample: scene build plus shader compilation (slow on some drivers). */
  firstSampleMs: number;
}

function copyTo2d(src: HTMLCanvasElement | OffscreenCanvas, w: number, h: number) {
  const out = createCanvas(w, h);
  const ctx = out.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('2D context unavailable');
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Work in ~30 ms slices between yields: responsive UI without the frame-rate cap of rAF. */
const SLICE_MS = 30;

/**
 * Yield to the event loop with a message (not rAF or setTimeout, which browsers throttle hard in
 * background tabs and panes, stalling a long render).
 */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(null);
  });
}

export class RenderCancelled extends Error {
  constructor() {
    super('Render cancelled');
    this.name = 'AbortError';
  }
}

export async function pathTrace(studio: Studio, o: PathTraceOptions): Promise<PathTraceResult> {
  const { WebGLPathTracer, GradientEquirectTexture } = await import('three-gpu-pathtracer');
  const started = performance.now();
  const canvas = o.canvas ?? createCanvas(o.width, o.height);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(o.width, o.height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.setClearColor(0x000000, 0);

  // three-gpu-pathtracer logs a deprecation notice for the WebGL tracer; its WebGPU successor isn't
  // usable headless yet (ADR-0020), so the notice is kept out of user consoles.
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('WebGLPathTracer:')) return;
    warn(...args);
  };
  let tracer: InstanceType<typeof WebGLPathTracer>;
  try {
    tracer = new WebGLPathTracer(renderer);
  } finally {
    console.warn = warn;
  }
  tracer.renderDelay = 0;
  tracer.fadeDuration = 0;
  tracer.minSamples = 0;
  tracer.rasterizeScene = false;
  tracer.dynamicLowRes = false;
  tracer.bounces = o.bounces ?? 5;
  tracer.filterGlossyFactor = 0.5;
  tracer.tiles.set(o.tiles ?? 1, o.tiles ?? 1);
  tracer.textureSize.set(o.textureSize ?? 1024, o.textureSize ?? 1024);

  const ambient = new GradientEquirectTexture(64);
  try {
    const camera = studio.cameraFor(o.frame, o.width / o.height, o.orbit);
    await studio.withPathTraceScene(camera, { transparent: o.transparent }, async (s) => {
      renderer.toneMappingExposure = s.exposure;
      if (s.environment) {
        s.scene.environment = s.environment;
      } else {
        ambient.topColor.set(s.ambient.top);
        ambient.bottomColor.set(s.ambient.bottom);
        ambient.update();
        s.scene.environment = ambient;
      }
      const intensity = s.scene.environmentIntensity;
      if (!s.environment) s.scene.environmentIntensity = s.ambient.intensity;
      try {
        // Synchronous BVH build: the garment is a few thousand triangles (well under 100 ms), and the
        // async variant needs a bundler-specific worker setup.
        tracer.setScene(s.scene, s.camera);
      } finally {
        s.scene.environmentIntensity = intensity;
      }
    });

    let last = -1;
    let firstSampleMs = 0;
    const gl = renderer.getContext();
    const probe = new Uint8Array(4);
    let sliceStart = performance.now();
    while (tracer.samples < o.samples) {
      if (o.signal?.aborted) throw new RenderCancelled();
      tracer.renderSample();
      // Wait for the GPU (a 1-pixel read) so work never queues up and freezes the page.
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe);
      const done = Math.floor(tracer.samples);
      if (done !== last) {
        if (!firstSampleMs && done > 0) firstSampleMs = performance.now() - started;
        last = done;
        o.onProgress?.(Math.min(done, o.samples), o.samples);
      }
      if (performance.now() - sliceStart > SLICE_MS) {
        await yieldTask();
        sliceStart = performance.now();
      }
    }
    // Copy out before the GPU context is released (a lost context clears the canvas).
    const out = o.canvas ?? copyTo2d(canvas, o.width, o.height);
    return { canvas: out, samples: Math.floor(tracer.samples), ms: performance.now() - started, firstSampleMs };
  } finally {
    tracer.dispose();
    ambient.dispose();
    renderer.dispose();
    // A dialog preview canvas is reused; a canvas we created is discarded, so free its GPU context.
    if (!o.canvas) renderer.forceContextLoss();
  }
}
