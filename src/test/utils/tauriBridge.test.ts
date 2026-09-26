import { afterEach, expect, it, vi } from 'vitest';
import { completePresetSend, mtpUploadPreset } from '../../utils/tauriBridge';

afterEach(() => { Reflect.deleteProperty(window, '__TAURI__'); });

it('sends preset bytes as a raw body with a lossless metadata manifest', async () => {
  const invoke = vi.fn().mockResolvedValue(17);
  Object.assign(window, { __TAURI__: { core: { invoke } } });
  const files = [{ name: 'été.wav', data: new Uint8Array([0, 255, 128]) }, { name: 'patch.json', data: new TextEncoder().encode('{}') }];
  expect(await mtpUploadPreset('keys', 'été', files, 'plan-token')).toBe(17);
  const [command, body, options] = invoke.mock.calls[0];
  expect(command).toBe('mtp_upload_preset');
  expect(body).toBeInstanceOf(Uint8Array);
  expect(Array.from(body)).toEqual([0, 255, 128, 123, 125]);
  expect(decodeURIComponent(options.headers['x-doxy-preset-name'])).toBe('été');
  expect(JSON.parse(decodeURIComponent(options.headers['x-doxy-files']))).toEqual([{ name: 'été.wav', size: 3 }, { name: 'patch.json', size: 2 }]);
  // The write carries the approval from its review; the native side refuses without it.
  expect(decodeURIComponent(options.headers['x-doxy-token'])).toBe('plan-token');
});

it('completes a preset through its own command, carrying the check\'s approval', async () => {
  const invoke = vi.fn().mockResolvedValue(1);
  Object.assign(window, { __TAURI__: { core: { invoke } } });
  const files = [{ name: 'kick.wav', data: new Uint8Array([1, 2]) }, { name: 'patch.json', data: new TextEncoder().encode('{}') }];
  expect(await completePresetSend('drum', 'field kit', files, 'complete-token')).toBe(1);
  const [command, body, options] = invoke.mock.calls[0];
  // A distinct command: completing writes into an existing folder, which sending never does.
  expect(command).toBe('complete_preset_send');
  expect(Array.from(body)).toEqual([1, 2, 123, 125]);
  expect(decodeURIComponent(options.headers['x-doxy-category'])).toBe('drum');
  expect(decodeURIComponent(options.headers['x-doxy-preset-name'])).toBe('field kit');
  expect(decodeURIComponent(options.headers['x-doxy-token'])).toBe('complete-token');
  // The whole preset is described; the device decides which of it is missing.
  expect(JSON.parse(decodeURIComponent(options.headers['x-doxy-files']))).toEqual([{ name: 'kick.wav', size: 2 }, { name: 'patch.json', size: 2 }]);
});
