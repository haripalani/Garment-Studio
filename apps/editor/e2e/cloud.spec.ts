// Cloud app end to end: the editor against the real API (Postgres, Redis, S3, Mailpit), with two
// browser contexts standing in for two devices of the same account.
import { randomBytes } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { test, expect, Editor } from './fixtures';

const MAILPIT = 'http://127.0.0.1:58025';

async function mailLink(to: string, kind: 'verify' | 'magic' | 'reset'): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`);
    const { messages } = (await r.json()) as { messages: { ID: string }[] };
    for (const m of messages) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)).json()) as { Text: string };
      const link = new RegExp(`https?://\\S+/auth/${kind}\\?token=[\\w-]+`).exec(full.Text)?.[0];
      if (link) return link.replace(/^https?:\/\/[^/]+/, '');
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  throw new Error(`no ${kind} mail for ${to}`);
}

const account = () => ({ email: `e2e-${randomBytes(5).toString('hex')}@example.test`, password: `pw-${randomBytes(9).toString('hex')}` });

async function openAuth(page: Page) {
  await page.getByRole('button', { name: 'Log in' }).click();
  return page.getByRole('dialog');
}

async function signUp(e: Editor, a: { email: string; password: string }) {
  const dialog = await openAuth(e.page);
  await dialog.getByRole('radio', { name: 'Sign up' }).click();
  await dialog.getByLabel('Email').fill(a.email);
  await dialog.getByLabel('Password', { exact: true }).fill(a.password);
  await dialog.getByRole('button', { name: 'Sign up', exact: true }).and(dialog.locator('[type=submit]')).click();
  await expect(e.page.getByRole('button', { name: 'Account' })).toContainText(a.email, { timeout: 20_000 });
  await expect(status(e.page)).toHaveText('Confirm your email to save to the cloud');
  await e.page.goto(await mailLink(a.email, 'verify'));
  await e.ready();
  await expect(status(e.page)).toHaveText('Saved to cloud', { timeout: 45_000 });
}

async function logIn(e: Editor, a: { email: string; password: string }) {
  const dialog = await openAuth(e.page);
  await dialog.getByLabel('Email').fill(a.email);
  await dialog.getByLabel('Password', { exact: true }).fill(a.password);
  await dialog.locator('[type=submit]').click();
  await expect(e.page.getByRole('button', { name: 'Account' })).toContainText(a.email, { timeout: 20_000 });
}

const status = (page: Page) => page.getByTestId('save-status');

/** A second device: a fresh browser context with its own storage. */
async function secondDevice(browser: Browser): Promise<Editor> {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-GB' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('gs:e2e-init')) {
      localStorage.setItem(
        'gs:prefs',
        JSON.stringify({ state: { theme: 'dark', viewMode: 'pattern', unit: 'cm', locale: 'en', tourDone: true }, version: 0 }),
      );
      sessionStorage.setItem('gs:e2e-init', '1');
    }
  });
  await page.goto('/');
  const e = new Editor(page);
  await e.ready();
  return e;
}

async function openFromBrowser(e: Editor, name: RegExp) {
  await e.page.getByRole('button', { name: 'Your designs' }).click();
  const list = e.page.getByRole('list', { name: 'Your designs' });
  await list.getByRole('button', { name: name }).first().click();
  await expect(e.page.getByRole('dialog')).toBeHidden();
}

// No live 3D preview: these tests are about accounts and sync, and several editors run at once.
test.use({ viewMode: 'pattern' });

test.describe('cloud app', () => {
  test.describe.configure({ timeout: 150_000 });

  test('sign up, confirm the email and the design saves to the cloud; the session survives a reload', async ({ editor }) => {
    const a = account();
    await editor.addText('CLOUD ONE');
    await signUp(editor, a);
    await editor.page.reload();
    await editor.ready();
    await expect(editor.page.getByRole('button', { name: 'Account' })).toContainText(a.email, { timeout: 20_000 });
    await expect(editor.layerOptions).toHaveCount(1);
    await expect(status(editor.page)).toHaveText(/Saved/);
  });

  test('wrong password is explained; magic link signs in; log out', async ({ editor }) => {
    const a = account();
    await signUp(editor, a);
    await editor.page.getByRole('button', { name: 'Account' }).click();
    await editor.page.getByRole('menuitem', { name: 'Log out' }).click();
    await expect(editor.page.getByRole('button', { name: 'Log in' })).toBeVisible();
    const dialog = await openAuth(editor.page);
    await dialog.getByLabel('Email').fill(a.email);
    await dialog.getByLabel('Password', { exact: true }).fill('not the password');
    await dialog.locator('[type=submit]').click();
    await expect(dialog.getByRole('alert')).toHaveText('Email or password is incorrect.');
    await dialog.getByRole('button', { name: 'Email me a login link instead' }).click();
    await expect(dialog.getByRole('status')).toContainText(a.email);
    await editor.page.goto(await mailLink(a.email, 'magic'));
    await editor.ready();
    await expect(editor.page.getByRole('button', { name: 'Account' })).toContainText(a.email, { timeout: 20_000 });
  });

  test('two devices: a design opened on the second device, and edits arriving live on the first', async ({ editor, browser }) => {
    const a = account();
    await editor.addText('FROM A');
    await signUp(editor, a);
    const b = await secondDevice(browser);
    await logIn(b, a);
    await openFromBrowser(b, /Open Untitled design/);
    await expect(b.layerOptions).toHaveCount(1);
    await expect(b.layerOptions.first()).toContainText('FROM A');
    await b.addText('FROM B');
    await expect(status(b.page)).toHaveText('Saved to cloud', { timeout: 45_000 });
    // Device A gets a live notice and merges the change in, without a reload.
    await expect(editor.layerOptions).toHaveCount(2, { timeout: 45_000 });
    await expect(editor.layerOptions.first()).toContainText('FROM B');
    await b.page.context().close();
  });

  test('offline edits that clash with the cloud become a conflicted copy; nothing is lost', async ({ editor, browser }) => {
    const a = account();
    await editor.addText('SHARED');
    await signUp(editor, a);
    const b = await secondDevice(browser);
    await logIn(b, a);
    await openFromBrowser(b, /Open Untitled design/);
    await expect(b.layerOptions).toHaveCount(1);
    // B goes offline and edits the same text; A edits it too and saves to the cloud first.
    await b.page.context().setOffline(true);
    await b.layerOptions.first().click();
    await b.panel().getByRole('textbox', { name: 'Text' }).fill('EDIT ON B');
    await b.panel().getByRole('textbox', { name: 'Text' }).blur();
    await expect(status(b.page)).toHaveText('Offline: saved on this device', { timeout: 45_000 });
    await editor.layerOptions.first().click();
    await editor.panel().getByRole('textbox', { name: 'Text' }).fill('EDIT ON A');
    await editor.panel().getByRole('textbox', { name: 'Text' }).blur();
    await expect(status(editor.page)).toHaveText('Saved to cloud', { timeout: 45_000 });
    // Back online: B can't merge (same layer), keeps the cloud version and saves its own as a copy.
    await b.page.context().setOffline(false);
    await b.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(b.page.getByText(/saved as “Untitled design \(conflicted copy\)”/)).toBeVisible({ timeout: 30_000 });
    await expect(b.layerOptions.first()).toContainText('EDIT ON A');
    await b.page.getByRole('button', { name: 'Your designs' }).click();
    const list = b.page.getByRole('list', { name: 'Your designs' });
    await expect(list.getByRole('listitem', { name: 'Untitled design (conflicted copy)' })).toContainText('Conflicted copy');
    await list.getByRole('button', { name: 'Open Untitled design (conflicted copy)' }).click();
    await expect(b.layerOptions.first()).toContainText('EDIT ON B');
    await b.page.context().close();
  });

  test('project browser: rename, duplicate, trash and restore', async ({ editor }) => {
    const { page } = editor;
    await editor.addText('BROWSER');
    await signUp(editor, account());
    await page.getByRole('button', { name: 'Your designs' }).click();
    const list = page.getByRole('list', { name: 'Your designs' });
    await list.getByRole('button', { name: 'Rename Untitled design' }).click();
    await list.getByRole('textbox', { name: 'Design name' }).fill('Summer drop');
    await list.getByRole('textbox', { name: 'Design name' }).press('Enter');
    await expect(list.getByRole('listitem', { name: 'Summer drop' })).toBeVisible({ timeout: 20_000 });
    await list.getByRole('button', { name: 'Duplicate Summer drop' }).click();
    await expect(list.getByRole('listitem', { name: 'Summer drop (copy)' })).toBeVisible({ timeout: 20_000 });
    await list.getByRole('button', { name: 'Move to trash Summer drop (copy)' }).click();
    await expect(list.getByRole('listitem', { name: 'Summer drop (copy)' })).toBeHidden();
    await page.getByRole('dialog').getByRole('radio', { name: 'Trash' }).click();
    await list.getByRole('button', { name: 'Restore Summer drop (copy)' }).click({ timeout: 20_000 });
    await page.getByRole('dialog').getByRole('radio', { name: 'Designs' }).click();
    await expect(list.getByRole('listitem', { name: 'Summer drop (copy)' })).toBeVisible();
    await expect(list.getByRole('listitem', { name: 'Summer drop (copy)' })).toContainText('In your account', { timeout: 15_000 });
  });
});
