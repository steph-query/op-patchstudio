import { test, expect } from '@playwright/test';

/**
 * Task 3 of `docs/companion-app-comparison.md`: split a full-length TP-7 multitrack
 * take into per-track stems.
 *
 * `DeviceMediaStems.test.tsx` covers the three outcomes well, but it renders
 * `DeviceMediaPage` directly with a mocked context — so it starts one step after the
 * interesting part. Nothing checked that the control is *reachable*: connect a TP-7,
 * find the take, and get to the export. A button that is correct once rendered and
 * unreachable in the app is still a workflow that does not exist.
 *
 * The take here is 900 MB and five channels, which is the case the native path streams
 * to disk rather than holding in memory.
 */

const TAKE = 'recordings/2026-02-23_112713_000.wav';

test('a five-channel TP-7 take reaches the stem export from a cold start', async ({ page }) => {
  await page.addInitScript(`(() => {
    window.__CALLS__ = [];
    window.__STEM_ARGS__ = null;
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      window.__CALLS__.push(command);
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'tp-7', model: 'TP-7 MTP Device', product: 'TP-7', serial: 'TP-0007', vendor_id: 9063, product_id: 2, location_id: 3, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'tp-7', model: 'TP-7 MTP Device', manufacturer: 'teenage engineering', serial: 'TP-0007', connected: true };
        case 'mtp_list_storages': return [{ capacity: 128e9, free_space: 64e9, description: 'fixture' }];
        case 'mtp_scan_tree': return {
          entries: [
            { path: 'recordings', handle: 1, parent_handle: null, is_directory: true, size: 0, modified: '2026-02-23T11:00:00' },
            { path: ${JSON.stringify(TAKE)}, handle: 7, parent_handle: 1, is_directory: false, size: 900000000, modified: '2026-02-23T11:27:13' },
          ],
          missing_roots: [],
        };
        case 'export_device_stems':
          window.__STEM_ARGS__ = args;
          return {
            path: '/Users/fixture/Music/2026-02-23_112713_000 stems',
            stems: [
              { index: 1, channels: 2, bytes: 300000044 },
              { index: 2, channels: 2, bytes: 300000044 },
              { index: 3, channels: 1, bytes: 150000044 },
            ],
            frames: 50000000, source_channels: 5, sample_rate: 96000, bits: 24, is_float: false,
          };
        default: return [];
      }
    } } };
  })()`);

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();

  // The tabs follow the instrument: a TP-7 offers recordings, not presets.
  await page.getByRole('tab', { name: 'recordings tab', exact: true }).click();

  // The list shows the take's name without its extension and puts the format in the
  // detail line beneath — so assert both rather than guessing at one string.
  await expect(page.getByText('2026-02-23_112713_000', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('recordings · wav').first()).toBeVisible();
  // One take is "1 item", not "1 items". This header read "1 items" until the sweep
  // in `countAgreement.test.ts` turned up eight sites doing the same thing.
  await expect(page.getByText(/^1 item ·/)).toBeVisible();

  const stems = page.getByRole('button', { name: /export stereo stems/i }).first();
  await expect(stems).toBeVisible();
  await stems.click();

  // What was written, in the user's terms, including that nothing was re-encoded.
  const status = page.getByText(/3 stems written to/i);
  await expect(status).toBeVisible();
  await expect(status).toContainText('track-1, track-2, track-3 (mono)');
  await expect(status).toContainText('5 source channels at 96.0 khz / 24-bit kept exactly');
  await expect(page.getByRole('alert')).toHaveCount(0);

  // The whole take was handed to the native streamer: no size cap applied here.
  const args = await page.evaluate(() => (window as unknown as { __STEM_ARGS__: { handle: number; name: string; size: number } | null }).__STEM_ARGS__);
  expect(args).toMatchObject({ handle: 7, name: '2026-02-23_112713_000', size: 900000000 });

  // Splitting reads; it must not have written to the device or scanned presets.
  const calls = await page.evaluate(() => (window as unknown as { __CALLS__: string[] }).__CALLS__);
  expect(calls).not.toContain('mtp_upload_at_path');
  expect(calls).not.toContain('mtp_scan_presets');
  expect(calls.filter(call => call === 'export_device_stems')).toHaveLength(1);
});
