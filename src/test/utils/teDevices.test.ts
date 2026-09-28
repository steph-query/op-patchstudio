import { describe, expect, it } from 'vitest';
import { deviceSamplePath, getDeviceProfile, isCapturePath, tabsForDevice, OFFLINE_TABS, resolveTabForDevice, tabGroups } from '../../utils/teDevices';
import type { TeDeviceKind } from '../../utils/teDevices';

const KINDS: TeDeviceKind[] = ['op-xy', 'op-1-field', 'tp-7', 'unknown'];

describe('capture folders', () => {
  it('is where each device keeps recordings, and nowhere else', () => {
    expect(getDeviceProfile('op-1-field').captureRoots).toEqual(['tape', 'album']);
    expect(getDeviceProfile('tp-7').captureRoots).toEqual(['recordings', 'memo']);
    expect(getDeviceProfile('op-xy').captureRoots).toEqual(['samples']);
    expect(getDeviceProfile('unknown').captureRoots).toEqual([]);
  });

  it('is always a subset of the folders actually scanned', () => {
    // A capture folder outside `roots` can never match a scanned path, so the
    // import would silently find nothing. This is the invariant that keeps the
    // two lists honest with each other.
    for (const kind of KINDS) {
      const profile = getDeviceProfile(kind);
      for (const folder of profile.captureRoots) {
        expect(profile.roots, `${kind} scans ${folder}`).toContain(folder);
      }
    }
  });

  it('matches on folder boundaries, not on a prefix', () => {
    expect(isCapturePath('op-1-field', 'tape/side-1/track_1.aif')).toBe(true);
    expect(isCapturePath('op-1-field', 'album/side-a.aif')).toBe(true);
    // A patch is not a take.
    expect(isCapturePath('op-1-field', 'drum/user/kit.aif')).toBe(false);
    expect(isCapturePath('op-1-field', 'synth/user/pad.aif')).toBe(false);
    // Nor is a folder that merely starts with the same letters.
    expect(isCapturePath('op-1-field', 'tapes-old/track.aif')).toBe(false);
    expect(isCapturePath('op-1-field', 'albumart/cover.aif')).toBe(false);
  });

  it('reads paths as devices write them: any case, with or without a leading slash', () => {
    expect(isCapturePath('tp-7', 'RECORDINGS/take.wav')).toBe(true);
    expect(isCapturePath('tp-7', '/recordings/take.wav')).toBe(true);
    expect(isCapturePath('tp-7', 'Memo/note.wav')).toBe(true);
    // The folder itself, with no file under it.
    expect(isCapturePath('tp-7', 'recordings')).toBe(true);
  });

  it('claims nothing for a device it does not know', () => {
    expect(isCapturePath('unknown', 'recordings/take.wav')).toBe(false);
    expect(isCapturePath(null, 'recordings/take.wav')).toBe(false);
    expect(isCapturePath(undefined, 'tape/track.aif')).toBe(false);
  });
});

describe('device tabs', () => {
  it('shows the takes library for every device, and unplugged too', () => {
    // The library is local, so it is never gated on a connection.
    expect(OFFLINE_TABS).toContain('takes');
    for (const kind of KINDS) expect(tabsForDevice(kind)).toContain('takes');
  });

  it('numbers stay within one hand for every device', () => {
    // ⌘1–⌘9 has to reach every tab, or some panel is keyboard-unreachable.
    for (const kind of [...KINDS, null]) expect(tabsForDevice(kind).length).toBeLessThanOrEqual(9);
  });
});

describe('where a scanned sample lives', () => {
  it('prefers the path the scan reported', () => {
    expect(deviceSamplePath({ name: 'breaks/kick.wav', path: 'samples/breaks/kick.wav' }))
      .toBe('samples/breaks/kick.wav');
  });

  it('adds only the samples root when no path was reported', () => {
    // `name` is already relative to samples/, so this must not repeat a folder that
    // is part of the name, and must not invent one that is not.
    expect(deviceSamplePath({ name: 'kick.wav' })).toBe('samples/kick.wav');
    expect(deviceSamplePath({ name: 'user/kick.wav' })).toBe('samples/user/kick.wav');
    expect(deviceSamplePath({ name: 'kick.wav', path: null })).toBe('samples/kick.wav');
  });
});

/**
 * In a studio with all three instruments the cable moves constantly, so where you land
 * after a swap is a workflow question, not a detail. Disconnecting used to jump to
 * `library` unconditionally — unplugging a TP-7 to reach for an OP-XY threw you out of
 * the kit you were building, with the half-built kit still sitting there.
 */
describe('where a device swap leaves you', () => {
  it('leaves you where you are when the tab needs no device', () => {
    for (const tab of OFFLINE_TABS) {
      expect(resolveTabForDevice(tab, null), `${tab} works offline`).toBe(tab);
    }
  });

  it('leaves you where you are when the new device has that tab too', () => {
    // Both instruments have the builders and the library; only one has recordings.
    expect(resolveTabForDevice('drum', 'op-xy')).toBe('drum');
    expect(resolveTabForDevice('drum', 'tp-7')).toBe('drum');
    expect(resolveTabForDevice('library', 'op-1-field')).toBe('library');
    expect(resolveTabForDevice('recordings', 'tp-7')).toBe('recordings');
  });

  it('lands somewhere related when the tab genuinely disappears', () => {
    // Recordings on the device → your own recordings, not an unrelated tab.
    expect(resolveTabForDevice('recordings', null)).toBe('takes');
    expect(resolveTabForDevice('tapes', null)).toBe('takes');
    // Managing the device → the library, which is the offline counterpart.
    expect(resolveTabForDevice('install', null)).toBe('library');
    expect(resolveTabForDevice('storage', null)).toBe('library');
  });

  it('never returns a tab the device does not have', () => {
    const kinds = [null, 'op-xy', 'op-1-field', 'tp-7'] as const;
    const everyTab = ['drum', 'multisample', 'takes', 'library', 'tapes', 'recordings', 'install', 'storage', 'projects'] as const;
    for (const kind of kinds) {
      for (const tab of everyTab) {
        const resolved = resolveTabForDevice(tab, kind);
        expect(tabsForDevice(kind), `${tab} on ${kind ?? 'nothing'} resolved to ${resolved}`).toContain(resolved);
      }
    }
  });
});

/**
 * The sidebar's two sections, and the ordering contract behind them.
 *
 * `tabGroups` is the only ordering in the app: the sidebar renders it, `tabsForDevice`
 * flattens it, and `useAppShortcuts` indexes that flat list for ⌘1–⌘9. If the three ever
 * disagreed, the number printed on a screen would not be the number that reaches it.
 */
describe('tabGroups', () => {
  it('leads with the connected device, and names the section after it', () => {
    const groups = tabGroups('tp-7');
    expect(groups.map(group => group.key)).toEqual(['device', 'workbench']);
    expect(groups[0].label).toBe('tp-7');
    // Only TP-7 screens in the TP-7 section. The OP-XY builders are still reachable,
    // under the workbench, which is what they always were.
    expect(groups[0].tabs).toEqual(['recordings', 'install', 'storage']);
    expect(groups[1].tabs).toEqual(['takes', 'drum', 'multisample']);
  });

  it('puts a field\'s patches and tapes on the device side, and an op-xy\'s local library on the workbench', () => {
    // `library` is the device's patches on a field and the local preset library
    // everywhere else, so which half it belongs to depends on what is attached.
    expect(tabGroups('op-1-field')[0].tabs).toEqual(['tapes', 'library', 'install', 'storage']);
    expect(tabGroups('op-xy')[0].tabs).toEqual(['projects', 'install', 'storage']);
    expect(tabGroups('op-xy')[1].tabs).toContain('library');
  });

  it('has no device section when nothing is connected', () => {
    const groups = tabGroups(null);
    expect(groups.map(group => group.key)).toEqual(['workbench']);
    expect(groups[0].tabs).toEqual(['takes', 'drum', 'multisample', 'library', 'projects']);
  });

  it('flattens to exactly the order the shortcuts number', () => {
    for (const kind of [null, 'tp-7', 'op-1-field', 'op-xy'] as const) {
      const flat = tabGroups(kind).flatMap(group => group.tabs);
      expect(tabsForDevice(kind)).toEqual(flat);
      // ⌘1–⌘9 can only reach nine, and every screen must be reachable by its number.
      expect(flat.length).toBeLessThanOrEqual(9);
      expect(new Set(flat).size).toBe(flat.length);
    }
  });
});
