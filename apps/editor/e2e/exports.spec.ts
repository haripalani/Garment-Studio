import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { PDFDocument } from 'pdf-lib';
import { pngDpi, pngSize } from '../src/export/png';
import { test, expect, type Editor } from './fixtures';

async function openExport(e: Editor, item: RegExp) {
  await e.page.getByRole('button', { name: 'More exports' }).click();
  await e.page.getByRole('menuitem', { name: item }).click();
  await expect(e.page.getByRole('dialog')).toBeVisible();
}

async function createAndDownload(e: Editor, timeout = 60_000) {
  const download = e.page.waitForEvent('download', { timeout });
  await e.page.getByRole('button', { name: 'Create file' }).click();
  const d = await download;
  return { name: d.suggestedFilename(), bytes: readFileSync(await d.path()) };
}

test.describe('exports', () => {
  test.describe.configure({ timeout: 120_000 });

  test('print files: one PNG per printed piece side, real size, DPI written into the file', async ({ editor }) => {
    await editor.addText('Hello');
    await openExport(editor, /Print files/);
    await editor.page.getByRole('radio', { name: '150 DPI' }).click();
    const { name, bytes } = await createAndDownload(editor);
    expect(name).toMatch(/print-files-150dpi\.zip$/);
    const zip = unzipSync(bytes);
    const manifest = JSON.parse(strFromU8(zip['manifest.json']!)) as {
      dpi: number;
      bleedMm: number;
      files: { path: string; widthMm: number; widthPx: number }[];
    };
    expect(manifest).toMatchObject({ dpi: 150, bleedMm: 5 });
    expect(manifest.files.length).toBeGreaterThan(0);
    for (const f of manifest.files) {
      const png = zip[f.path]!;
      expect(pngDpi(png)).toBe(150);
      expect(pngSize(png).width).toBe(f.widthPx);
      expect(Math.abs(f.widthPx - (f.widthMm * 150) / 25.4)).toBeLessThan(2); // real size
    }
    expect(strFromU8(zip['README.txt']!)).toContain('150 DPI');
  });

  test('sublimation panels: every piece filled with the fabric, bleed and a cut line', async ({ editor }) => {
    const { page } = editor;
    await openExport(editor, /Sublimation panels/);
    await page.getByRole('radio', { name: '150 DPI' }).click();
    const { bytes } = await createAndDownload(editor);
    const zip = unzipSync(bytes);
    const panels = Object.keys(zip).filter((k) => k.startsWith('panels/'));
    expect(panels).toContain('panels/front.png');
    expect(panels.length).toBeGreaterThanOrEqual(4);
    // Pixel check of a panel (regression: the bleed mask once erased the piece and left only the band).
    const px = await page.evaluate(async (b64) => {
      const bin = atob(b64);
      const u8 = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }), { premultiplyAlpha: 'none' });
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const x = c.getContext('2d')!;
      x.drawImage(bmp, 0, 0);
      const at = (u: number, v: number) => [...x.getImageData(Math.round(u * bmp.width), Math.round(v * bmp.height), 1, 1).data];
      return { centre: at(0.5, 0.6), corner: [...x.getImageData(1, 1, 1, 1).data] };
    }, Buffer.from(zip['panels/back.png']!).toString('base64'));
    expect(px.centre).toEqual([242, 240, 234, 255]); // default fabric #f2f0ea fills the piece
    expect(px.corner[3]).toBe(0); // outside the bleed stays transparent
  });

  test('spec sheet: a PDF with overview, placements and printed pieces', async ({ editor }) => {
    await editor.addText('Spec me');
    await openExport(editor, /Spec sheet/);
    const { name, bytes } = await createAndDownload(editor);
    expect(name).toMatch(/spec-sheet\.pdf$/);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(3);
    expect(pdf.getTitle()).toContain('spec sheet');
  });

  test('turntable video: a real MP4 or WebM, or a clear message where the browser cannot encode', async ({ editor, browserName }) => {
    // 120 frames at 1080 × 1080: slow with headless software WebGL.
    test.setTimeout(300_000);
    const { page } = editor;
    await openExport(editor, /Turntable video/);
    await page.getByRole('radio', { name: '4 s' }).click();
    const download = page.waitForEvent('download', { timeout: 280_000 }).catch(() => null);
    await page.getByRole('button', { name: 'Create file' }).click();
    const failed = page.getByText(/Export failed/);
    const outcome = await Promise.race([download.then((d) => ({ d })), failed.waitFor({ timeout: 280_000 }).then(() => ({ d: null }))]);
    if (!outcome.d) {
      // Only acceptable where WebCodecs encoding is missing (some WebKit builds).
      expect(browserName).toBe('webkit');
      await expect(failed).toContainText(/encode video|video encoder/);
      return;
    }
    const bytes = readFileSync(await outcome.d.path());
    expect(bytes.length).toBeGreaterThan(20_000);
    const mp4 = bytes.subarray(4, 8).toString('latin1') === 'ftyp';
    const webm = bytes.readUInt32BE(0) === 0x1a45dfa3;
    expect(mp4 || webm).toBe(true);
    expect(outcome.d.suggestedFilename()).toMatch(mp4 ? /\.mp4$/ : /\.webm$/);
  });
});
