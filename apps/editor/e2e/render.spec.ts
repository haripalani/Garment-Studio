import { readFileSync } from 'node:fs';
import { pngSize } from '../src/export/png';
import { test, expect } from './fixtures';

// Path tracing compiles a very large shader: with software WebGL (headless default) that takes many minutes,
// so this runs in Chromium on the machine's GPU (ANGLE/D3D11 on Windows). Without a GPU it's skipped.
const GPU = process.platform === 'win32' && !process.env.CI;
test.use({ launchOptions: { args: GPU ? ['--use-angle=d3d11', '--ignore-gpu-blocklist'] : [] } });

test.describe('catalogue render (GPU)', () => {
  test('path-traced preview and a local render that saves a PNG', async ({ editor, browserName }) => {
    test.skip(browserName !== 'chromium' || !GPU, 'needs Chromium with a GPU');
    test.setTimeout(300_000);
    const { page } = editor;
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    const canvas = page.getByTestId('render-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByText(/Previewing/)).toBeVisible();
    await expect(page.getByText(/Previewing/)).toBeHidden({ timeout: 240_000 });
    // Smallest size, draft: shortest local render.
    await page.getByRole('combobox', { name: 'Quality' }).click();
    await page.getByRole('option', { name: /Draft/ }).click();
    await page.getByRole('combobox', { name: 'Image size' }).click();
    await page.getByRole('option', { name: /1080 × 1920/ }).click();
    await page.getByRole('button', { name: 'Render on this computer' }).click();
    await expect(page.getByRole('progressbar', { name: 'Catalogue render' })).toBeVisible();
    await expect(page.getByText(/Rendered in/)).toBeVisible({ timeout: 240_000 });
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save PNG' }).click();
    const d = await download;
    const png = readFileSync(await d.path());
    expect(pngSize(png)).toEqual({ width: 1080, height: 1920 });
    expect(png.length).toBeGreaterThan(50_000);
    expect(d.suggestedFilename()).toMatch(/-preview-1080x1920\.png$/);
  });
});
