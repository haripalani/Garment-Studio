import { test, expect } from './fixtures';

test.describe('shell', () => {
  test('lays out like the reference at 1440×900', async ({ editor }) => {
    const box = async (sel: string) => (await editor.page.locator(sel).first().boundingBox())!;
    const header = await box('header');
    const pattern = await box('section[aria-label="Sewing pattern"]');
    const aside = await box('aside[aria-label="Inspector"]');
    const tabs = await box('[role="tablist"]');
    expect(header.height).toBe(56);
    expect(Math.round(pattern.x)).toBe(0);
    expect(Math.round(pattern.width)).toBe(560);
    expect(Math.round(aside.x)).toBe(1120);
    expect(Math.round(aside.width)).toBe(320);
    expect(Math.round(tabs.height)).toBe(53);
  });

  test('switches view modes and remembers them after reload', async ({ editor }) => {
    const { page } = editor;
    const view = page.getByRole('radiogroup', { name: 'View' });
    await view.getByRole('radio', { name: '3D' }).click();
    await expect(page.getByRole('region', { name: 'Sewing pattern' })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Sewing pattern' }).click();
    await expect(page.getByRole('region', { name: '3D Preview' })).toHaveCount(0);
  });

  test('toggles the theme', async ({ editor }) => {
    const { page } = editor;
    await page.getByRole('switch', { name: 'Day / night mode' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('shows the piece count per side and refits', async ({ editor }) => {
    const { page } = editor;
    await expect(page.getByText('6 pieces')).toBeVisible();
    await page.getByRole('radio', { name: 'Inside' }).click();
    await expect(page.getByText('9 pieces')).toBeVisible();
  });

  test('zoom buttons and Fit change the pattern zoom', async ({ editor }) => {
    const { page } = editor;
    const zoom = () => page.evaluate(() => (window as never as { __gs: { zoom(): number } }).__gs.zoom());
    const fitted = await zoom();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    expect(await zoom()).toBeGreaterThan(fitted);
    await page.getByRole('button', { name: 'Fit' }).click();
    expect(await zoom()).toBeCloseTo(fitted, 5);
  });

  test('runs the tour from the help button', async ({ editor }) => {
    const { page } = editor;
    await page.getByRole('button', { name: 'Quick tour' }).click();
    const card = page.getByRole('dialog', { name: 'Start with your artwork' });
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('dialog', { name: 'Work on the real pattern' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Work on the real pattern' })).toHaveCount(0);
  });

  test('auth form validates locally and sends nothing', async ({ editor }) => {
    const { page } = editor;
    const requests: string[] = [];
    page.on('request', (r) => {
      if (!r.url().startsWith('http://localhost')) requests.push(r.url());
    });
    await page.getByRole('button', { name: 'Log in' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Log in' }).click();
    await expect(dialog.getByText('Enter a valid email address.')).toBeVisible();
    await expect(dialog.getByLabel('Email')).toHaveAccessibleDescription('Enter a valid email address.');
    await dialog.getByLabel('Email', { exact: true }).fill('a@b.co');
    await dialog.getByLabel('Password', { exact: true }).fill('long-enough-pass');
    await dialog.getByRole('button', { name: 'Log in' }).click();
    await expect(dialog.getByText(/Nothing was sent/)).toBeVisible();
    expect(requests).toEqual([]);
  });
});
