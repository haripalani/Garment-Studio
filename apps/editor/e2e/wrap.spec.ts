import { test, expect } from './fixtures';

/** Average RGB of a few canvas pixels around a page point. */
async function sample(page: import('@playwright/test').Page, p: [number, number]) {
  return page.evaluate(([x, y]) => {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="pattern-canvas"]')!;
    const r = c.getBoundingClientRect();
    const k = c.width / r.width;
    const ctx = c.getContext('2d')!;
    const d = ctx.getImageData(Math.round((x - r.left) * k) - 1, Math.round((y - r.top) * k) - 1, 3, 3).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += (d[i]! + d[i + 1]! + d[i + 2]!) / 3;
    return s / (d.length / 4);
  }, p);
}

test('artwork running off the front continues on the back across the side seam', async ({ editor }) => {
  const { page } = editor;
  // Dark rectangle straddling the front's left side seam (x = 0 on the front).
  await editor.canvas.focus();
  await page.keyboard.press('r');
  // Centre at x = 20 mm, clearly inside the front; 40 mm of it runs past the seam.
  await editor.drag(await editor.at('front', [-40, 380]), await editor.at('front', [80, 520]));
  const [rect] = await editor.layers();
  expect(rect!.pieceId).toBe('front');

  // Front's left side seam is sewn to the back's right side seam: x = 530 on the back.
  const onBack = await editor.at('back', [530 - 25, 450]);
  const before = await sample(page, onBack);
  await editor.panel().getByRole('button', { name: 'Wrap over seams' }).click();
  await expect(editor.layerOptions.first()).toContainText('wraps seams');
  await page.waitForTimeout(100);
  const after = await sample(page, onBack);
  // Fabric is light; the wrapped artwork is near-black.
  expect(before).toBeGreaterThan(180);
  expect(after).toBeLessThan(80);

  // Turning wrap off removes it again.
  await editor.panel().getByRole('button', { name: 'Wrap over seams' }).click();
  await page.waitForTimeout(100);
  expect(await sample(page, onBack)).toBeGreaterThan(180);
});
