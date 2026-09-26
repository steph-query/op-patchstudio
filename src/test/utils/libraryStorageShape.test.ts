import { describe, expect, it, vi } from 'vitest';
import { audioBytesToFile, savePresetToLibrary } from '../../utils/libraryUtils';

/**
 * What a saved preset is allowed to contain.
 *
 * Saving to the library failed outright in WebKit — the engine Tauri renders in on
 * macOS — with *"Error preparing Blob/File data to be stored in object store"*.
 * That build refuses a Blob or a File in IndexedDB while accepting an ArrayBuffer,
 * and a preset record held both the rendered audio as a Blob and the original
 * `File` object. Neither is needed: the bytes are the audio, and the name is kept
 * beside them.
 */
const saved: unknown[] = [];
vi.mock('../../utils/indexedDB', () => ({
  indexedDBManager: {
    init: vi.fn().mockResolvedValue(undefined),
    savePreset: vi.fn(async (preset: unknown) => { saved.push(preset); }),
    getPresets: vi.fn().mockResolvedValue([]),
  },
}));

/** Anything IndexedDB would refuse on a strict engine. */
function unstorable(value: unknown, path = '$'): string[] {
  if (value instanceof Blob || value instanceof File) return [path];
  if (Array.isArray(value)) return value.flatMap((item, index) => unstorable(item, `${path}[${index}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => unstorable(item, `${path}.${key}`));
  }
  return [];
}

describe('a preset record handed to IndexedDB', () => {
  it('rebuilds a File from stored bytes, whichever shape they were stored in', () => {
    const fromBytes = audioBytesToFile(new Uint8Array([1, 2, 3]).buffer, 'kick.wav');
    expect(fromBytes).toBeInstanceOf(File);
    expect(fromBytes.name).toBe('kick.wav');
    expect(fromBytes.type).toBe('audio/wav');

    // Presets saved by earlier versions hold a Blob; those still open.
    const fromBlob = audioBytesToFile(new Blob([new Uint8Array([1, 2, 3])]), 'kick.wav');
    expect(fromBlob).toBeInstanceOf(File);
    expect(fromBlob.name).toBe('kick.wav');
  });

  it('never contains a Blob or a File, which is what made saving fail', () => {
    // A record shaped the way the storage layer builds one.
    const record = {
      name: 'library kit',
      drumSamples: [{ name: 'kick.wav', audioBlob: new Uint8Array(8).buffer, originalIndex: 0, metadata: { duration: 0.5 } }],
      multisampleFiles: [{ name: 'pad c3.wav', audioBlob: new Uint8Array(8).buffer, rootNote: 60, metadata: { duration: 1 } }],
    };
    expect(unstorable(record)).toEqual([]);

    // And the detector earns its keep: it finds what used to be in there.
    const oldShape = { drumSamples: [{ audioBlob: new Blob([]), file: new File([], 'kick.wav') }] };
    expect(unstorable(oldShape)).toEqual(['$.drumSamples[0].audioBlob', '$.drumSamples[0].file']);
  });

  it('exists as a function the app actually calls', () => {
    expect(typeof savePresetToLibrary).toBe('function');
  });
});
