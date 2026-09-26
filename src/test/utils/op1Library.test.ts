import { describe, expect, it } from 'vitest';
import { buildOp1Inventory, isOp1PatchFile, op1Folders } from '../../utils/op1Library';
import type { TauriTreeEntry } from '../../utils/tauriBridge';

/**
 * The module the whole OP-1 field view is built on, and it had no test file.
 * Folder depth varies between firmware versions, which is exactly why everything
 * here is matched by name rather than position — and exactly why it is worth
 * pinning that behaviour down.
 */
function entry(path: string, overrides: Partial<TauriTreeEntry> = {}): TauriTreeEntry {
  return { path, handle: 1, parent_handle: 0, is_directory: false, size: 1000, modified: null, ...overrides } as TauriTreeEntry;
}

describe('isOp1PatchFile', () => {
  it('is stricter than "audio this app can read", because a patch is always AIFF', () => {
    expect(isOp1PatchFile('kit.aif')).toBe(true);
    expect(isOp1PatchFile('kit.aiff')).toBe(true);
    expect(isOp1PatchFile('KIT.AIF')).toBe(true);
    // The app can read a wav; the field cannot load one as a patch.
    expect(isOp1PatchFile('kit.wav')).toBe(false);
    expect(isOp1PatchFile('notes.txt')).toBe(false);
  });
});

describe('buildOp1Inventory — patches', () => {
  it('reads drum and synth patches with the folder they sit in', () => {
    const inventory = buildOp1Inventory([
      entry('drum/user/my kit.aif', { size: 100 }),
      entry('synth/packs/strings/warm pad.aif', { size: 200 }),
      entry('synth/top level.aif', { size: 50 }),
    ]);

    expect(inventory.patches.map(patch => [patch.root, patch.folder, patch.name])).toEqual([
      ['drum', 'user', 'my kit'],
      // Directly under the root: no folder rather than a guessed one. It sorts ahead
      // of the subfolders because its folder key is empty.
      ['synth', '', 'top level'],
      // Nested any number of folders deep, because firmware moves them around.
      ['synth', 'packs/strings', 'warm pad'],
    ]);
  });

  it('sorts by root, then folder, then name, the way a numbered pack expects', () => {
    const inventory = buildOp1Inventory([
      entry('synth/user/pad 10.aif'),
      entry('synth/user/pad 2.aif'),
      entry('drum/user/kit.aif'),
    ]);
    expect(inventory.patches.map(patch => patch.path)).toEqual([
      'drum/user/kit.aif',
      // 2 before 10: a plain string sort would put 10 first.
      'synth/user/pad 2.aif',
      'synth/user/pad 10.aif',
    ]);
  });

  it('does not mistake a wav in the patch folders for a patch', () => {
    const inventory = buildOp1Inventory([entry('drum/user/sample.wav')]);
    expect(inventory.patches).toEqual([]);
    expect(inventory.other).toBe(1);
    // Its bytes still count towards the folder, because they still occupy the card.
    expect(inventory.bytesByRoot.drum).toBe(1000);
  });
});

describe('buildOp1Inventory — tapes', () => {
  it('groups a side\'s four tracks, in track order, with its markers', () => {
    const inventory = buildOp1Inventory([
      entry('tape/side-1/track_3.aif', { size: 30 }),
      entry('tape/side-1/track_1.aif', { size: 10 }),
      entry('tape/side-1/tape.json', { size: 1 }),
      entry('tape/side-1/track_2.aif', { size: 20 }),
      entry('tape/side-1/track_4.aif', { size: 40 }),
    ]);

    expect(inventory.tapes).toHaveLength(1);
    const [tape] = inventory.tapes;
    expect(tape.name).toBe('side 1');
    expect(tape.folder).toBe('tape/side-1');
    expect(tape.tracks.map(track => track.index)).toEqual([1, 2, 3, 4]);
    expect(tape.markers?.path).toBe('tape/side-1/tape.json');
    // Markers count towards the tape's size: it is what the folder occupies.
    expect(tape.totalSize).toBe(101);
  });

  it('keeps two sides apart even though every track has the same name', () => {
    const inventory = buildOp1Inventory([
      entry('tape/side-1/track_1.aif'),
      entry('tape/side-2/track_1.aif'),
    ]);
    expect(inventory.tapes.map(tape => tape.folder)).toEqual(['tape/side-1', 'tape/side-2']);
    expect(inventory.tapes.every(tape => tape.tracks.length === 1)).toBe(true);
  });

  it('reads tracks sitting directly in tape/, as older firmware wrote them', () => {
    const inventory = buildOp1Inventory([entry('tape/track_1.aif'), entry('tape/track_2.aif')]);
    expect(inventory.tapes).toHaveLength(1);
    expect(inventory.tapes[0].name).toBe('tape');
    expect(inventory.tapes[0].tracks).toHaveLength(2);
  });

  it('accepts the track spellings the device has used', () => {
    const inventory = buildOp1Inventory([
      entry('tape/a/track_1.aif'),
      entry('tape/b/track 2.aiff'),
      entry('tape/c/track-3.aif'),
      entry('tape/d/track4.aif'),
    ]);
    expect(inventory.tapes.map(tape => tape.tracks[0].index)).toEqual([1, 2, 3, 4]);
    expect(inventory.other).toBe(0);
  });

  it('will not invent a fifth track or a zeroth one', () => {
    const inventory = buildOp1Inventory([
      entry('tape/side-1/track_1.aif'),
      entry('tape/side-1/track_5.aif'),
      entry('tape/side-1/track_0.aif'),
    ]);
    expect(inventory.tapes[0].tracks.map(track => track.index)).toEqual([1]);
    expect(inventory.other).toBe(2);
  });

  it('shows no tape for a folder that holds only markers', () => {
    // An empty tape is nothing to list. tape.json is still recognised, so it is not
    // counted as something the reader did not understand.
    const inventory = buildOp1Inventory([entry('tape/side-1/tape.json', { size: 5 })]);
    expect(inventory.tapes).toEqual([]);
    expect(inventory.other).toBe(0);
    expect(inventory.bytesByRoot.tape).toBe(5);
  });
});

describe('buildOp1Inventory — album and totals', () => {
  it('reads the album sides and names them for reading', () => {
    const inventory = buildOp1Inventory([
      entry('album/side_b.aif', { size: 200 }),
      entry('album/side_a.aif', { size: 100 }),
    ]);
    expect(inventory.album.map(side => side.name)).toEqual(['side a', 'side b']);
    expect(inventory.bytesByRoot.album).toBe(300);
  });

  it('counts bytes per root and ignores folders that are not the library', () => {
    const inventory = buildOp1Inventory([
      entry('drum/user/kit.aif', { size: 10 }),
      entry('synth/user/pad.aif', { size: 20 }),
      entry('tape/side-1/track_1.aif', { size: 30 }),
      entry('album/side_a.aif', { size: 40 }),
      entry('system/firmware.bin', { size: 50 }),
      { ...entry('drum'), is_directory: true, size: 999 },
    ]);
    expect(inventory.bytesByRoot).toEqual({ drum: 10, synth: 20, tape: 30, album: 40, system: 50 });
    // A file outside the four library roots is not a patch, a tape or a side.
    expect(inventory.other).toBe(1);
    // Directories contribute nothing, whatever size the device reports for them.
    expect(inventory.patches).toHaveLength(2);
  });

  it('reads root names in whatever case the device reports', () => {
    const inventory = buildOp1Inventory([entry('DRUM/User/Kit.AIF'), entry('Tape/Side-1/Track_1.aif')]);
    expect(inventory.patches).toHaveLength(1);
    expect(inventory.tapes).toHaveLength(1);
    expect(inventory.other).toBe(0);
  });

  it('has nothing to say about an empty device', () => {
    const inventory = buildOp1Inventory([]);
    expect(inventory).toEqual({ patches: [], tapes: [], album: [], other: 0, bytesByRoot: {} });
  });
});

describe('op1Folders', () => {
  it('puts the user folder first, then the rest in natural order', () => {
    const { patches } = buildOp1Inventory([
      entry('drum/pack 10/a.aif'),
      entry('drum/pack 2/b.aif'),
      entry('drum/user/c.aif'),
      entry('synth/other/d.aif'),
    ]);
    // The user's own patches are what they came looking for.
    expect(op1Folders(patches, 'drum')).toEqual(['user', 'pack 2', 'pack 10']);
    expect(op1Folders(patches, 'synth')).toEqual(['other']);
  });

  it('lists each folder once, and nothing for a root with no patches', () => {
    const { patches } = buildOp1Inventory([entry('drum/user/a.aif'), entry('drum/user/b.aif')]);
    expect(op1Folders(patches, 'drum')).toEqual(['user']);
    expect(op1Folders(patches, 'synth')).toEqual([]);
  });
});
