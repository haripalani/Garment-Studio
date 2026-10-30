import { test, expect, makePng } from './fixtures';

test.describe('images', () => {
  test('uploads through the Image button, crops and trims', async ({ editor }) => {
    const { page } = editor;
    const png = await makePng(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Image', exact: true }).click();
    await (await chooser).setFiles({ name: 'badge.png', mimeType: 'image/png', buffer: png });

    await expect(editor.layerOptions.first()).toContainText('badge');
    const [before] = await editor.layers();
    expect(before!.type).toBe('image');
    expect(before!.w / before!.h).toBeCloseTo(400 / 300, 2);

    await editor.panel().getByRole('button', { name: 'Crop' }).click();
    await editor.panel().getByRole('button', { name: 'Trim empty edges' }).click();
    const [after] = await editor.layers();
    // The circle is 180 px of a 400 px wide canvas; the physical scale is unchanged.
    expect(after!.w / before!.w).toBeCloseTo(181 / 400, 1);
    expect(after!.w / after!.h).toBeCloseTo(1, 1);
    await editor.panel().getByRole('button', { name: 'Reset crop' }).click();
    const [reset] = await editor.layers();
    expect(reset!.w).toBeCloseTo(before!.w, 3);
  });

  test('rejects unsupported files with a message', async ({ editor }) => {
    const { page } = editor;
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Image', exact: true }).click();
    await (await chooser).setFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
    await expect(page.getByRole('alert').filter({ hasText: 'PNG, JPEG, WebP, AVIF or SVG' })).toBeVisible();
    await expect(editor.layerOptions).toHaveCount(0);
  });

  test('drops an image onto the piece under the pointer', async ({ editor }) => {
    const { page } = editor;
    const png = await makePng(page);
    const target = await editor.at('sleeveL', [185, 140]);
    const dt = await page.evaluateHandle(
      ({ b64 }) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const d = new DataTransfer();
        d.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
        return d;
      },
      { b64: png.toString('base64') },
    );
    const wrap = editor.canvas.locator('..');
    await wrap.dispatchEvent('dragover', { dataTransfer: dt, clientX: target[0], clientY: target[1] });
    await wrap.dispatchEvent('drop', { dataTransfer: dt, clientX: target[0], clientY: target[1] });
    await expect(editor.layerOptions).toHaveCount(1);
    const [l] = await editor.layers();
    expect(l!.pieceId).toBe('sleeveL');
    expect(l!.x).toBeCloseTo(185, -1);
  });

  test('colour adjustments and reset', async ({ editor }) => {
    const { page } = editor;
    const png = await makePng(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Image', exact: true }).click();
    await (await chooser).setFiles({ name: 'badge.png', mimeType: 'image/png', buffer: png });
    const panel = editor.panel();
    await panel.getByRole('button', { name: 'Invert' }).click();
    await expect(panel.getByRole('button', { name: 'Invert' })).toHaveAttribute('aria-pressed', 'true');
    await panel.getByRole('switch', { name: 'Fill with colour' }).click();
    await expect(panel.getByRole('button', { name: 'Reset colours' })).toBeEnabled();
    await panel.getByRole('button', { name: 'Reset colours' }).click();
    await expect(panel.getByRole('button', { name: 'Invert' })).toHaveAttribute('aria-pressed', 'false');
    await expect(panel.getByRole('switch', { name: 'Fill with colour' })).toHaveAttribute('aria-checked', 'false');
  });
});
