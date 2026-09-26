import { test, expect } from '@playwright/test';

/**
 * Swapping instruments mid-session — the goal's own scenario: "working with all of them
 * in a studio on a Mac". One USB session at a time means the cable moves constantly, so
 * what survives a swap is a workflow question rather than a detail.
 *
 * Disconnecting used to jump to the library tab unconditionally. Five tabs need no device
 * at all, so unplugging a TP-7 to reach for an OP-XY threw you out of the kit you were
 * building — the kit was still there, but you had to find your way back to it.
 */

function monoWav(frames = 4410) {
  const bytes = 44 + frames * 2;
  const buffer = Buffer.alloc(bytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(bytes - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24); buffer.writeUInt32LE(88200, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(Math.sin(frame / 15) * 10000), 44 + frame * 2);
  return buffer;
}

/** Two instruments on the bench; which one answers depends on what is plugged in. */
const HARNESS = `(() => {
  window.__PLUGGED__ = 'tp-7';
  const devices = {
    'tp-7': { kind: 'tp-7', model: 'TP-7 MTP Device', product: 'TP-7', serial: 'TP-0007', vendor_id: 9063, product_id: 2, location_id: 3, mode: 'mtp' },
    'op-xy': { kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 9063, product_id: 1, location_id: 7, mode: 'mtp' },
  };
  window.__TAURI__ = { core: { invoke: async (command) => {
    const current = devices[window.__PLUGGED__];
    switch (command) {
      case 'mtp_list_available': return [current];
      case 'mtp_connect': return { ...current, manufacturer: 'teenage engineering', connected: true };
      case 'mtp_disconnect': return null;
      case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
      case 'mtp_scan_presets': return { presets: [], projects: [], standalone_samples: [] };
      case 'mtp_scan_tree': return { entries: [
        { path: 'recordings', handle: 1, parent_handle: null, is_directory: true, size: 0, modified: '2026-02-23T11:00:00' },
        { path: 'recordings/take.wav', handle: 7, parent_handle: 1, is_directory: false, size: 4454, modified: '2026-02-23T11:27:13' },
      ], missing_roots: [] };
      case 'catalog_open':
      case 'catalog_status': return { path: '/Users/fixture/Music/Fieldwork Library', assets: 0, bytes: 0, occurrences: 0 };
      default: return [];
    }
  } } };
})()`;

async function connect(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();
}

test('unplugging one instrument for another leaves a half-built kit where it is', async ({ page }) => {
  await page.addInitScript(HARNESS);
  await page.goto('/');

  // A TP-7 is on the bench, and its tabs follow.
  await connect(page);
  await expect(page.getByRole('tab', { name: 'recordings tab', exact: true })).toBeVisible();

  // Start building an OP-XY kit while the recorder is still plugged in — the builders
  // work whatever is connected, which is the point of having them always available.
  // The label reads "drum (op-xy)" while a recorder is connected — the app saying which
  // instrument this builder targets — so match the prefix rather than the exact string.
  const drumTab = page.getByRole('tab', { name: /^drum/ });
  await drumTab.click();
  page.on('filechooser', chooser => chooser.setFiles({ name: 'thump.wav', mimeType: 'audio/wav', buffer: monoWav() }));
  await page.getByText('drop samples here or click to browse').first().click();
  await expect(page.getByText('1 / 24 loaded')).toBeVisible();

  // Now reach for the other instrument.
  await page.getByRole('button', { name: 'disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'find devices' })).toBeVisible();

  // Still in the drum lab, with the pad still loaded. The kit surviving is not enough on
  // its own — being moved away from it is the defect, because the work is invisible from
  // wherever you were sent.
  await expect(drumTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('1 / 24 loaded')).toBeVisible();

  // Plug in the OP-XY: still the drum lab, still the kit, and its own tabs now offered.
  await page.evaluate(() => { (window as unknown as { __PLUGGED__: string }).__PLUGGED__ = 'op-xy'; });
  await connect(page);
  await expect(drumTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('1 / 24 loaded')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'storage tab', exact: true })).toBeVisible();
  // With the OP-XY connected the builder no longer needs the "(op-xy)" qualifier.
  await expect(page.getByRole('tab', { name: 'drum tab', exact: true })).toBeVisible();
  // And the recorder's tab is gone, rather than lingering as a dead option.
  await expect(page.getByRole('tab', { name: 'recordings tab', exact: true })).toHaveCount(0);
});

test('a tab that needs the device hands you to its offline counterpart', async ({ page }) => {
  await page.addInitScript(HARNESS);
  await page.goto('/');
  await connect(page);

  // On the recorder's own tab, which cannot exist without it.
  await page.getByRole('tab', { name: 'recordings tab', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'recordings tab', exact: true })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'disconnect', exact: true }).click();
  await expect(page.getByRole('button', { name: 'find devices' })).toBeVisible();

  // Takes, not an unrelated tab: you were working with recordings, and these are your
  // own copies of them.
  await expect(page.getByRole('tab', { name: 'takes tab', exact: true })).toHaveAttribute('aria-selected', 'true');
});
