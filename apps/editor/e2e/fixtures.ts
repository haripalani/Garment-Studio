import { test as base, expect, type Page } from '@playwright/test';

type Vec = [number, number];

/** A page with the tour marked done and a clean local store, ready on the editor. */
export const test = base.extend<{ editor: Editor }>({
  editor: async ({ page }, use) => {
    await page.addInitScript(() => {
      // Fresh state per test: tour done, default prefs; IndexedDB is cleared below.
      if (!sessionStorage.getItem('gs:e2e-init')) {
        localStorage.clear();
        localStorage.setItem(
          'gs:prefs',
          JSON.stringify({ state: { theme: 'dark', viewMode: 'split', unit: 'cm', locale: 'en', tourDone: true }, version: 0 }),
        );
        indexedDB.deleteDatabase('keyval-store');
        sessionStorage.setItem('gs:e2e-init', '1');
      }
    });
    await page.goto('/');
    const editor = new Editor(page);
    await editor.ready();
    await use(editor);
  },
});

export { expect };

export class Editor {
  constructor(readonly page: Page) {}

  async ready() {
    await this.page.waitForFunction(() => '__gs' in window && (window as never as { __gs: { zoom(): number } }).__gs.zoom() > 0);
    await expect(this.canvas).toBeVisible();
  }

  get canvas() {
    return this.page.locator('[data-testid="pattern-canvas"]');
  }

  get layerOptions() {
    return this.page.getByRole('list', { name: 'Layers' }).getByRole('listitem');
  }

  panel() {
    return this.page.getByRole('region', { name: 'Selected item' });
  }

  layers() {
    return this.page.evaluate(() => (window as never as { __gs: { layers(): Layer[] } }).__gs.layers());
  }

  /** Page coordinates for a point in a piece's frame (mm). */
  async at(pieceId: string, p: Vec): Promise<Vec> {
    const r = await this.page.evaluate(
      ([id, pt]) => (window as never as { __gs: { piecePointToPage(i: string, q: Vec): Vec | null } }).__gs.piecePointToPage(id, pt),
      [pieceId, p] as const,
    );
    if (!r) throw new Error(`Piece ${pieceId} is not visible`);
    return r;
  }

  /** Real mouse drag with intermediate moves. */
  async drag(from: Vec, to: Vec, opts: { shift?: boolean; steps?: number } = {}) {
    const m = this.page.mouse;
    if (opts.shift) await this.page.keyboard.down('Shift');
    await m.move(from[0], from[1]);
    await m.down();
    await m.move(to[0], to[1], { steps: opts.steps ?? 12 });
    await m.up();
    if (opts.shift) await this.page.keyboard.up('Shift');
  }

  async addText(text: string) {
    await this.page.getByRole('complementary', { name: 'Inspector' }).getByRole('button', { name: 'Text', exact: true }).click();
    const field = this.panel().getByRole('textbox', { name: 'Text' });
    await expect(field).toBeFocused();
    await field.fill(text);
    await field.blur();
  }
}

export interface Layer {
  id: string;
  pieceId: string;
  side: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: string;
  wrap: boolean;
}

/** A PNG: transparent margins around a filled circle, made in the page. */
export async function makePng(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 400;
    c.height = 300;
    const x = c.getContext('2d')!;
    x.fillStyle = '#e4572e';
    x.beginPath();
    x.arc(200, 150, 90, 0, Math.PI * 2);
    x.fill();
    return c.toDataURL('image/png').split(',')[1]!;
  });
  return Buffer.from(b64, 'base64');
}
