import { test, expect, makePng } from './fixtures';

test.describe('local persistence', () => {
  // Reloads the whole editor (dev server, software WebGL); slow while GPU render and video tests run in parallel.
  test.describe.configure({ timeout: 120_000 });

  test('restores the design, including images, after a reload', async ({ editor }) => {
    const { page } = editor;
    await editor.addText('KEEP ME');
    const png = await makePng(page);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Image', exact: true }).click();
    await (await chooser).setFiles({ name: 'keep.png', mimeType: 'image/png', buffer: png });
    await expect(editor.layerOptions).toHaveCount(2);
    await expect(page.getByText(/Saved on this device/)).toBeVisible();

    await page.reload();
    await editor.ready();
    await expect(editor.layerOptions).toHaveCount(2);
    await expect(editor.layerOptions.nth(0)).toContainText('keep');
    await expect(editor.layerOptions.nth(1)).toContainText('KEEP ME');
    // No "could not be loaded" error: the image came back from IndexedDB.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('New design clears the work after confirmation', async ({ editor }) => {
    const { page } = editor;
    await editor.addText('GONE');
    await page.getByRole('button', { name: 'New design' }).click();
    const dialog = page.getByRole('dialog', { name: 'Start a new design?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(editor.layerOptions).toHaveCount(1);
    await page.getByRole('button', { name: 'New design' }).click();
    await dialog.getByRole('button', { name: 'New design' }).click();
    await expect(editor.layerOptions).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
  });
});
