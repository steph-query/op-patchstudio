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
