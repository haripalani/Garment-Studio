// Staging smoke test: production builds over HTTPS behind one proxy (Secure cookies, presigned storage
// through the proxy, production config). Runs against infra/staging unless STAGING_URL is set.
import { randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { makePng } from '../e2e/fixtures';

const MAILPIT = process.env.STAGING_MAILPIT ?? 'http://127.0.0.1:58125';

async function verifyLink(to: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await r.json()) as { messages: { ID: string }[] };
    for (const m of messages) {
      const text = ((await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string }).Text;
      const link = /https?:\/\/\S+\/auth\/verify\?token=[\w-]+/.exec(text)?.[0];
      if (link) return link;
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no verification mail for ${to}`);
}

test('staging: sign up, confirm, upload an image, save to the cloud, survive a reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('gs:prefs')) {
      localStorage.setItem('gs:prefs', JSON.stringify({ state: { theme: 'dark', viewMode: 'pattern', unit: 'cm', locale: 'en', tourDone: true }, version: 0 }));
    }
  });
  await page.goto('/');
  await expect(page.getByTestId('pattern-canvas')).toBeVisible({ timeout: 30_000 });
  const email = `smoke-${randomBytes(5).toString('hex')}@example.test`;
  const password = `pw-${randomBytes(9).toString('hex')}`;

  await page.getByRole('button', { name: 'Log in' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('radio', { name: 'Sign up' }).click();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.locator('[type=submit]').click();
  await expect(page.getByRole('button', { name: 'Account' })).toContainText(email);

  await page.goto(await verifyLink(email));
  await expect(page.getByTestId('save-status')).toHaveText('Saved to cloud', { timeout: 45_000 });

  // An image: presigned multipart upload straight to storage through the proxy, then antivirus scan.
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Image', exact: true }).click();
  await (await chooser).setFiles({ name: 'smoke.png', mimeType: 'image/png', buffer: await makePng(page) });
  await expect(page.getByRole('list', { name: 'Layers' }).getByRole('listitem')).toHaveCount(1);
  // The status still reads "Saved to cloud" from before; wait for the save that includes the image.
  await expect(page.getByTestId('save-status')).not.toHaveText('Saved to cloud', { timeout: 5_000 });
  await expect(page.getByTestId('save-status')).toHaveText('Saved to cloud', { timeout: 45_000 });

  // The session comes back from the HttpOnly Secure refresh cookie over HTTPS.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Account' })).toContainText(email, { timeout: 30_000 });
  await expect(page.getByRole('list', { name: 'Layers' }).getByRole('listitem')).toHaveCount(1);
});
