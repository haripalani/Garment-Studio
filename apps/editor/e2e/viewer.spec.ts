import { test, expect, type Editor } from './fixtures';

type Stats = { width: number; height: number; centre: number[]; mean: number[]; varied: number };
type Info = { panels: number; textures: number; cameraAzimuth: number; pixelRatio: number };

const info = (e: Editor) => e.page.evaluate(() => (window as never as { __gs: { studio(): Info | null } }).__gs.studio());
const stats = (e: Editor) =>
  e.page.evaluate(() => (window as never as { __gs: { snapshotStats(): Promise<Stats | null> } }).__gs.snapshotStats());

async function waitForStudio(e: Editor) {
  // First load compiles three.js on the dev server and starts software WebGL: allow time under parallel load.
  await expect.poll(async () => (await info(e))?.panels ?? 0, { timeout: 30_000 }).toBe(6);
  await expect.poll(async () => (await info(e))?.textures ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(8);
}

test.describe('3D preview', () => {
  test.describe.configure({ timeout: 60_000 });

  test('renders the garment with the fabric colour (colour fidelity)', async ({ editor }) => {
    await waitForStudio(editor);
    await editor.page.getByRole('radio', { name: '#26365a' }).click();
    await expect.poll(async () => (await stats(editor))?.varied ?? 0).toBeGreaterThan(0.2);
    const s = (await stats(editor))!;
    // Navy #26365a = (38, 54, 90): the lit centre of the shirt stays close to the real colour.
    const target = [38, 54, 90];
    s.centre.forEach((v, i) => expect(Math.abs(v - target[i]!)).toBeLessThan(45));
  });

  test('2D edits appear on the 3D garment', async ({ editor }) => {
    const { page } = editor;
    await waitForStudio(editor);
    await page.getByRole('radio', { name: '#26365a' }).click();
    const before = (await stats(editor))!.centre;
    // A large light rectangle over the chest (new shapes take a contrasting ink: white on navy).
    await editor.canvas.focus();
    await page.keyboard.press('r');
    await editor.drag(await editor.at('front', [140, 160]), await editor.at('front', [390, 420]));
    await expect
      .poll(async () => (await stats(editor))!.centre.reduce((a, b) => a + b, 0), { timeout: 10_000 })
      .toBeGreaterThan(before.reduce((a, b) => a + b, 0) + 200);
  });

  test('camera presets turn the view; reset returns to the front', async ({ editor }) => {
    const { page } = editor;
    await waitForStudio(editor);
    const cam = page.getByRole('radiogroup', { name: 'Camera' });
    await cam.getByRole('radio', { name: 'Back' }).click();
    await expect.poll(async () => Math.abs((await info(editor))!.cameraAzimuth)).toBeCloseTo(Math.PI, 1);
    await cam.getByRole('radio', { name: 'Side' }).click();
    await expect.poll(async () => (await info(editor))!.cameraAzimuth).toBeCloseTo(Math.PI / 2, 1);
    await page.getByRole('button', { name: 'Reset view' }).click();
    await expect.poll(async () => (await info(editor))!.cameraAzimuth).toBeCloseTo(0, 1);
  });

  test('preview quality changes the render resolution', async ({ editor }) => {
    const { page } = editor;
    await waitForStudio(editor);
    const full = (await info(editor))!.pixelRatio;
    await page.getByRole('combobox', { name: /3D preview quality/ }).click();
    await page.getByRole('option', { name: 'Half' }).click();
    await expect.poll(async () => (await info(editor))!.pixelRatio, { timeout: 15_000 }).toBeCloseTo(full / 2, 2);
  });

  test('3D snapshot downloads a PNG', async ({ editor }) => {
    const { page } = editor;
    await waitForStudio(editor);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: '3D snapshot' }).click();
    const d = await download;
    expect(d.suggestedFilename()).toMatch(/-3d\.png$/);
    const path = await d.path();
    const { statSync, readFileSync } = await import('node:fs');
    expect(statSync(path).size).toBeGreaterThan(20_000);
    expect(readFileSync(path).subarray(1, 4).toString()).toBe('PNG');
  });

  test('scene toggles and look changes are undoable', async ({ editor }) => {
    const { page } = editor;
    await waitForStudio(editor);
    await page.getByRole('button', { name: 'Hanger' }).click();
    await expect(page.getByRole('button', { name: 'Hanger' })).toHaveAttribute('aria-pressed', 'false');
    await page.getByRole('button', { name: 'Neck label' }).click();
    await expect(page.getByRole('button', { name: 'Neck label' })).toHaveAttribute('aria-pressed', 'true');
    await editor.canvas.focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: 'Neck label' })).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: 'Hanger' })).toHaveAttribute('aria-pressed', 'true');
    expect((await stats(editor))!.varied).toBeGreaterThan(0.2);
  });
});
