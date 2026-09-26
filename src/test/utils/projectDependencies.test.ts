import { describe, expect, it } from 'vitest';
import { inspectProjectDependencies } from '../../utils/projectDependencies';
import { parseXyPaths } from '../../utils/deviceXyParser';
import type { XyPathRecord } from '../../utils/deviceXyParser';
import type { TauriDevicePreset } from '../../utils/tauriBridge';
const record = (fullPath: string, type: XyPathRecord['type'] = 'preset-sample'): XyPathRecord => ({ fullPath, type, offset: 0, segments: [fullPath] });
const preset: TauriDevicePreset = { id: 'user/keys/Été.preset', category: 'user/keys', name: 'Été', preset_type: 'multisample', folder_handle: 1, patch_json: null, total_size: 300, samples: [{ name: 'layers/C4.wav', handle: 2, size: 300 }] };

describe('project dependencies', () => {
  it('resolves nested UTF-8 paths and deduplicates repeated references', () => {
    const path = '/fat32/presets/user/keys/Été.preset/layers/C4.wav';
    const result = inspectProjectDependencies([record(path), record(path), record('#user/keys/Été', 'short-ref')], [preset], [], true);
    expect(result.find(item => item.path === path)).toMatchObject({ status: 'found', size: 300, occurrences: 2 });
    expect(result.find(item => item.type === 'short-ref')?.status).toBe('found');
  });
  it('does not match a duplicate basename in a different folder', () => {
    const result = inspectProjectDependencies([record('/fat32/presets/keys/Other.preset/layers/C4.wav')], [preset], [], true);
    expect(result[0].status).toBe('unresolved');
  });
  it('distinguishes disconnected checks, factory content and nested standalone files', () => {
    const records = [record('content/drums/kick.wav', 'content'), record('/fat32/samples/user/session/kick.wav', 'standalone-sample')];
    expect(inspectProjectDependencies(records, [], [], false).map(item => item.status).sort()).toEqual(['built-in', 'not-checked']);
    expect(inspectProjectDependencies(records, [], [{ name: 'session/kick.wav', size: 0, handle: 3 }], true).find(item => item.type === 'standalone-sample')).toMatchObject({ status: 'found', size: 0 });
  });
});

describe('UTF-8 project paths', () => {
  it('retains UTF-8 names across null-separated path segments', () => {
    const bytes = new TextEncoder().encode('/fat32/presets/user/\0Été.preset/\0鐘.wav\0\0');
    expect(parseXyPaths(bytes)[0].fullPath).toBe('/fat32/presets/user/Été.preset/鐘.wav');
  });
  it('rejects unterminated paths instead of treating arbitrary binary tails as filenames', () => {
    expect(parseXyPaths(new TextEncoder().encode('/fat32/presets/incomplete'))).toEqual([]);
  });
  it('recognizes samples outside the user folder as sample paths', () => {
    expect(parseXyPaths(new TextEncoder().encode('/fat32/samples/other/kick.wav\0\0'))[0].type).toBe('standalone-sample');
  });
});
