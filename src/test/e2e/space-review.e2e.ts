import { test, expect } from '@playwright/test';

/**
 * The space review is read and acted on — its paths are where someone goes looking
 * with another transfer tool, since this app never deletes device content. So both
 * things it says have to survive a browser: the path must be the one the scan
 * reported, and the row must be legible.
 */
test('a duplicated file shows both of its real locations, readably', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 0x2367, product_id: 1, location_id: '7', mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 3.4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return {
          presets: [{ id: 'drum/big kit.preset', name: 'big kit', category: 'drum', preset_type: 'drum', folder_handle: 30, patch_json: { regions: [{ sample: 'kick.wav' }] }, samples: [{ handle: 32, name: 'kick.wav', size: 2_000_000 }], total_size: 2_000_000 }],
          projects: [],
          // `name` is relative to samples/; `path` is what the scan reported.
          standalone_samples: [{ handle: 21, name: 'user/kick.wav', size: 2_000_000, path: 'samples/user/kick.wav' }],
        };
        case 'mtp_scan_tree': return { entries: [], missing_roots: [], roots: [] };
        default: return [];
      }
    } } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /storage/i }).click();

  await expect(page.getByText(/1 file appears in more than one place/)).toBeVisible();
  await page.getByRole('button', { name: 'Show copies' }).click();

  const row = page.locator('.install-rows .media-row').first();
  await expect(row.locator('strong')).toHaveText('kick.wav');
  // The reported path, not a guessed one: this used to read samples/user/user/kick.wav,
  // sending the reader to a folder that does not exist.
  await expect(row).toContainText('samples/user/kick.wav · sample library');
  await expect(row).toContainText('presets/drum/big kit.preset/kick.wav · preset folder');
  await expect(row).not.toContainText('user/user');

  // Legible: `.media-row` is a six-column grid for the device media page, and this row
  // has two children, so without a template the name was clipped to "k…".
  const name = row.locator('.media-name strong');
  expect(await name.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    'the file name is not clipped by its column').toBe(true);
  const path = row.locator('.media-name small').first();
  expect(await path.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    'the device path is not clipped by its column').toBe(true);
});
