import { describe, expect, it } from 'vitest';
import type { SampleData } from '../../utils/indexedDB';

/**
 * How a saved sample's bytes are stored, and why it stopped being a Blob.
 *
 * Running the capture chain in WebKit — the engine Tauri renders in on macOS —
 * every session save failed with *"Error preparing Blob/File data to be stored in
 * object store"*. A probe confirmed that build refuses a Blob or a File in
 * IndexedDB outright while accepting an ArrayBuffer, so a kit built from regions
 * never survived a restart and said nothing about it.
 *
 * Writes are ArrayBuffers now. Reads still accept the Blobs that sessions saved by
 * earlier versions contain, which is what these assertions pin.
 */
function readShape(sample: Pick<SampleData, 'data' | 'encoding'>) {
  const isAudioBufferJson = sample.encoding
    ? sample.encoding === 'audio-buffer-json'
    : sample.data instanceof Blob && sample.data.type === 'application/json';
  return { isAudioBufferJson, needsUnwrapping: sample.data instanceof Blob };
}

describe('a saved sample’s bytes', () => {
  it('reads a session written now, which stores bytes and says what they are', () => {
    const audio = readShape({ data: new ArrayBuffer(8), encoding: 'audio-bytes' });
    expect(audio).toEqual({ isAudioBufferJson: false, needsUnwrapping: false });

    const decoded = readShape({ data: new ArrayBuffer(8), encoding: 'audio-buffer-json' });
    expect(decoded.isAudioBufferJson).toBe(true);
  });

  it('still reads a session written before, which stored a Blob and said nothing', () => {
    // The old shape discriminated on the Blob's own content type.
    const legacyAudio = readShape({ data: new Blob([new Uint8Array(4)], { type: 'audio/wav' }) });
    expect(legacyAudio).toEqual({ isAudioBufferJson: false, needsUnwrapping: true });

    const legacyJson = readShape({ data: new Blob(['{}'], { type: 'application/json' }) });
    expect(legacyJson).toEqual({ isAudioBufferJson: true, needsUnwrapping: true });
  });

  it('trusts the explicit encoding over the container it happens to be in', () => {
    // A legacy Blob that is later re-saved keeps its meaning from the field, not
    // from a content type that may not have survived.
    const relabelled = readShape({ data: new Blob(['{}'], { type: 'application/json' }), encoding: 'audio-bytes' });
    expect(relabelled.isAudioBufferJson).toBe(false);
  });
});
