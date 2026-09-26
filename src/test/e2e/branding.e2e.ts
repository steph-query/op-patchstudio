import { test, expect } from '@playwright/test';

for (const width of [1440, 800]) {
  test('Fieldwork shell and keyboard navigation at ' + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.addInitScript(() => Object.assign(window, { __TAURI__: { core: { invoke: async () => [] } } }));
    await page.goto('/');
    await expect(page).toHaveTitle(/Fieldwork/);
    await expect(page.getByRole('heading', { name: 'fieldwork.' })).toBeVisible();
    await expect(page.getByLabel('Supported devices')).toContainText('OP–1 FIELD');
    await expect(page.getByLabel('Supported devices')).toContainText('OP–XY');
    await expect(page.getByLabel('Supported devices')).toContainText('TP–7');
    const drum = page.getByRole('tab', { name: 'drum tab', exact: true });
    expect((await drum.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 1440) await page.screenshot({ path: '.maestro/fieldwork-builder-workspace.png', fullPage: true });
    await drum.focus();
    await drum.press('ArrowRight');
    const sample = page.getByRole('tab', { name: 'multisample tab', exact: true });
    await expect(sample).toBeFocused();
    await expect(sample).toHaveAttribute('aria-selected', 'true');
  });
}

/**
 * The icon font must actually load.
 *
 * `src/index.css` imports only the styles the app renders, which took 438 KB of unused
 * webfonts out of the bundle. The failure mode of getting that wrong is silent: a missing
 * `@font-face` is not an error, and the glyph renders as an empty box. `iconFonts.test.ts`
 * checks the CSS against the classes in source; this checks the font is really there.
 */
test('the solid icon font loads and its glyphs have width', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /^drum/ }).waitFor();

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    const faces = [...document.fonts].map(face => `${face.family.replace(/["']/g, '')}@${face.weight}`);
    return {
      faces,
      // `document.fonts.check()` is not usable here: it reports true when the family is
      // absent entirely, because fallback text can still be rendered. Deleting the import
      // left that assertion passing. The registered faces are the real evidence.
      solid: faces.some(face => face === 'Font Awesome 6 Free@900'),
    };
  });
  expect(loaded.solid, `the solid icon font is not registered; faces present: ${loaded.faces.join(', ')}`).toBe(true);

  // And a rendered icon occupies space rather than collapsing to nothing.
  const width = await page.evaluate(() => {
    const icon = document.querySelector('i.fas');
    if (!icon) return -1;
    return Math.round((icon as HTMLElement).getBoundingClientRect().width);
  });
  // -1 means no solid icon was on screen at all, which would make this test vacuous.
  expect(width, 'no i.fas element was rendered, so this assertion proves nothing').toBeGreaterThan(-1);
  if (width >= 0) expect(width, 'the icon collapsed to zero width').toBeGreaterThan(0);
});
