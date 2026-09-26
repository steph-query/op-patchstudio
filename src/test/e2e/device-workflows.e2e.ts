import { test, expect } from '@playwright/test';
import JSZip from 'jszip';

for (const kind of ['op-1-field', 'tp-7', 'op-xy']) {
  test(`${kind} device workflow`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ kind }) => {
      const model = kind === 'op-1-field' ? 'OP-1 field' : kind === 'tp-7' ? 'TP-7' : 'OP-XY';
      const wav = new Uint8Array(44 + 8000 * 40 * 2);
      const view = new DataView(wav.buffer);
      const label = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i); };
      label(0, 'RIFF'); label(8, 'WAVE'); label(12, 'fmt '); label(36, 'data');
      view.setUint32(4, wav.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, wav.length - 44, true);
      const entry = (path: string, handle: number) => ({ path, handle, parent_handle: 1, is_directory: false, size: wav.length, modified: '2026-09-01T12:00:00' });
      const entries = kind === 'op-1-field' ? [entry('tape/studio/track_1.aif', 11), entry('tape/studio/track_2.aif', 12), entry('album/side_a.aif', 13), entry('drum/user/kit.aif', 14)] : [entry('recordings/2026-09-01_120000_000.wav', 21), entry('memo/2026-09-02_083000_000.wav', 22)];
      const calls: string[] = [];
      const patch = new TextEncoder().encode('{ "type":"drum", "unknownFirmwareField": [1,2] }\n');
      let cancelPending: (() => void) | null = null;
      Object.assign(window, { __TEST_CALLS__: calls, __TAURI__: { core: { invoke: async (command: string, args: Record<string, unknown> = {}) => {
        calls.push(command);
        switch (command) {
          case 'mtp_list_available': return [{ kind, model, product: model, serial: 'fixture', vendor_id: 0x2367, product_id: 1, location_id: 7, mode: 'mtp' }];
          case 'mtp_connect': if (args.locationId !== 7) throw new Error('Wrong device'); return { kind, model, manufacturer: 'teenage engineering', serial: 'fixture', connected: true };
          case 'mtp_disconnect': return;
          case 'mtp_list_storages': return [{ capacity: 8000000000, free_space: 6000000000, description: 'fixture' }];
          case 'mtp_scan_tree': return { entries: kind === 'op-xy' ? [{ ...entry('presets/drum/Fixture.preset', 30), is_directory: true }, { ...entry('presets/drum/Fixture.preset/patch.json', 31), size: patch.length }, entry('presets/drum/Fixture.preset/sample.wav', 32)] : entries, missing_roots: [], roots: [] };
          case 'mtp_scan_presets': return { presets: [{ id: 'fixture', name: 'Fixture', category: 'drum', preset_type: 'drum', folder_handle: 30, patch_json: { preset_type: 'drum' }, samples: [{ handle: 32, name: 'sample.wav', size: wav.length }], total_size: wav.length + patch.length }], projects: [], standalone_samples: [] };
          case 'mtp_read_partial': return wav.slice(Number(args.offset), Number(args.offset) + Number(args.size));
          case 'mtp_read_file': return args.handle === 31 ? patch : wav;
          case 'export_device_files': return { path: '/fixture-export', copied: (args.files as unknown[]).length, skipped: 0, bytes: wav.length, failed: [] };
          case 'create_backup': return { path: '/fixture-backup', files: 4, bytes: wav.length, firmware: 'fixture', kind };
          case 'preview_restore':
            if (Reflect.get(window, '__TEST_DELAY_PREVIEW__')) return new Promise((_resolve, reject) => { cancelPending = () => { Reflect.deleteProperty(window, '__TEST_DELAY_PREVIEW__'); reject(new Error('Restore preview cancelled. No files were written.')); }; });
            return { token: 'fixture-token', path: '/fixture-backup', model, serial: 'fixture', entries: [{ path: 'samples/user/new.wav', status: 'missing', size: 32 }], required_bytes: 32, free_bytes: 1000 };
          case 'cancel_restore_preview': cancelPending?.(); return;
          case 'restore_backup': if (args.token !== 'fixture-token') throw new Error('No preview token'); return { copied: 1, skipped: 0, bytes: 32 };
          default: throw new Error('Unexpected command ' + command);
        }
      } } } });
    }, { kind });
    await page.goto('/');
    await page.getByRole('button', { name: 'find devices' }).click();
    await page.getByRole('button', { name: 'connect device', exact: true }).click();
    await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();
    if (kind === 'op-xy') {
      await page.getByRole('tab', { name: 'library tab', exact: true }).click();
      await page.getByText('Fixture', { exact: true }).click();
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'download zip', exact: true }).click();
      const download = await downloading;
      expect(download.suggestedFilename()).toBe('Fixture.preset.zip');
      const chunks: Buffer[] = [];
      for await (const chunk of (await download.createReadStream())!) chunks.push(chunk);
      const zip = await JSZip.loadAsync(Buffer.concat(chunks));
      expect(await zip.file('patch.json')!.async('string')).toBe('{ "type":"drum", "unknownFirmwareField": [1,2] }\n');
      expect((await zip.file('sample.wav')!.async('uint8array')).length).toBe(44 + 8000 * 40 * 2);
    }
    if (kind !== 'op-xy') {
      await expect(page.getByRole('button', { name: /send to device/i })).toHaveCount(0);
      await page.getByRole('tab', { name: kind === 'tp-7' ? 'recordings tab' : 'tapes tab', exact: true }).click();
      if (kind === 'op-1-field') await expect(page.getByText('side a', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: /^Preview / }).first().click();
      await expect(page.getByRole('button', { name: 'stop preview' })).toBeVisible();
      if (kind === 'op-1-field') await expect(page.getByRole('slider', { name: /preview level/ })).toHaveCount(2);
      await page.getByRole('button', { name: 'stop preview' }).click();
      await page.getByRole('checkbox').first().check();
      await page.getByRole('button', { name: /export selected/ }).click();
      await expect(page.getByText('/fixture-export', { exact: false })).toBeVisible();
      await page.screenshot({ path: '.maestro/' + kind + '-workspace.png', fullPage: true });
    }
    await page.getByRole('tab', { name: 'storage tab', exact: true }).click();
    await page.getByRole('button', { name: 'Create backup…' }).click();
    await expect(page.getByText('Backup verified', { exact: true })).toBeVisible();
    await page.evaluate(() => Object.assign(window, { __TEST_DELAY_PREVIEW__: true }));
    await page.getByRole('button', { name: 'Preview restore…' }).click();
    await page.getByRole('button', { name: 'Cancel preview', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Restore preview cancelled');
    await page.getByRole('button', { name: 'Preview restore…' }).click();
    await page.getByRole('button', { name: 'Restore missing files and verify', exact: true }).click();
    await expect(page.getByText(/1 files restored and verified/)).toBeVisible();
    await page.getByRole('button', { name: 'disconnect', exact: true }).click();
    await expect(page.getByRole('button', { name: 'find devices' })).toBeVisible();
    expect(errors).toEqual([]);
  });
}
