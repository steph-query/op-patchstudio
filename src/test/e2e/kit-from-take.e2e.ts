import { test, expect } from '@playwright/test';

/**
 * Task 5 of `docs/companion-app-comparison.md`: build a kit from field recordings
 * and load it on the instrument. This is the app's central claim and the one
 * workflow that crosses every part of it — library, audition, region marking,
 * batch hand-off, the drum builder, and the send review.
 *
 * It had no coverage as a *sequence*. `TakeAudition.test.tsx` mocks
 * `useRegionHandoff` outright and `useRegionHandoff.test.tsx` mocks the audition,
 * so each side was tested against a stub of the other and the seam between them —
 * where a rendered region becomes a real File the drum builder decodes — was never
 * exercised. Every bug found in this pass lived in exactly that kind of gap.
 *
 * Nothing here stubs app code. The only fakes are the native commands, and
 * `local_audio_window` returns real decodable WAV bytes so the builder's own
 * WebAudio decode runs for each region.
 */

/** A WAV the browser will actually decode, as bytes the bridge can hand back. */
const wavSource = `(frames, rate) => {
  const bytes = 44 + frames * 2;
  const view = new DataView(new ArrayBuffer(bytes));
  const ascii = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, bytes - 8, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, frames * 2, true);
  for (let f = 0; f < frames; f++) view.setInt16(44 + f * 2, Math.round(Math.sin(f / 18) * 11000), true);
  return new Uint8Array(view.buffer);
}`;

const RATE = 44_100;
/** A four-second take, which is room enough for three hits and a gap. */
const TAKE_FRAMES = RATE * 4;

test('three regions marked in one take become three pads and go to the device', async ({ page }) => {
  await page.addInitScript(`(() => {
    const makeWav = ${wavSource};
    const calls = [];
    const regions = [];
    let uploaded = null;
    const asset = {
      id: 'take1',
      stored_path: 'originals/yard.wav',
      original_name: 'yard.wav',
      bytes: ${TAKE_FRAMES} * 2 + 44,
      first_imported_unix: 1772000000,
      occurrences: [{ source: 'local', device_model: null, device_serial: null, source_path: '/Users/fixture/Desktop/yard.wav', captured_at: null, imported_unix: 1772000000 }],
      regions,
    };
    window.__CALLS__ = calls;
    window.__UPLOADED__ = () => uploaded;
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      calls.push(command);
      switch (command) {
        case 'catalog_open':
        case 'catalog_status':
          return { path: '/Users/fixture/Music/Fieldwork Library', assets: 1, bytes: asset.bytes, occurrences: 1 };
        case 'catalog_assets': return [asset];
        case 'catalog_transfers': return [];
        case 'local_audio_info': return {
          asset_id: 'take1', sample_rate: ${RATE}, channels: 1, bits: 16, is_float: false,
          frames: ${TAKE_FRAMES}, duration_seconds: 4, audio_bytes: ${TAKE_FRAMES} * 2,
        };
        case 'local_audio_peaks': {
          const buckets = args.buckets;
          return {
            version: 1, asset_id: 'take1', buckets, channels: 1, frames: ${TAKE_FRAMES}, sample_rate: ${RATE},
            min: Array.from({ length: buckets }, (_, i) => -((i % 9) / 9)),
            max: Array.from({ length: buckets }, (_, i) => (i % 9) / 9),
          };
        }
        // Real bytes: the drum builder decodes these with WebAudio.
        case 'local_audio_window': return makeWav(args.frames, ${RATE});
        case 'catalog_save_region': {
          const saved = { id: 'r' + (regions.length + 1), name: args.region.name, start_frame: args.region.start_frame, end_frame: args.region.end_frame, created_unix: regions.length + 1 };
          regions.push(saved);
          return saved;
        }
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 9063, product_id: 1, location_id: 7, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return { presets: [], projects: [], standalone_samples: [] };
        case 'preflight_preset_send': return { token: 'tok', device_model: 'OP-XY', device_serial: 'XY-0042', destination: 'presets/drum/yard kit.preset', files: 4, bytes: 120000, free_space: 4e9, creates_category: false };
        case 'mtp_upload_preset': uploaded = args; return { written: 4, verified: 4 };
        case 'catalog_record_transfer': return { id: 't', sent_unix: 1, device_model: 'OP-XY', device_serial: 'XY-0042', destination: 'presets/drum', name: 'yard kit', files: [], outcome: 'verified', error: null, source_asset_id: 'take1', source_region: null };
        default: return [];
      }
    } } };
  })()`);

  await page.goto('/');

  // --- Mark three regions in the take ------------------------------------------
  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();
  const row = page.locator('.take-row').first();
  await expect(row.locator('strong')).toHaveText('yard.wav');
  await row.click();

  const panel = page.getByRole('region', { name: /audition yard\.wav/i });
  await expect(panel).toBeVisible();
  // The header read has landed, so the transport is live rather than merely present.
  await expect(panel).toContainText('44.1 khz');
  await expect(panel.getByRole('button', { name: 'play from playhead' })).toBeEnabled();

  const hits: Array<[string, number, number]> = [
    ['thump', 0, 11_025],
    ['clack', 44_100, 55_125],
    ['shaker', 88_200, 101_430],
  ];
  for (const [name, start, end] of hits) {
    await panel.getByLabel('Region start in frames').fill(String(start));
    await panel.getByLabel('Region end in frames').fill(String(end));
    await panel.getByLabel('Region name').fill(name);
    await panel.getByRole('button', { name: 'save region' }).click();
    await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  }

  // --- Hand all three to the drum lab in one action -----------------------------
  for (const [name] of hits) await panel.getByLabel(`Select ${name}`).click();
  await expect(panel).toContainText('3 regions selected');
  await panel.getByRole('button', { name: /send 3 to drum lab/i }).click();

  // --- They arrive as real, decoded samples on consecutive pads ------------------
  await expect(page.getByRole('tab', { name: 'drum tab', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('3 / 24 loaded')).toBeVisible();
  // In marked order, and named after the regions rather than the take.
  for (const [name] of hits) {
    await expect(page.getByText(`${name}.wav`, { exact: false }).first()).toBeVisible();
  }

  // --- And go to the instrument as one preset ------------------------------------
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'drum tab', exact: true }).click();
  await page.getByPlaceholder(/preset name/i).first().fill('yard kit');
  await page.getByRole('button', { name: /send to device/i }).first().click();

  const dialog = page.getByRole('dialog', { name: /send yard kit to op-xy/i });
  await expect(dialog).toBeVisible();
  // Every region is named in the review before anything is written.
  for (const [name] of hits) await expect(dialog).toContainText(`${name}.wav`);
  await dialog.getByRole('button', { name: 'send to device' }).click();
  // The confirmation names the preset, the folder, and how to reach it on the
  // instrument — the last of which is the only part the app cannot verify for you.
  await expect(page.getByText(/yard kit is in presets\/drum/)).toBeVisible();
  await expect(page.getByText(/instrument → shift \+ \[track\] → yard kit/)).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // The take was read three times and never written to.
  const calls = await page.evaluate(() => (window as unknown as { __CALLS__: string[] }).__CALLS__);
  expect(calls.filter(call => call === 'local_audio_window')).toHaveLength(3);
  expect(calls.filter(call => call === 'catalog_save_region')).toHaveLength(3);
  expect(calls.filter(call => call === 'mtp_upload_preset')).toHaveLength(1);
});

/**
 * Saving a region used to reset the whole audition panel.
 *
 * The effect that reads a take's header and peaks was keyed on `asset.regions` as well
 * as `asset.id`, and it also cleared the playhead and the in/out marks. So the parent
 * handing back a new regions array after a save — a new array identity every time — blanked
 * the waveform, re-read the header, and **wiped the marks the user had just made**.
 * Marking one hit and saving it destroyed the setup for the next, which is precisely the
 * loop this whole workflow is for.
 *
 * The earlier flow test did not catch it because it re-types the frame numbers for every
 * region, so it never depended on a mark surviving.
 */
test('saving a region leaves the take loaded and the next marks intact', async ({ page }) => {
  await page.addInitScript(`(() => {
    const makeWav = ${wavSource};
    const regions = [];
    const asset = {
      id: 'take1', stored_path: 'originals/yard.wav', original_name: 'yard.wav',
      bytes: ${TAKE_FRAMES} * 2 + 44, first_imported_unix: 1772000000,
      occurrences: [{ source: 'local', device_model: null, device_serial: null, source_path: '/Users/fixture/Desktop/yard.wav', captured_at: null, imported_unix: 1772000000 }],
      regions,
    };
    window.__READS__ = { info: 0, peaks: 0 };
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      switch (command) {
        case 'catalog_open':
        case 'catalog_status': return { path: '/Users/fixture/Music/Fieldwork Library', assets: 1, bytes: asset.bytes, occurrences: 1 };
        case 'catalog_assets': return [asset];
        case 'catalog_transfers': return [];
        case 'local_audio_info':
          window.__READS__.info++;
          return { asset_id: 'take1', sample_rate: ${RATE}, channels: 1, bits: 16, is_float: false, frames: ${TAKE_FRAMES}, duration_seconds: 4, audio_bytes: ${TAKE_FRAMES} * 2 };
        case 'local_audio_peaks':
          window.__READS__.peaks++;
          return { version: 1, asset_id: 'take1', buckets: args.buckets, channels: 1, frames: ${TAKE_FRAMES}, sample_rate: ${RATE},
            min: Array.from({ length: args.buckets }, () => -0.5), max: Array.from({ length: args.buckets }, () => 0.5) };
        case 'local_audio_window': return makeWav(args.frames, ${RATE});
        case 'catalog_save_region': {
          const saved = { id: 'r' + (regions.length + 1), name: args.region.name, start_frame: args.region.start_frame, end_frame: args.region.end_frame, created_unix: regions.length + 1 };
          regions.push(saved);
          return saved;
        }
        default: return [];
      }
    } } };
  })()`);

  await page.goto('/');
  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();
  await page.locator('.take-row').first().click();
  const panel = page.getByRole('region', { name: /audition yard\.wav/i });
  await expect(panel).toContainText('44.1 khz');
  const readsBefore = await page.evaluate(() => (window as unknown as { __READS__: { info: number; peaks: number } }).__READS__);

  // Mark and save one region.
  await panel.getByLabel('Region start in frames').fill('1000');
  await panel.getByLabel('Region end in frames').fill('9000');
  await panel.getByLabel('Region name').fill('thump');
  await panel.getByRole('button', { name: 'save region' }).click();
  await expect(panel.getByRole('button', { name: 'thump', exact: true })).toBeVisible();

  // The marks are still where they were put, ready for the next hit.
  await expect(panel.getByLabel('Region start in frames')).toHaveValue('1000');
  await expect(panel.getByLabel('Region end in frames')).toHaveValue('9000');
  // The take is still described and still playable — the waveform did not blank.
  await expect(panel).toContainText('44.1 khz');
  await expect(panel.getByRole('button', { name: 'play from playhead' })).toBeEnabled();

  // And the take was not read again: the header and peaks belong to the take, not to
  // how many regions have been marked in it.
  const readsAfter = await page.evaluate(() => (window as unknown as { __READS__: { info: number; peaks: number } }).__READS__);
  expect(readsAfter).toEqual(readsBefore);
});
