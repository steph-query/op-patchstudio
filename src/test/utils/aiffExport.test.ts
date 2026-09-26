import { describe, expect, it } from 'vitest';
import { audioBufferToAiff } from '../../utils/aiffExport';
import { parseCommChunk, readExtendedFloat80 } from '../../utils/aifParser';
import { audioBufferToWav } from '../../utils/wavExport';

/**
 * The bytes this produces are what get written onto an OP-1 field, and a
 * malformed AIFF is a file the instrument will not load. Until now the only test
 * that mentioned this module replaced it with a mock, so nothing checked the
 * format at all.
 *
 * Every assertion here reads the produced file back with `aifParser`, which is a
 * separate implementation written from the other direction — so agreement means
 * the encoder and the reader share an understanding of the spec, not that one
 * confirms its own output.
 */
class Buffer {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  duration: number;
  private readonly fill: (channel: number, frame: number) => number;

  constructor(channels = 2, length = 64, sampleRate = 44100, fill?: (channel: number, frame: number) => number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.fill = fill ?? ((channel, frame) => (channel === 0 ? 1 : -1) * (frame / length));
  }

  getChannelData(channel: number): Float32Array {
    const data = new Float32Array(this.length);
    for (let frame = 0; frame < this.length; frame++) data[frame] = this.fill(channel, frame);
    return data;
  }
}

async function encoded(buffer: Buffer, options: Parameters<typeof audioBufferToAiff>[1] = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blob = await audioBufferToAiff(buffer as any, options);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const text = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  return { bytes, view, text };
}

/** Walk the chunk list the way any reader would, rather than assuming offsets. */
function chunks(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer);
  const found = new Map<string, { offset: number; size: number }>();
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, false);
    found.set(id, { offset: offset + 8, size });
    offset += 8 + size + (size % 2);
  }
  return found;
}

describe('audioBufferToAiff', () => {
  it('writes a FORM/AIFF container a reader can walk', async () => {
    const { bytes, view, text } = await encoded(new Buffer(2, 64));
    expect(text(0)).toBe('FORM');
    expect(text(8)).toBe('AIFF');
    // The declared size must match the file, or a strict reader rejects it.
    expect(view.getUint32(4, false)).toBe(bytes.length - 8);

    const found = chunks(bytes);
    expect([...found.keys()]).toContain('COMM');
    expect([...found.keys()]).toContain('SSND');
  });

  it('describes the audio it actually wrote', async () => {
    const { bytes, view } = await encoded(new Buffer(2, 100, 44100), { bitDepth: 16 });
    const comm = chunks(bytes).get('COMM')!;
    const parsed = parseCommChunk(view, bytes.buffer, comm.offset, comm.size, 'AIFF');

    expect(parsed.channels).toBe(2);
    expect(parsed.numSampleFrames).toBe(100);
    expect(parsed.bitDepth).toBe(16);
    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.isFloat).toBe(false);
    expect(parsed.isLittleEndian).toBe(false);

    // The SSND payload is the frames plus its own offset and blockSize fields.
    const ssnd = chunks(bytes).get('SSND')!;
    expect(ssnd.size).toBe(8 + 100 * 2 * 2);
    expect(view.getUint32(ssnd.offset, false)).toBe(0);
    expect(view.getUint32(ssnd.offset + 4, false)).toBe(0);
  });

  it('writes the 80-bit sample rate the format demands, for every rate it accepts', async () => {
    for (const rate of [11025, 22050, 44100]) {
      const { bytes, view } = await encoded(new Buffer(1, 8, rate), { sampleRate: rate });
      const comm = chunks(bytes).get('COMM')!;
      // Read the ten raw bytes, not the parser's convenience field.
      expect(readExtendedFloat80(bytes, comm.offset + 8), `${rate} hz`).toBe(rate);
      expect(parseCommChunk(view, bytes.buffer, comm.offset, comm.size, 'AIFF').sampleRate).toBe(rate);
    }
  });

  it('stores samples big-endian, which is what makes it an AIFF', async () => {
    // A single frame whose value is known exactly: full positive scale on the left.
    const { bytes, view } = await encoded(new Buffer(1, 1, 44100, () => 1), { bitDepth: 16 });
    const ssnd = chunks(bytes).get('SSND')!;
    const sample = view.getInt16(ssnd.offset + 8, false);
    expect(sample).toBeGreaterThan(32000);
    // Read the other way round it would be a small negative number — the failure
    // mode that makes a file play as noise rather than not play at all.
    expect(view.getInt16(ssnd.offset + 8, true)).not.toBe(sample);
  });

  it('keeps both channels, interleaved left then right', async () => {
    const { bytes, view } = await encoded(
      new Buffer(2, 2, 44100, channel => (channel === 0 ? 1 : -1)),
      { bitDepth: 16 },
    );
    const ssnd = chunks(bytes).get('SSND')!;
    const at = (index: number) => view.getInt16(ssnd.offset + 8 + index * 2, false);
    expect(at(0)).toBeGreaterThan(32000);
    expect(at(1)).toBeLessThan(-32000);
    expect(at(2)).toBeGreaterThan(32000);
    expect(at(3)).toBeLessThan(-32000);
  });

  it('pads an odd-length chunk so the next one stays aligned', async () => {
    // Three 8-bit mono frames is an odd byte count; AIFF chunks must be even.
    const { bytes } = await encoded(new Buffer(1, 3, 44100), { bitDepth: 8 });
    const found = chunks(bytes);
    expect(found.get('SSND')!.size).toBe(8 + 3);
    // Walking to the end without desynchronising is the assertion: `chunks` would
    // read rubbish ids after a missing pad byte.
    for (const id of found.keys()) expect(id).toMatch(/^[A-Za-z0-9 ]{4}$/);
    expect(bytes.length % 2).toBe(0);
  });

  it('writes AIFC with a compression name when the audio is float', async () => {
    const { bytes, view, text } = await encoded(new Buffer(1, 16, 44100), { bitDepth: 32, isFloat: true });
    expect(text(8)).toBe('AIFC');
    const comm = chunks(bytes).get('COMM')!;
    const parsed = parseCommChunk(view, bytes.buffer, comm.offset, comm.size, 'AIFC');
    expect(parsed.isFloat).toBe(true);
    expect(parsed.bitDepth).toBe(32);
    expect(parsed.compressionType).toBe('fl32');
  });

  it('refuses a bit depth or rate it cannot write, rather than writing something wrong', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const buffer = new Buffer(1, 8) as any;
    await expect(audioBufferToAiff(buffer, { bitDepth: 20 })).rejects.toThrow(/Unsupported bit depth/);
    await expect(audioBufferToAiff(buffer, { sampleRate: 48000 })).rejects.toThrow(/Unsupported sample rate/);
  });
});

describe('loop points, against the WAV writer', () => {
  /** The MARK chunk's two marker positions, found by walking the chunk list. */
  async function aiffLoop(options: { loopStart: number; loopEnd: number }) {
    const { bytes, view } = await encoded(new Buffer(1, 1000, 44100), { bitDepth: 16, ...options });
    const mark = chunks(bytes).get('MARK');
    expect(mark, 'a MARK chunk is written when loop points are given').toBeDefined();
    // numMarkers, then each marker: id (2), position (4), pstring name.
    let offset = mark!.offset + 2;
    const positions: number[] = [];
    for (let marker = 0; marker < 2; marker++) {
      offset += 2;
      positions.push(view.getUint32(offset, false));
      offset += 4;
      const length = bytes[offset];
      offset += 1 + length + ((length + 1) % 2);
    }
    return { start: positions[0], end: positions[1] };
  }

  it('writes the frames it was given, inclusive', async () => {
    expect(await aiffLoop({ loopStart: 200, loopEnd: 800 })).toEqual({ start: 200, end: 800 });
    // A loop from the very first frame is not turned into something else.
    expect(await aiffLoop({ loopStart: 0, loopEnd: 999 })).toEqual({ start: 0, end: 999 });
  });

  it('agrees with the WAV writer frame for frame', async () => {
    // The OP-XY reads both containers, so the same preset exported as AIFF and as WAV
    // must loop identically. It did not: this writer subtracted 1 from the end only,
    // the WAV writer subtracted 1 from both.
    const aiff = await aiffLoop({ loopStart: 150, loopEnd: 850 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const wavBytes = new Uint8Array(await (await audioBufferToWav(new Buffer(1, 1000, 44100) as any, 16, {
      rootNote: 60, loopStart: 150, loopEnd: 850,
    })).arrayBuffer());
    const wavView = new DataView(wavBytes.buffer);
    let offset = 12;
    let wav: { start: number; end: number } | null = null;
    while (offset + 8 <= wavBytes.length) {
      const id = String.fromCharCode(...wavBytes.slice(offset, offset + 4));
      const size = wavView.getUint32(offset + 4, true);
      if (id === 'smpl') {
        wav = {
          start: wavView.getUint32(offset + 8 + 36 + 8, true),
          end: wavView.getUint32(offset + 8 + 36 + 12, true),
        };
        break;
      }
      offset += 8 + size + (size % 2);
    }
    expect(wav).toEqual(aiff);
  });
});
