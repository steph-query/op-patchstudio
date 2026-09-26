import { describe, expect, it } from 'vitest';
import {
  buildTp7Inventory,
  formatDuration,
  formatRecordingDate,
  parseTp7Timestamp,
  sanitizeRecordingName,
} from '../../utils/tp7Library';
import type { TauriTreeEntry } from '../../utils/tauriBridge';

function entry(path: string, overrides: Partial<TauriTreeEntry> = {}): TauriTreeEntry {
  return {
    path,
    handle: 1,
    parent_handle: 0,
    is_directory: false,
    size: 1000,
    modified: null,
    ...overrides,
  } as TauriTreeEntry;
}

describe('parseTp7Timestamp', () => {
  it('reads the capture time the recorder writes into the name', () => {
    const date = parseTp7Timestamp('2026-02-23_112713_000.wav');
    expect(date).not.toBeNull();
    // Local time, as the device records it — not shifted into UTC.
    expect([date!.getFullYear(), date!.getMonth() + 1, date!.getDate()]).toEqual([2026, 2, 23]);
    expect([date!.getHours(), date!.getMinutes(), date!.getSeconds()]).toEqual([11, 27, 13]);
  });

  it('accepts the separators the device has been seen to use', () => {
    for (const name of ['2026-02-23_112713.wav', '2026-02-23T112713.wav', '2026-02-23 112713.wav', '2026-02-23-112713.wav']) {
      expect(parseTp7Timestamp(name), name).not.toBeNull();
    }
  });

  it('refuses a date that does not exist rather than rolling it over', () => {
    // `new Date(2026, 1, 30)` would silently become March 2nd.
    expect(parseTp7Timestamp('2026-02-30_120000.wav')).toBeNull();
    expect(parseTp7Timestamp('2026-13-01_120000.wav')).toBeNull();
    expect(parseTp7Timestamp('2026-02-23_256100.wav')).toBeNull();
    expect(parseTp7Timestamp('take one.wav')).toBeNull();
    expect(parseTp7Timestamp('')).toBeNull();
  });
});

describe('buildTp7Inventory', () => {
  it('separates what it can open from what it cannot, and counts both', () => {
    const inventory = buildTp7Inventory([
      entry('recordings/2026-02-23_112713_000.wav', { size: 100 }),
      entry('recordings/2026-02-24_090000_000.aif', { size: 200 }),
      // Neither this app nor the recorder can play these; they are not recordings.
      entry('recordings/borrowed.mp3', { size: 300 }),
      entry('memo/notes.txt', { size: 5 }),
      entry('memo/2026-02-25_101010_000.wav', { size: 400 }),
    ]);

    expect(inventory.recordings.map(recording => recording.name)).toEqual([
      '2026-02-25_101010_000.wav',
      '2026-02-24_090000_000.aif',
      '2026-02-23_112713_000.wav',
    ]);
    expect(inventory.other).toBe(2);
    // Folder totals cover everything in the folder, audio or not — it is a space
    // figure, not a playable-file count.
    expect(inventory.folders).toEqual([
      { name: 'memo', count: 2, bytes: 405 },
      { name: 'recordings', count: 3, bytes: 600 },
    ]);
  });

  it('ignores folders that are not the recorder\'s own', () => {
    const inventory = buildTp7Inventory([
      entry('recordings/a.wav'),
      entry('system/firmware.bin'),
      entry('recordings-old/b.wav'),
      { ...entry('recordings'), is_directory: true },
    ]);
    expect(inventory.recordings.map(recording => recording.path)).toEqual(['recordings/a.wav']);
    expect(inventory.folders.map(folder => folder.name)).toEqual(['recordings']);
    expect(inventory.other).toBe(0);
  });

  it('reads the folder name whatever case the device reports', () => {
    const inventory = buildTp7Inventory([entry('RECORDINGS/a.wav'), entry('Memo/b.wav')]);
    expect(inventory.folders.map(folder => folder.name)).toEqual(['memo', 'recordings']);
    expect(inventory.recordings).toHaveLength(2);
  });

  it('splits name, stem and extension without losing a dotted name', () => {
    const [recording] = buildTp7Inventory([entry('recordings/band.take.2.WAV')]).recordings;
    expect(recording.name).toBe('band.take.2.WAV');
    expect(recording.stem).toBe('band.take.2');
    expect(recording.extension).toBe('wav');
  });

  it('falls back to the device timestamp when the name has none', () => {
    const [recording] = buildTp7Inventory([
      entry('recordings/untitled.wav', { modified: '2026-05-07T12:30:45' }),
    ]).recordings;
    expect(formatRecordingDate(recording.recordedAt)).toBe('2026-05-07 12:30');

    // And reports nothing rather than guessing when neither is usable.
    const [unknown] = buildTp7Inventory([entry('recordings/untitled.wav', { modified: 'not a date' })]).recordings;
    expect(unknown.recordedAt).toBeNull();
  });

  it('puts the newest first, and orders same-second takes by name', () => {
    const inventory = buildTp7Inventory([
      entry('recordings/2026-02-23_112713_001.wav'),
      entry('recordings/2026-02-23_112713_010.wav'),
      entry('recordings/2026-02-23_112713_002.wav'),
      entry('recordings/older.wav'),
    ]);
    expect(inventory.recordings.map(recording => recording.name)).toEqual([
      '2026-02-23_112713_010.wav',
      '2026-02-23_112713_002.wav',
      '2026-02-23_112713_001.wav',
      // No timestamp at all sorts last rather than being dropped.
      'older.wav',
    ]);
  });
});

describe('formatting a recording for the list', () => {
  it('shows a duration a musician reads at a glance', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3599)).toBe('59:59');
    // A long field recording crosses into hours.
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('shows an em dash rather than a wrong number when it does not know', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    expect(formatRecordingDate(null)).toBe('—');
  });

  it('suggests an export name a file system will accept, keeping the timestamp', () => {
    expect(sanitizeRecordingName('2026-02-23_112713_000.wav')).toBe('2026-02-23_112713_000.wav');
    expect(sanitizeRecordingName('band/take:1?.wav')).toBe('band-take-1-.wav');
    expect(sanitizeRecordingName('  spaced   out .wav ')).toBe('spaced out .wav');
  });
});
