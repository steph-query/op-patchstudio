import { test, expect } from '@playwright/test';

/**
 * The one confirmation before anything is written to an instrument, driven the way
 * a person reaches it: connect an OP-XY, load a sample, name the preset, press
 * send. Nothing below stubs the review itself — it is the real dialog, rendered
 * from a real preflight.
 *
 * This is the app's most safety-critical screen and had no browser coverage. It is
 * also where the interrupted-send recovery lives, which is a sequence rather than a
 * state: fail, check, and only then is completing offered.
 */
function monoWav(frames = 44100) {
  const bytes = 44 + frames * 2;
  const buffer = Buffer.alloc(bytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(bytes - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24); buffer.writeUInt32LE(88200, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(Math.sin(frame / 20) * 12000), 44 + frame * 2);
  return buffer;
}

test('an interrupted send can be checked and completed, and never silently retried', async ({ page }) => {
  await page.addInitScript(() => {
    const calls: string[] = [];
    Object.assign(window, { __CALLS__: calls, __TAURI__: { core: { invoke: async (command: string) => {
      calls.push(command);
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 0x2367, product_id: 1, location_id: '7', mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return { presets: [], projects: [], standalone_samples: [] };
        case 'preflight_preset_send': return { token: 'tok', device_model: 'OP-XY', device_serial: 'XY-0042', destination: 'presets/drum/field kit.preset', files: 2, bytes: 95_600, free_space: 4e9, creates_category: false };
        // The cable comes out mid-write.
        case 'mtp_upload_preset': throw new Error('Upload incomplete at presets/drum/field kit.preset');
        case 'reconcile_preset_send': return {
          destination: 'presets/drum/field kit.preset', folder_exists: true,
          files: [{ name: 'patch.json', status: 'absent', device_bytes: null }, { name: 'kick.wav', status: 'identical', device_bytes: 2048 }],
          extra: [], identical: 1, different: 0, absent: 1, verdict: 'can complete',
          explanation: '1 file(s) already match and 1 are missing. Only the missing files would be written; nothing existing is touched.',
          token: 'complete-tok',
        };
        case 'complete_preset_send': return 1;
        case 'catalog_record_transfer': return { id: 't', sent_unix: 1, device_model: 'OP-XY', device_serial: 'XY-0042', destination: 'presets/drum', name: 'field kit', files: [], outcome: 'verified', error: null, source_asset_id: null, source_region: null };
        default: return [];
      }
    } } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();

  page.on('filechooser', chooser => chooser.setFiles({ name: 'kick.wav', mimeType: 'audio/wav', buffer: monoWav() }));
  await page.getByText('drop samples here or click to browse').first().click();
  await expect(page.getByText('1 / 24 loaded')).toBeVisible();
  await page.getByPlaceholder(/preset name/i).first().fill('field kit');

  const send = page.getByRole('button', { name: /send to device/i }).first();
  await expect(send).toBeEnabled();
  await send.click();

  // The review names the instrument, the folder and every file before anything moves.
  const dialog = page.getByRole('dialog', { name: /send field kit to op-xy/i });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('OP-XY · XY-0042');
  await expect(dialog).toContainText('presets/drum/field kit.preset');
  await expect(dialog).toContainText('kick.wav');
  await expect(dialog).toContainText('patch.json');
  // Completing is not on offer until a check says so.
  await expect(dialog.getByRole('button', { name: /missing file/ })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'send to device' }).click();
  await expect(page.getByText(/Nothing already on the device was replaced/)).toBeVisible();
  // The review stays open after a failure rather than dropping the user back.
  await expect(dialog).toBeVisible();

  await dialog.getByRole('button', { name: 'check the device' }).click();
  await expect(dialog).toContainText('can complete');
  await expect(dialog).toContainText('patch.json');
  await expect(dialog).toContainText('absent');
  await expect(dialog).toContainText('identical');
  // A fresh send of the same name is now certain to be refused, so it says why
  // instead of failing on press.
  await expect(dialog).toContainText('refused while that folder exists');
  await expect(dialog.getByRole('button', { name: 'send to device' })).toBeDisabled();

  const complete = dialog.getByRole('button', { name: 'add the 1 missing file' });
  await expect(complete).toBeVisible();
  await complete.click();

  await expect(page.getByText(/1 file added/)).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // Exactly one upload attempt and one completion: checking wrote nothing.
  const calls = await page.evaluate(() => (window as unknown as { __CALLS__: string[] }).__CALLS__);
  expect(calls.filter(call => call === 'mtp_upload_preset')).toHaveLength(1);
  expect(calls.filter(call => call === 'complete_preset_send')).toHaveLength(1);
  expect(calls.filter(call => call === 'reconcile_preset_send')).toHaveLength(1);
});

/**
 * Focus, in the dialog that matters most.
 *
 * `SendReview` is the one confirmation before anything is written to an instrument, and it
 * took no focus at all: opening it from the keyboard left focus on the send button
 * *underneath*, so Tab walked controls the user could not see and a screen reader
 * announced the page behind the layer. Closing it left focus wherever it had drifted.
 */
test('the send review takes the keyboard and hands it back', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { __TAURI__: { core: { invoke: async (command: string) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 0x2367, product_id: 1, location_id: '7', mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return { presets: [], projects: [], standalone_samples: [] };
        case 'preflight_preset_send': return { token: 'tok', device_model: 'OP-XY', device_serial: 'XY-0042', destination: 'presets/drum/field kit.preset', files: 2, bytes: 95_600, free_space: 4e9, creates_category: false };
        default: return [];
      }
    } } } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();

  page.on('filechooser', chooser => chooser.setFiles({ name: 'kick.wav', mimeType: 'audio/wav', buffer: monoWav() }));
  await page.getByText('drop samples here or click to browse').first().click();
  await expect(page.getByText('1 / 24 loaded')).toBeVisible();
  await page.getByPlaceholder(/preset name/i).first().fill('field kit');

  // Reach the send button with the keyboard, so focus is somewhere known.
  const send = page.getByRole('button', { name: /send to device/i }).first();
  await send.focus();
  await expect(send).toBeFocused();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: /send field kit to op-xy/i });
  await expect(dialog).toBeVisible();

  // Focus is inside the layer, on the dialog itself rather than on a confirm button —
  // arming Enter on a write as the layer appears is how device content gets sent by reflex.
  await expect(dialog).toBeFocused();

  // Tab moves inward and stays inside: after walking past the last control it wraps
  // rather than reaching the workspace behind.
  const reached: string[] = [];
  for (let step = 0; step < 8; step++) {
    await page.keyboard.press('Tab');
    reached.push(await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return 'none';
      const inDialog = !!active.closest('[role=dialog]');
      return `${inDialog ? 'in' : 'OUT'}:${(active.innerText || active.tagName).slice(0, 20).replace(/\s+/g, ' ')}`;
    }));
  }
  expect(reached.filter(entry => entry.startsWith('OUT')), `focus escaped the dialog: ${reached.join(' | ')}`).toEqual([]);

  // Escape closes it, and focus returns to the button that opened it.
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(send).toBeFocused();
});
