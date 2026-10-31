// Turntable video: one full turn of the garment, encoded in the browser (WebCodecs via mediabunny).
// MP4/H.264 where the browser can encode it, otherwise WebM (VP9, then VP8).
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeVideo,
  type VideoCodec,
} from 'mediabunny';
import type { GarmentModel, ProjectDoc } from '@gs/core';
import { withStudio } from '../render/scene';
import { PREVIEW_PX_PER_MM } from '../viewer/baker';
import { FPS, type VideoSize } from './options';
import { watermark } from '../cloud/exports';

export interface VideoResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  codec: VideoCodec;
  frames: number;
}

/** First codec this browser can encode at this size: H.264 (MP4) → VP9 → VP8 (WebM). */
export async function pickCodec(width: number, height: number): Promise<{ codec: VideoCodec; mp4: boolean } | null> {
  for (const [codec, mp4] of [['avc', true], ['vp9', false], ['vp8', false]] as const) {
    if (await canEncodeVideo(codec, { width, height, bitrate: QUALITY_HIGH })) return { codec, mp4 };
  }
  return null;
}

export async function buildTurntable(
  garment: GarmentModel,
  doc: ProjectDoc,
  o: {
    size: VideoSize;
    seconds: number;
    onProgress?: (done: number, total: number) => void;
    signal?: AbortSignal;
    /** Plans with a watermark: frames pass through a 2D canvas that adds it. */
    watermark?: boolean;
  },
): Promise<VideoResult> {
  if (typeof VideoEncoder === 'undefined') throw new Error('This browser cannot encode video (WebCodecs is missing).');
  const [width, height] = o.size.split('x').map(Number) as [number, number];
  const pick = await pickCodec(width, height);
  if (!pick) throw new Error('This browser has no usable video encoder for this size.');
  const frames = Math.round(o.seconds * FPS);
  return withStudio(garment, doc, PREVIEW_PX_PER_MM, async (studio) => {
    const view = studio.offscreenView(width, height);
    const output = new Output({
      format: pick.mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const marked = o.watermark ? document.createElement('canvas') : null;
    if (marked) {
      marked.width = width;
      marked.height = height;
    }
    const source = new CanvasSource(marked ?? view.canvas, { codec: pick.codec, bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source, { frameRate: FPS });
    try {
      await output.start();
      for (let i = 0; i < frames; i++) {
        if (o.signal?.aborted) {
          await output.cancel();
          throw new DOMException('Video cancelled', 'AbortError');
        }
        // Start at the front and turn once; the last frame stops one step short of the first.
        view.render((i / frames) * Math.PI * 2);
        if (marked) marked.getContext('2d')!.drawImage(watermark(view.canvas as HTMLCanvasElement), 0, 0);
        await source.add(i / FPS, 1 / FPS);
        o.onProgress?.(i + 1, frames);
      }
      await output.finalize();
      const buffer = (output.target as BufferTarget).buffer;
      if (!buffer) throw new Error('The video encoder produced no data.');
      const type = pick.mp4 ? 'video/mp4' : 'video/webm';
      return { blob: new Blob([buffer], { type }), ext: pick.mp4 ? 'mp4' : 'webm', codec: pick.codec, frames };
    } finally {
      view.dispose();
    }
  });
}
