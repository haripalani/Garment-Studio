import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './fixtures';

test.describe('visual baselines', () => {
  // Pixel baselines are kept for Chromium only; font rasterisation differs per engine.
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium baselines only');
  // The 3D view is lazy-loaded; wait until it is mounted so its (masked) canvas is in place.
  test.beforeEach(async ({ editor }) => {
    await expect.poll(() => editor.page.evaluate(() => (window as never as { __gs: { studio(): { panels: number } | null } }).__gs.studio()?.panels ?? 0), { timeout: 20_000 }).toBe(6);
  });

  test('empty editor (dark)', async ({ editor }) => {
    await expect(editor.page).toHaveScreenshot('editor-empty-dark.png', { mask: [editor.page.getByTestId('viewer-canvas')] });
  });

  test('editor with a selected text layer (light)', async ({ editor }) => {
    const { page } = editor;
    await page.getByRole('switch', { name: 'Day / night mode' }).click();
    await editor.addText('BASELINE');
    await page.mouse.move(5, 5);
    await expect(page).toHaveScreenshot('editor-text-light.png', { mask: [page.getByTestId('viewer-canvas')] });
  });

  test('design system gallery', async ({ editor }) => {
    await editor.page.goto('/ui');
    await expect(editor.page.getByRole('heading', { name: 'Design system' })).toBeVisible();
    await expect(editor.page).toHaveScreenshot('gallery.png', { fullPage: true });
  });
});

test.describe('accessibility (axe, WCAG 2.1 AA)', () => {
  // A full axe run takes several seconds per page under parallel load.
  test.describe.configure({ timeout: 60_000 });

  // Park the pointer and let colour transitions (150–200 ms) finish so axe measures settled colours.
  const scan = async (page: import('@playwright/test').Page) => {
    await page.mouse.move(2, 890);
    await page.waitForTimeout(350);
    return new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  };

  const serious = (r: Awaited<ReturnType<typeof scan>>) =>
    r.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id}: ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);

  test('editor has no serious violations (empty and with a selection)', async ({ editor }) => {
    expect(serious(await scan(editor.page))).toEqual([]);
    await editor.addText('A11Y');
    expect(serious(await scan(editor.page))).toEqual([]);
  });

  test('light theme has no serious violations', async ({ editor }) => {
    await editor.page.getByRole('switch', { name: 'Day / night mode' }).click();
    await editor.addText('A11Y');
    expect(serious(await scan(editor.page))).toEqual([]);
  });

  test('gallery has no serious violations', async ({ editor }) => {
    await editor.page.goto('/ui');
    await expect(editor.page.getByRole('heading', { name: 'Design system' })).toBeVisible();
    expect(serious(await scan(editor.page))).toEqual([]);
  });
});
