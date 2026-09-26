import { describe, expect, it } from 'vitest';
import { knownOrigins, alreadyImported, importCandidates, takeName, takeStem } from '../../utils/takeOrigins';
import type { CatalogAsset } from '../../utils/tauriBridge';

describe('what counts as already imported', () => {
  const occurrence = (path: string, serial: string | null) => ({
    source: 'device', device_model: 'OP-1 Field', device_serial: serial,
    source_path: path, captured_at: null, imported_unix: 1,
  });
  const withOccurrences = (id: string, items: ReturnType<typeof occurrence>[]): CatalogAsset => ({
    id, stored_path: `originals/${id}.aif`, original_name: 'track_1.aif', bytes: 10,
    first_imported_unix: 1, occurrences: items,
  });

  it('tells two identically named tape tracks apart, because the field names them all track_1', () => {
    const origins = knownOrigins([withOccurrences('a', [occurrence('tape/side-1/track_1.aif', 'OP1-1')])]);
    expect(alreadyImported(origins, 'tape/side-1/track_1.aif', 'OP1-1')).toBe(true);
    // Different audio, same name. Matching on the name hid this one completely.
    expect(alreadyImported(origins, 'tape/side-2/track_1.aif', 'OP1-1')).toBe(false);
    expect(alreadyImported(origins, 'album/track_1.aif', 'OP1-1')).toBe(false);
  });

  it('reads paths case-insensitively, as devices write them', () => {
    const origins = knownOrigins([withOccurrences('a', [occurrence('TAPE/Side-1/Track_1.aif', 'OP1-1')])]);
    expect(alreadyImported(origins, 'tape/side-1/track_1.aif', 'op1-1')).toBe(true);
  });

  it('keeps two devices apart when both serials are known', () => {
    const origins = knownOrigins([withOccurrences('a', [occurrence('recordings/take.wav', 'TP7-AAA')])]);
    expect(alreadyImported(origins, 'recordings/take.wav', 'TP7-AAA')).toBe(true);
    // A second TP-7 with its own recording at the same path is a different take.
    expect(alreadyImported(origins, 'recordings/take.wav', 'TP7-BBB')).toBe(false);
  });

  it('treats the same path as the same take when either serial is unknown', () => {
    // Offering a duplicate is a smaller error than hiding a recording, but a missing
    // serial must not turn every take into a new one on every scan either.
    const noSerial = knownOrigins([withOccurrences('a', [occurrence('recordings/take.wav', null)])]);
    expect(alreadyImported(noSerial, 'recordings/take.wav', 'TP7-BBB')).toBe(true);
    const known = knownOrigins([withOccurrences('a', [occurrence('recordings/take.wav', 'TP7-AAA')])]);
    expect(alreadyImported(known, 'recordings/take.wav', null)).toBe(true);
    expect(alreadyImported(known, 'recordings/other.wav', null)).toBe(false);
  });

  it('remembers every device a take arrived from', () => {
    const origins = knownOrigins([withOccurrences('a', [
      occurrence('recordings/take.wav', 'TP7-AAA'),
      occurrence('recordings/take.wav', 'TP7-BBB'),
    ])]);
    expect(alreadyImported(origins, 'recordings/take.wav', 'TP7-AAA')).toBe(true);
    expect(alreadyImported(origins, 'recordings/take.wav', 'TP7-BBB')).toBe(true);
    expect(alreadyImported(origins, 'recordings/take.wav', 'TP7-CCC')).toBe(false);
    expect(knownOrigins([])).toEqual(new Map());
  });
});


describe('importCandidates', () => {
  const tree = (path: string, handle: number) => ({
    path, handle, parent_handle: 1, is_directory: false, size: 100, modified: null,
  });

  it('takes a field\'s recordings and leaves its patches alone', () => {
    const candidates = importCandidates({
      kind: 'op-1-field',
      serial: 'OP1-1',
      treeEntries: [
        tree('tape/side-1/track_1.aif', 1),
        tree('album/side-a.aif', 2),
        tree('drum/user/kit.aif', 3),
        tree('synth/user/pad.aif', 4),
        tree('tape/notes.txt', 5),
        { ...tree('tape/side-2', 6), is_directory: true },
      ],
    }, new Map());
    expect(candidates.map(candidate => candidate.path)).toEqual(['tape/side-1/track_1.aif', 'album/side-a.aif']);
  });

  it('uses the path the device reported for an OP-XY sample', () => {
    const candidates = importCandidates({
      kind: 'op-xy',
      samples: [
        { handle: 1, name: 'kick.wav', size: 10, path: 'samples/breaks/kick.wav' },
        { handle: 2, name: 'snare.wav', size: 10 },
        { handle: 3, name: 'notes.txt', size: 10 },
      ],
    }, new Map());
    expect(candidates.map(candidate => candidate.path)).toEqual(['samples/breaks/kick.wav', 'samples/snare.wav']);
  });

  it('offers nothing for a device with no recording folders', () => {
    expect(importCandidates({ kind: 'unknown', treeEntries: [tree('anything.wav', 1)] }, new Map())).toEqual([]);
    expect(importCandidates({ kind: null, treeEntries: [tree('recordings/a.wav', 1)] }, new Map())).toEqual([]);
    expect(importCandidates({ kind: 'tp-7' }, new Map())).toEqual([]);
  });

  it('skips only what this device already gave the library', () => {
    const origins = knownOrigins([{
      id: 'a', stored_path: 'originals/a.wav', original_name: 'a.wav', bytes: 1, first_imported_unix: 1,
      occurrences: [{ source: 'device', device_model: 'TP-7', device_serial: 'TP7-1', source_path: 'recordings/a.wav', captured_at: null, imported_unix: 1 }],
    }]);
    const contents = { kind: 'tp-7' as const, serial: 'TP7-1', treeEntries: [tree('recordings/a.wav', 1), tree('memo/b.wav', 2)] };
    expect(importCandidates(contents, origins).map(candidate => candidate.path)).toEqual(['memo/b.wav']);
    // The same paths on a second TP-7 are that device's own recordings.
    expect(importCandidates({ ...contents, serial: 'TP7-2' }, origins).map(candidate => candidate.path))
      .toEqual(['recordings/a.wav', 'memo/b.wav']);
  });

  it('passes the capture time through, so a take keeps when it was recorded', () => {
    const [candidate] = importCandidates({
      kind: 'tp-7',
      treeEntries: [{ ...tree('recordings/a.wav', 1), modified: '2026-02-24T09:00:00' }],
    }, new Map());
    expect(candidate.captured_at).toBe('2026-02-24T09:00:00');
  });
});

/**
 * A take arrives called `2026-02-23_112713_000.wav`, and in a studio it is "yard door
 * slam". The name is a label, never a rename: the library is content-addressed, so the
 * bytes and their path are identity and `original_name` is what the recorder called it.
 *
 * One helper rather than `asset.label ?? asset.original_name` at ten call sites — a site
 * that forgets the fallback shows a timestamp where every other site shows the name the
 * owner chose, which looks like the rename failed.
 */
describe('what to call a take', () => {
  const unnamed = { original_name: '2026-02-23_112713_000.wav' };

  it('uses the original name until the owner gives one', () => {
    expect(takeName(unnamed)).toBe('2026-02-23_112713_000.wav');
    expect(takeName({ ...unnamed, label: null })).toBe('2026-02-23_112713_000.wav');
  });

  it('prefers the owner’s name once there is one', () => {
    expect(takeName({ ...unnamed, label: 'yard door slam' })).toBe('yard door slam');
  });

  it('treats a blank or whitespace label as no label', () => {
    // Clearing the field must restore the original name rather than show nothing.
    for (const label of ['', '   ', '\t']) {
      expect(takeName({ ...unnamed, label })).toBe('2026-02-23_112713_000.wav');
    }
  });

  it('strips the extension for names derived from the take', () => {
    expect(takeStem(unnamed)).toBe('2026-02-23_112713_000');
    // A chosen name has no extension to strip, and a dot in it is not one.
    expect(takeStem({ ...unnamed, label: 'yard door slam' })).toBe('yard door slam');
    expect(takeStem({ ...unnamed, label: 'take 2.1 rough' })).toBe('take 2.1 rough');
  });
});
