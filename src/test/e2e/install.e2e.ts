import { test, expect } from '@playwright/test';

/**
 * The install plan, which is the last thing a user reads before bytes go onto an
 * instrument. Both defects covered here were invisible to every unit test: one is
 * layout, the other is two correct sentences that happen to say the same thing.
 */
test('the install plan is readable and does not say the same thing twice', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-1-field', model: 'OP-1 field', product: 'OP-1 field', serial: 'F1ELD001', vendor_id: 0x2367, product_id: 1, location_id: 7, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-1-field', model: 'OP-1 field', manufacturer: 'teenage engineering', serial: 'F1ELD001', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 6e9, description: 'fixture' }];
        case 'mtp_scan_tree': return { entries: [], missing_roots: [], roots: [] };
        default: return [];
      }
    } } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /install/i }).click();

  // A 48 kHz source, so the plan has a conversion to state.
  const frames = 8000;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(frames * 2, 40);
  page.on('filechooser', chooser => chooser.setFiles({ name: 'my loop.wav', mimeType: 'audio/wav', buffer: wav }));
  await page.getByRole('button', { name: /choose files/i }).click();

  const name = page.locator('.install-row .media-name strong').first();
  await expect(name).toHaveText('my loop.wav');
  // `.media-row` is a six-column grid for the device media page; an install row has
  // three children, so without its own template the name was clipped to "m…".
  expect(await name.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
    'the file name is not clipped by its column').toBe(true);

  const plan = page.locator('.install-row .media-name small').first();
  await expect(plan).toContainText('saves as my loop.aif');

  // The format summary and the target's note sit in one line. The note used to
  // restate the summary, so the user read the rate and depth twice in a row.
  const target = (await page.locator('.install-target').first().textContent()) ?? '';
  expect(target).toContain('44.1 khz');
  expect(target.match(/44\.1 khz/g), 'the rate is stated once, not twice').toHaveLength(1);
  expect(target.match(/16-bit/g)).toHaveLength(1);
  expect(target).toContain('each file arrives as its own file');
});

/**
 * Typing a subfolder name used to re-read the device once per keystroke.
 *
 * The effect that lists the destination was keyed on the subfolder field, and every run
 * did a full `mtp_scan_tree` of `samples/` — wrapped in `deviceOperation`, which makes the
 * whole workspace `inert`. So typing "field kicks" meant eleven MTP scans and eleven
 * freezes of the app, including of the field being typed into. The scan reads the same
 * bytes whatever is typed; only the filtering depends on it.
 */
test('typing a subfolder name does not re-read the device', async ({ page }) => {
  await page.addInitScript(`(() => {
    window.__SCANS__ = [];
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 9063, product_id: 1, location_id: 7, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return { presets: [], projects: [], standalone_samples: [] };
        case 'mtp_scan_tree':
          window.__SCANS__.push(args.roots.join(','));
          return { entries: [
            { path: 'samples', handle: 1, parent_handle: null, is_directory: true, size: 0, modified: '2026-01-01T00:00:00' },
            { path: 'samples/user', handle: 2, parent_handle: 1, is_directory: true, size: 0, modified: '2026-01-01T00:00:00' },
            { path: 'samples/user/kick.wav', handle: 3, parent_handle: 2, is_directory: false, size: 2048, modified: '2026-01-01T00:00:00' },
          ], missing_roots: [] };
        default: return [];
      }
    } } };
  })()`);

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /install/i }).click();

  const field = page.getByLabel('Subfolder name');
  await expect(field).toBeVisible();
  // Let the initial destination read settle before counting.
  await expect.poll(async () => (await page.evaluate(() => (window as unknown as { __SCANS__: string[] }).__SCANS__)).length)
    .toBeGreaterThan(0);
  const before = (await page.evaluate(() => (window as unknown as { __SCANS__: string[] }).__SCANS__)).length;

  // Eleven characters, typed one at a time the way a person types.
  await field.pressSequentially('field kicks', { delay: 10 });
  await expect(field).toHaveValue('field kicks');

  const after = (await page.evaluate(() => (window as unknown as { __SCANS__: string[] }).__SCANS__)).length;
  expect(after, 'typing must not scan the device again').toBe(before);

  // And the field stayed usable throughout: an inert workspace would have dropped
  // keystrokes, so the value above arriving intact is the other half of the assertion.
  await expect(page.getByRole('status').filter({ hasText: /Reading samples\// })).toHaveCount(0);
});
