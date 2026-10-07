import { test, expect } from '@playwright/test';

/**
 * The keyboard layer in a real engine.
 *
 * The unit tests for `useAppShortcuts` dispatch synthetic events in jsdom, which
 * cannot answer whether a command chord actually reaches a window listener in
 * WebKit — the engine Tauri uses on macOS. These run in the browser.
 *
 * Note what this cannot cover: inside a browser tab, the browser itself may claim
 * ⌘1–⌘9 before the page sees them. The packaged app has no browser tabs, so the
 * chords are free there. Each keyboard assertion below therefore also checks the
 * behaviour through the path a browser cannot intercept.
 */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __TAURI__: { core: { invoke: async () => [] } } }));
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'drum tab', exact: true })).toBeVisible();
});

test('the shortcut list opens with ? and closes every way it offers', async ({ page }) => {
  await page.locator('body').press('?');
  const dialog = page.getByRole('dialog', { name: /keyboard shortcuts/i });
  await expect(dialog).toBeVisible();

  // It opens at the top, showing its own title. Focusing the Close button at the
  // bottom of a scrollable sheet made the browser scroll past the heading, so the
  // list began mid-sentence — something only a real layout engine can catch.
  await expect(dialog).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInViewport();
  expect(await dialog.evaluate(element => element.scrollTop)).toBe(0);
  // Every group is rendered from the one shortcut table.
  await expect(dialog).toContainText('Anywhere');
  await expect(dialog).toContainText('Takes list');
  await expect(dialog).toContainText('Drum lab');
  await expect(dialog).toContainText('⌘1');

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // And the visible hint reaches the same place, for anyone who would not guess `?`.
  await page.getByRole('button', { name: 'keyboard shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toHaveCount(0);
});

test('? does not interrupt typing a name', async ({ page }) => {
  // The preset name field, which is the field a person is most often typing in when
  // they reach for a punctuation key. This test used to guard itself with
  // `if (await search.count())` against a searchbox that does not exist on this tab,
  // so it asserted nothing at all and passed regardless.
  const name = page.getByPlaceholder(/preset name/i).first();
  await expect(name).toBeVisible();

  await name.click();
  await name.type('kick?snare');
  // The claim being tested: the shortcut did not fire while typing.
  await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toHaveCount(0);
  // The `?` itself is dropped by the preset-name rules — a name becomes a folder on
  // the device, and `?` is not a character those accept. The letters around it are
  // proof the keystrokes reached the field rather than being eaten by the shortcut.
  await expect(name).toHaveValue('kicksnare');

  // And with focus outside a field, the same key does open it.
  //
  // Focus is moved explicitly rather than by clicking the page centre: where that
  // centre lands depends on the layout, so it can land in *another* text field — and
  // this assertion would then be testing the opposite of what it says while still
  // failing honestly. Blurring states the precondition instead of hoping for it.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(page.locator('input:focus, textarea:focus')).toHaveCount(0);
  await page.locator('body').press('?');
  await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeVisible();
});

test('every visible tab shows the number that reaches it', async ({ page }) => {
  // The numbers are what make ⌘1–⌘9 discoverable rather than merely documented, and
  // they must match the order of the tabs actually on screen.
  const tabs = page.getByRole('tab');
  const count = await tabs.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(9);
  for (let index = 0; index < count; index++) {
    await expect(tabs.nth(index)).toContainText('⌘' + (index + 1));
  }
});

test('a command chord that reaches the page switches tabs', async ({ page }) => {
  // Dispatched on window the way the app listens, because a real ⌘2 may be claimed
  // by the browser around this page. In the packaged app nothing competes for it.
  // Unplugged the sidebar is the workbench alone: songs, takes, drum, multisample,
  // library, projects. ⌘4 is therefore the sample builder.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '4', metaKey: true, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('tab', { name: 'multisample tab', exact: true })).toHaveAttribute('aria-selected', 'true');

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '3', metaKey: true, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('tab', { name: 'drum tab', exact: true })).toHaveAttribute('aria-selected', 'true');

  // A number with no tab behind it leaves the selection alone.
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '9', metaKey: true, bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole('tab', { name: 'drum tab', exact: true })).toHaveAttribute('aria-selected', 'true');
});
