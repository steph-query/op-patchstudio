import { test, expect } from '@playwright/test';

/**
 * The take library in a real engine, with an OP-1 field attached.
 *
 * Two things here are worth checking outside jsdom. The import filter decides what
 * counts as a recording, and a field's tree mixes tape and album audio with drum
 * and synth *patches* — offering the patches would mean copying an instrument
 * collection into a library meant for takes. And the list is a custom listbox with
 * a roving tab stop and `aria-activedescendant`, which is exactly the kind of
 * focus behaviour that can pass in jsdom and misbehave in a browser.
 */
test('a field offers its tape and album audio as takes, and nothing else', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.addInitScript(() => {
    const entry = (path: string, handle: number) => ({
      path, handle, parent_handle: 1, is_directory: false, size: 2048, modified: '2026-09-01T12:00:00',
    });
    const imported: unknown[] = [];
    Object.assign(window, {
      __IMPORTED__: imported,
      __TAURI__: { core: { invoke: async (command: string, args: Record<string, unknown> = {}) => {
        switch (command) {
          case 'mtp_list_available':
            return [{ kind: 'op-1-field', model: 'OP-1 field', product: 'OP-1 field', serial: 'fixture', vendor_id: 0x2367, product_id: 1, location_id: '7', mode: 'mtp' }];
          case 'mtp_connect':
            return { kind: 'op-1-field', model: 'OP-1 field', manufacturer: 'teenage engineering', serial: 'fixture', connected: true };
          case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 6e9, description: 'fixture' }];
          case 'mtp_scan_tree': return { entries: [
            entry('tape/studio/track_1.aif', 11),
            entry('tape/studio/track_2.aif', 12),
            entry('album/side_a.aif', 13),
            // Patches, not takes.
            entry('drum/user/kit.aif', 14),
            entry('synth/user/pad.aif', 15),
          ], missing_roots: [], roots: [] };
          case 'catalog_open':
          case 'catalog_status':
            return { path: '/Users/fixture/Music/Fieldwork Library', assets: 2, bytes: 4096, occurrences: 2 };
          case 'catalog_assets': return [
            { id: 'a1', stored_path: 'originals/first take.wav', original_name: 'first take.wav', bytes: 2048, first_imported_unix: 1_772_000_000, occurrences: [{ source: 'device', device_model: 'TP-7', device_serial: 'tp', source_path: 'recordings/first take.wav', captured_at: null, imported_unix: 1_772_000_000 }], regions: [] },
            { id: 'a2', stored_path: 'originals/second take.wav', original_name: 'second take.wav', bytes: 2048, first_imported_unix: 1_772_000_100, occurrences: [{ source: 'device', device_model: 'TP-7', device_serial: 'tp', source_path: 'recordings/second take.wav', captured_at: null, imported_unix: 1_772_000_100 }], regions: [] },
          ];
          case 'catalog_transfers': return [];
          case 'catalog_import_from_device':
            imported.push(args.files);
            return (args.files as Array<{ path: string }>).map(file => ({ source_path: file.path, status: 'imported', asset_id: 'new', error: null }));
          default: return [];
        }
      } } },
    });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();

  // Three recordings, not five: the drum and synth patches are not offered.
  const importButton = page.getByRole('button', { name: 'import 3 new' });
  await expect(importButton).toBeVisible();
  await importButton.click();

  await expect.poll(() => page.evaluate(() => (window as unknown as { __IMPORTED__: Array<Array<{ path: string }>> }).__IMPORTED__.flat().map(file => file.path)))
    .toEqual(['tape/studio/track_1.aif', 'tape/studio/track_2.aif', 'album/side_a.aif']);

  expect(errors).toEqual([]);
});

test('the takes list is one tab stop and walks with the arrow keys', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'catalog_open':
        case 'catalog_status':
          return { path: '/Users/fixture/Music/Fieldwork Library', assets: 2, bytes: 4096, occurrences: 2 };
        case 'catalog_assets': return [
          { id: 'a1', stored_path: 'originals/first take.wav', original_name: 'first take.wav', bytes: 2048, first_imported_unix: 1_772_000_000, occurrences: [], regions: [] },
          { id: 'a2', stored_path: 'originals/second take.wav', original_name: 'second take.wav', bytes: 2048, first_imported_unix: 1_772_000_100, occurrences: [], regions: [] },
        ];
        case 'catalog_transfers': return [];
        default: return [];
      }
    } } } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();

  const list = page.getByRole('listbox', { name: 'Takes' });
  await expect(list).toBeVisible();
  const options = list.getByRole('option');
  await expect(options).toHaveCount(2);

  // One tab stop: the first row is reachable, the second is not a separate stop.
  await options.first().focus();
  await expect(list).toHaveAttribute('aria-activedescendant', 'take-a1');
  await expect(options.nth(0)).toHaveAttribute('tabindex', '0');
  await expect(options.nth(1)).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('ArrowDown');
  await expect(list).toHaveAttribute('aria-activedescendant', 'take-a2');
  await expect(options.nth(1)).toBeFocused();

  await page.keyboard.press('Home');
  await expect(list).toHaveAttribute('aria-activedescendant', 'take-a1');
  await page.keyboard.press('End');
  await expect(list).toHaveAttribute('aria-activedescendant', 'take-a2');

  // Past the end stays put rather than wrapping or losing focus.
  await page.keyboard.press('ArrowDown');
  await expect(list).toHaveAttribute('aria-activedescendant', 'take-a2');
});

test('a take\'s name is readable rather than clipped to a character', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'catalog_open':
        case 'catalog_status':
          return { path: '/Users/fixture/Music/Fieldwork Library', assets: 1, bytes: 48e6, occurrences: 1 };
        case 'catalog_assets': return [{
          id: 'a1', stored_path: 'originals/2026-02-23_112713_000.wav', original_name: '2026-02-23_112713_000.wav',
          bytes: 48_000_000, first_imported_unix: 1_772_000_000,
          occurrences: [{ source: 'device', device_model: 'TP-7', device_serial: 'F1RTL11C', source_path: 'recordings/2026-02-23_112713_000.wav', captured_at: '2026-02-23T11:27:13', imported_unix: 1_772_000_000 }],
          regions: [],
        }];
        case 'catalog_transfers': return [];
        default: return [];
      }
    } } } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();

  // `.media-row` is a six-column grid built for the device media page; a take row has
  // three children. Without its own template the name landed in the 24px checkbox
  // column and every take read as "2…", which no unit test could see.
  const name = page.locator('.take-row .media-name strong').first();
  await expect(name).toHaveText('2026-02-23_112713_000.wav');
  const fits = await name.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
  expect(fits, 'the take name is not clipped by its column').toBe(true);

  // And the provenance line — the only thing telling two `track_1.aif` takes apart —
  // has room as well.
  const source = page.locator('.take-row .media-name small').last();
  expect(await source.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test('files already on this Mac can be added with nothing plugged in', async ({ page }) => {
  await page.addInitScript(() => {
    const added: unknown[] = [];
    let assets: unknown[] = [];
    Object.assign(window, { __ADDED__: added, __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'catalog_open':
        case 'catalog_status':
          return { path: '/Users/fixture/Music/Fieldwork Library', assets: assets.length, bytes: 0, occurrences: assets.length };
        case 'catalog_assets': return assets;
        case 'catalog_transfers': return [];
        case 'catalog_import_local':
          added.push('called');
          assets = [{
            id: 'local1', stored_path: 'originals/bounce.wav', original_name: 'bounce.wav', bytes: 2048,
            first_imported_unix: 1_772_000_000,
            occurrences: [{ source: 'local', device_model: null, device_serial: null, source_path: '/Users/fixture/Desktop/bounce.wav', captured_at: null, imported_unix: 1_772_000_000 }],
            regions: [],
          }];
          return [{ source_path: '/Users/fixture/Desktop/bounce.wav', status: 'imported', asset_id: 'local1', error: null }];
        default: return [];
      }
    } } } });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();
  // The empty state names both routes, not just the cable.
  await expect(page.getByText(/Add files from this Mac, or connect a recorder/)).toBeVisible();
  // And nothing is connected, so the device import is not even offered.
  await expect(page.getByRole('button', { name: /import \d+ new/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'add files…' }).click();
  await expect(page.getByText(/1 imported · 0 already in your library · 0 failed/)).toBeVisible();

  // The take is listed with where it came from on this Mac.
  const row = page.locator('.take-row').first();
  await expect(row.locator('strong')).toHaveText('bounce.wav');
  await expect(row).toContainText('/Users/fixture/Desktop/bounce.wav');
  expect(await page.evaluate(() => (window as unknown as { __ADDED__: unknown[] }).__ADDED__.length)).toBe(1);
});
