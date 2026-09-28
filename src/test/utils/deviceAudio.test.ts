import { describe, expect, it, vi } from 'vitest';
import { encodeWav, parseWavInfo, splitWavStereoPairs, decodeWavChannels } from '../../utils/wavDecode';
import { readDevicePreview } from '../../utils/deviceAudio';
import { mtpReadFile, mtpReadPartial } from '../../utils/tauriBridge';
vi.mock('../../utils/tauriBridge', () => ({ mtpReadFile: vi.fn(), mtpReadPartial: vi.fn() }));

describe('Device audio integrity', () => {
  it('rewrites a real AIFF COMM and padded SSND for a bounded preview', async () => {
    const frames = 8000 * 60;
    const aiff = new Uint8Array(58 + frames * 2).fill(1);
    aiff.fill(0, 0, 58);
    const view = new DataView(aiff.buffer);
    const label = (offset: number, value: string) => aiff.set(new TextEncoder().encode(value), offset);
    label(0, 'FORM'); label(8, 'AIFF'); label(12, 'COMM'); label(38, 'SSND');
    view.setUint32(4, aiff.length - 8); view.setUint32(16, 18);
    view.setUint16(20, 1); view.setUint32(22, frames); view.setUint16(26, 16);
    aiff.set([0x40, 0x0b, 0xfa, 0, 0, 0, 0, 0, 0, 0], 28); // extended-80 8000 Hz
    view.setUint32(42, 12 + frames * 2); view.setUint32(46, 4); // SSND padding
    vi.mocked(mtpReadPartial).mockImplementation(async (_handle, offset, size) => aiff.slice(offset, offset + size));
    const preview = await readDevicePreview(10, aiff.length, 20);
    const result = new DataView(preview.buffer);
    expect(result.getUint32(4)).toBe(preview.length - 8);
    expect(result.getUint32(22)).toBe(8000 * 30);
    expect(result.getUint32(42)).toBe(12 + 8000 * 30 * 2);
    expect(result.getUint32(46)).toBe(4);
    expect(mtpReadPartial).toHaveBeenLastCalledWith(10, 58 + 20 * 8000 * 2, 30 * 8000 * 2);
    expect(preview.subarray(58)).toEqual(aiff.subarray(58 + 20 * 8000 * 2, 58 + 50 * 8000 * 2));
  });
  it('reads a 30-second window at the requested frame and rebuilds a valid WAV', async () => {
    const wav = encodeWav([new Float32Array(8000 * 90).fill(.25)], 8000, { bitDepth: 24 });
    vi.mocked(mtpReadPartial).mockImplementation(async (_handle, offset, size) => wav.slice(offset, offset + size));
    const preview = await readDevicePreview(9, wav.length, 20);
    expect(parseWavInfo(preview)?.duration).toBe(30);
    expect(mtpReadPartial).toHaveBeenLastCalledWith(9, 44 + 20 * 8000 * 3, 30 * 8000 * 3);
    expect(mtpReadFile).not.toHaveBeenCalled();
    expect(preview.subarray(44)).toEqual(wav.subarray(44 + 20 * 8000 * 3, 44 + 50 * 8000 * 3));
  });
  /**
   * The reads behind instant playback.
   *
   * Pressing play used to fetch a 1 MB header probe plus the whole 30-second window —
   * about 9.7 MB off a TP-7 — before a single sample sounded. Chunked reads let playback
   * start on a short opening window and continue while the rest arrives.
   */
  it('reads only the seconds asked for, so playback can start before the window is fetched', async () => {
    const wav = encodeWav([new Float32Array(8000 * 90).fill(.25)], 8000, { bitDepth: 24 });
    vi.mocked(mtpReadPartial).mockImplementation(async (_handle, offset, size) => wav.slice(offset, offset + size));

    const opening = await readDevicePreview(9, wav.length, 0, 2);
    expect(parseWavInfo(opening)?.duration).toBe(2);
    expect(mtpReadPartial).toHaveBeenLastCalledWith(9, 44, 2 * 8000 * 3);

    // The next chunk starts exactly where the opening one ended, so the two abut on a
    // frame boundary and can be scheduled back to back without a gap.
    const next = await readDevicePreview(9, wav.length, 2, 6);
    expect(parseWavInfo(next)?.duration).toBe(6);
    expect(mtpReadPartial).toHaveBeenLastCalledWith(9, 44 + 2 * 8000 * 3, 6 * 8000 * 3);
    expect(next.subarray(44)).toEqual(wav.subarray(44 + 2 * 8000 * 3, 44 + 8 * 8000 * 3));
  });

  /**
   * The header probe shrank from 1 MB to 64 KB, which was pure latency on every press.
   * A file that buries its audio behind more metadata than that must still work, so the
   * small probe retries wider rather than failing.
   */
  it('probes a small header first and reads further only when the audio starts late', async () => {
    const wav = encodeWav([new Float32Array(8000 * 4).fill(.2)], 8000, { bitDepth: 16 });
    // A 200 KB LIST chunk in front of the audio pushes `data` past the 64 KB probe.
    const padding = 200 * 1024;
    const bloated = new Uint8Array(wav.length + 8 + padding);
    bloated.set(wav.subarray(0, 36));
    bloated.set(new TextEncoder().encode('LIST'), 36);
    new DataView(bloated.buffer).setUint32(40, padding, true);
    bloated.set(wav.subarray(36), 44 + padding);
    new DataView(bloated.buffer).setUint32(4, bloated.length - 8, true);
    vi.mocked(mtpReadPartial).mockReset();
    vi.mocked(mtpReadPartial).mockImplementation(async (_handle, offset, size) => bloated.slice(offset, offset + size));

    const preview = await readDevicePreview(11, bloated.length, 0, 2);
    expect(parseWavInfo(preview)?.duration).toBe(2);
    // First call is the cheap probe; the retry is what finds the audio. The retry asks
    // for the whole file here because it is smaller than the 1 MB ceiling.
    expect(vi.mocked(mtpReadPartial).mock.calls[0]).toEqual([11, 0, 64 * 1024]);
    expect(vi.mocked(mtpReadPartial).mock.calls[1]).toEqual([11, 0, bloated.length]);
  });

  it('splits multichannel audio without changing sample bytes', () => {
    const wav = encodeWav([new Float32Array([.1, .2]), new Float32Array([.3, .4]), new Float32Array([.5, .6])], 48000, { bitDepth: 24 });
    const stems = splitWavStereoPairs(wav);
    expect(stems.map(stem => stem.channels)).toEqual([2, 1]);
    expect(stems[0].wav.subarray(44, 50)).toEqual(wav.subarray(44, 50));
    expect(stems[1].wav.subarray(44, 47)).toEqual(wav.subarray(50, 53));
    expect(decodeWavChannels(stems[1].wav).channels[0][1]).toBeCloseTo(.6, 5);
  });
  it('previews uncompressed twos AIFC audio', async () => {
    const aifc = new Uint8Array(60 + 16000);
    const view = new DataView(aifc.buffer);
    const label = (offset: number, value: string) => aifc.set(new TextEncoder().encode(value), offset);
    label(0, 'FORM'); label(8, 'AIFC'); label(12, 'COMM'); label(38, 'twos'); label(44, 'SSND');
    view.setUint32(4, aifc.length - 8); view.setUint32(16, 24);
    view.setUint16(20, 1); view.setUint32(22, 8000); view.setUint16(26, 16);
    aifc.set([0x40, 0x0b, 0xfa, 0, 0, 0, 0, 0, 0, 0], 28);
    view.setUint32(48, 16008);
    vi.mocked(mtpReadPartial).mockImplementation(async (_handle, offset, size) => aifc.slice(offset, offset + size));
    const preview = await readDevicePreview(12, aifc.length);
    expect(new DataView(preview.buffer).getUint32(22)).toBe(8000);
    expect(preview.subarray(60)).toEqual(aifc.subarray(60));
  });
  it('rejects truncated and invalid frame layouts', () => {
    const wav = encodeWav([new Float32Array([.1, .2])], 48000);
    expect(parseWavInfo(wav.slice(0, -1))).toBeNull();
    new DataView(wav.buffer).setUint16(32, 1, true);
    expect(parseWavInfo(wav)).toBeNull();
    expect(() => splitWavStereoPairs(wav)).toThrow();
  });
});
