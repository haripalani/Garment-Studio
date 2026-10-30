import { test, expect } from './fixtures';

test.describe('pattern editor', () => {
  test('adds text and edits it from the panel', async ({ editor }) => {
    await editor.addText('MADE BY HAND');
    await expect(editor.layerOptions).toHaveCount(1);
    await expect(editor.layerOptions.first()).toContainText('MADE BY HAND');
    const [l] = await editor.layers();
    expect(l).toMatchObject({ type: 'text', pieceId: 'front', side: 'outside' });
    // The box refits to the text: wide and short.
    expect(l!.w / l!.h).toBeGreaterThan(3);
  });

  test('drags a layer from the front onto the back piece', async ({ editor }) => {
    await editor.addText('MOVE ME');
    const [l] = await editor.layers();
    const from = await editor.at('front', [l!.x, l!.y]);
    const to = await editor.at('back', [265, 400]);
    await editor.drag(from, to);
    const [moved] = await editor.layers();
    expect(moved!.pieceId).toBe('back');
    expect(moved!.x).toBeCloseTo(265, -1);
    expect(moved!.y).toBeCloseTo(400, -1);
  });

  test('scales from a corner keeping proportions and rotates from the handle', async ({ editor }) => {
    // 32 pointer moves, each re-rendering the live 3D preview in software WebGL: the slowest test under load.
    test.slow();
    await editor.addText('SCALE');
    const [l] = await editor.layers();
    const se = await editor.at('front', [l!.x + l!.w / 2, l!.y + l!.h / 2]);
    await editor.drag(se, [se[0] + 40, se[1] + 40]);
    const [s] = await editor.layers();
    expect(s!.w).toBeGreaterThan(l!.w * 1.2);
    expect(s!.w / s!.h).toBeCloseTo(l!.w / l!.h, 2);

    // Rotate handle sits 22 px above the top edge's midpoint.
    const top = await editor.at('front', [s!.x, s!.y - s!.h / 2]);
    const centre = await editor.at('front', [s!.x, s!.y]);
    await editor.drag([top[0], top[1] - 22], [centre[0] + 120, centre[1]], { steps: 20 });
    await expect(editor.page.getByRole('textbox', { name: 'Rotation' })).toHaveValue('90');
  });

  test('draws shapes with the tool and keyboard shortcut', async ({ editor }) => {
    const { page } = editor;
    await editor.canvas.focus();
    await page.keyboard.press('r');
    const a = await editor.at('back', [150, 300]);
    const b = await editor.at('back', [350, 420]);
    await editor.drag(a, b);
    const [shape] = await editor.layers();
    expect(shape).toMatchObject({ type: 'shape', pieceId: 'back' });
    expect(shape!.w).toBeCloseTo(200, -1);
    expect(shape!.h).toBeCloseTo(120, -1);
  });

  test('undo / redo / delete / duplicate from the keyboard', async ({ editor }) => {
    const { page } = editor;
    await editor.addText('ONE');
    await editor.canvas.focus();
    await page.keyboard.press('Control+d');
    await expect(editor.layerOptions).toHaveCount(2);
    await page.keyboard.press('Delete');
    await expect(editor.layerOptions).toHaveCount(1);
    await page.keyboard.press('Control+z');
    await expect(editor.layerOptions).toHaveCount(2);
    await page.keyboard.press('Control+Shift+z');
    await expect(editor.layerOptions).toHaveCount(1);
  });

  test('nudges with the arrow keys and edits size in the Transform section', async ({ editor }) => {
    const { page } = editor;
    await editor.addText('NUDGE');
    const [l] = await editor.layers();
    await editor.canvas.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    const [n] = await editor.layers();
    expect(n!.x).toBeCloseTo(l!.x + 10);
    expect(n!.y).toBeCloseTo(l!.y + 1);

    const width = page.getByRole('textbox', { name: 'Width' });
    await width.fill('20');
    await width.press('Enter');
    const [r] = await editor.layers();
    expect(r!.w).toBeCloseTo(200);
  });

  test('presets move artwork across pieces and sides', async ({ editor }) => {
    const { page } = editor;
    await editor.addText('LABEL');
    await editor.panel().getByRole('button', { name: 'Printed label' }).click();
    await expect(page.getByText('9 pieces')).toBeVisible();
    const [l] = await editor.layers();
    expect(l).toMatchObject({ pieceId: 'back', side: 'inside' });
    await expect(editor.layerOptions.first()).toContainText('inside');
  });

  test('reorders layers by keyboard in the list', async ({ editor }) => {
    await editor.addText('FIRST');
    await editor.addText('SECOND');
    await expect(editor.layerOptions.first()).toContainText('SECOND');
    await editor.layerOptions.first().getByRole('button', { name: /SECOND/ }).focus();
    await editor.page.keyboard.press('Alt+ArrowDown');
    await expect(editor.layerOptions.first()).toContainText('FIRST');
  });
});
