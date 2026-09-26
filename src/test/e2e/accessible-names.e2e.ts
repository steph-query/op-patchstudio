import { test, expect } from '@playwright/test';

/**
 * Every control a person can operate should say what it is.
 *
 * This is a sweep rather than a list, because the gaps found by hand were the ones
 * nobody would think to look at: five Carbon toggles whose accessible name was the
 * word "off", and the library's select-all checkbox. Asserting the rule across
 * whatever is on screen is what stops the next control being added without a name.
 */
const CONTROLS = 'button, [role=button], input[type=range], input[type=checkbox], select, a[href]';

async function unnamed(page: import('@playwright/test').Page) {
  return page.evaluate((selector) => {
    const missing: string[] = [];
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const described = element.getAttribute('aria-labelledby');
      let name = element.getAttribute('aria-label') || element.getAttribute('title') || (element.textContent || '').trim();
      if (!name && described) name = (document.getElementById(described)?.textContent || '').trim();
      if (!name && element.id) name = (document.querySelector(`label[for="${element.id}"]`)?.textContent || '').trim();
      if (!name && element.closest('label')) name = (element.closest('label')!.textContent || '').trim();
      if (!name) missing.push(`<${element.tagName.toLowerCase()} class="${element.className}">`);
    }
    return missing;
  }, CONTROLS);
}

test('every control on every tab says what it is', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-1', vendor_id: 0x2367, product_id: 1, location_id: 7, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-1', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 3e9, description: 'fixture' }];
        case 'mtp_scan_presets': return { presets: [], projects: [], standalone_samples: [] };
        case 'mtp_scan_tree': return { entries: [], missing_roots: [], roots: [] };
        case 'catalog_open':
        case 'catalog_status': return { path: '/Users/fixture/Music/Fieldwork Library', assets: 0, bytes: 0, occurrences: 0 };
        default: return [];
      }
    } } } });
  });

  await page.goto('/');
  expect(await unnamed(page), 'drum lab').toEqual([]);

  for (const tab of ['multisample tab', 'takes tab', 'library tab', 'projects']) {
    // Asserted, not skipped: a tab that stops existing should fail this test rather
    // than quietly reduce what it covers.
    const target = page.getByRole('tab', { name: new RegExp(tab, 'i') }).first();
    await expect(target, `${tab} exists`).toBeVisible();
    await target.click();
    await page.waitForTimeout(400);
    expect(await unnamed(page), tab).toEqual([]);
  }
});
