/**
 * Small, dependency-free WAV reader and writer.
 *
 * Used for device recordings where the browser decoder is either unavailable
 * (jsdom in tests) or too slow for a header peek. Handles PCM 8/16/24/32-bit,
 * IEEE float 32/64-bit and WAVE_FORMAT_EXTENSIBLE, which is what the TP-7
 * and most DAWs write.
 */

export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  isFloat: boolean;
  blockAlign: number;
  /** Byte offset of the first audio frame. */
  dataOffset: number;
  /** Byte length of the audio data (bounded by the bytes actually available). */
  dataLength: number;
  frames: number;
  duration: number;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let i = 0; i < length && offset + i < bytes.length; i++) text += String.fromCharCode(bytes[offset + i]);
  return text;
}

/**
 * Parse the RIFF header. Works on a partial buffer (for example the first
 * 4 KB of a file) as long as the fmt and data chunk headers are present;
 * pass `totalSize` so durations are right even when the data is truncated.
 */
export function parseWavInfo(bytes: Uint8Array, totalSize?: number): WavInfo | null {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format: number | null = null;
  let channels = 0;
  let sampleRate = 0;
  let bitDepth = 0;
  let blockAlign = 0;
  while (offset + 8 <= bytes.length) {
    const id = ascii(bytes, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.length) {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      blockAlign = view.getUint16(body + 12, true);
      bitDepth = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE && size >= 40 && body + 40 <= bytes.length) {
        const guidTail = [0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113];
        if (!guidTail.every((value, index) => bytes[body + 26 + index] === value)) return null;
        if (view.getUint16(body + 18, true) !== bitDepth) return null;
        // The sub-format GUID starts with the real format tag.
        format = view.getUint16(body + 24, true);
      }
    } else if (id === 'data') {
      if (format === null || channels === 0 || sampleRate === 0 || bitDepth === 0) return null;
      const isFloat = format === FORMAT_FLOAT;
      if (!isFloat && format !== FORMAT_PCM) return null;
      if (channels > 32 || sampleRate > 384000 || !(isFloat ? [32, 64] : [8, 16, 24, 32]).includes(bitDepth)) return null;
      if (blockAlign !== channels * (bitDepth / 8)) return null;
      const available = (totalSize ?? bytes.length) - body;
      const declared = size === 0 || size === 0xffffffff ? available : size;
      if (declared > available || declared < 0 || declared % blockAlign !== 0) return null;
      const dataLength = Math.max(0, Math.min(declared, available));
      const align = blockAlign || (channels * Math.ceil(bitDepth / 8));
      const frames = align > 0 ? Math.floor(dataLength / align) : 0;
      return { sampleRate, channels, bitDepth, isFloat, blockAlign: align, dataOffset: body, dataLength, frames, duration: sampleRate > 0 ? frames / sampleRate : 0 };
    }
    offset = body + size + (size % 2);
  }
  return null;
}

function readSample(view: DataView, offset: number, bitDepth: number, isFloat: boolean): number {
  if (isFloat) return bitDepth === 64 ? view.getFloat64(offset, true) : view.getFloat32(offset, true);
  switch (bitDepth) {
    case 8: return (view.getUint8(offset) - 128) / 128;
    case 16: return view.getInt16(offset, true) / 32768;
    case 24: {
      const value = view.getUint8(offset) | (view.getUint8(offset + 1) << 8) | (view.getInt8(offset + 2) << 16);
      return value / 8388608;
    }
    case 32: return view.getInt32(offset, true) / 2147483648;
    default: return 0;
  }
}

/** Decode every channel to floats. Meant for short files; long recordings should stay as bytes. */
export function decodeWavChannels(bytes: Uint8Array): { channels: Float32Array[]; sampleRate: number; info: WavInfo } {
  const info = parseWavInfo(bytes);
  if (!info) throw new Error('Not a supported WAV file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bytesPerSample = Math.ceil(info.bitDepth / 8);
  const channels = Array.from({ length: info.channels }, () => new Float32Array(info.frames));
  for (let frame = 0; frame < info.frames; frame++) {
    const base = info.dataOffset + frame * info.blockAlign;
    for (let channel = 0; channel < info.channels; channel++) {
      channels[channel][frame] = readSample(view, base + channel * bytesPerSample, info.bitDepth, info.isFloat);
    }
  }
  return { channels, sampleRate: info.sampleRate, info };
}

export interface WavEncodeOptions {
  /** 16 or 24 for PCM, 32 for IEEE float. */
  bitDepth?: 16 | 24 | 32;
}

/** Encode float channels into a canonical WAV file. */
export function encodeWav(channels: Float32Array[], sampleRate: number, options: WavEncodeOptions = {}): Uint8Array {
  const bitDepth = options.bitDepth ?? 16;
  if (channels.length === 0) throw new Error('At least one channel is required');
  const frames = channels[0].length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels.length * bytesPerSample;
  const dataLength = frames * blockAlign;
  const bytes = new Uint8Array(44 + dataLength + (dataLength % 2));
  const view = new DataView(bytes.buffer);
  const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[offset + i] = text.charCodeAt(i); };
  write(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  write(36, 'data');
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame++) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[frame] ?? 0));
      if (bitDepth === 32) {
        view.setFloat32(offset, sample, true);
      } else if (bitDepth === 24) {
        const value = Math.round(sample * 8388607);
        view.setUint8(offset, value & 0xff);
        view.setUint8(offset + 1, (value >> 8) & 0xff);
        view.setUint8(offset + 2, (value >> 16) & 0xff);
      } else {
        view.setInt16(offset, Math.round(sample * 32767), true);
      }
      offset += bytesPerSample;
    }
  }
  return bytes;
}

export interface WavStem {
  /** 1-based track number. */
  index: number;
  channels: number;
  wav: Uint8Array;
}

/**
 * Split an interleaved multichannel WAV into stereo pairs without converting
 * to floats, so a 24-bit 96 kHz multitrack take keeps its original bytes.
 * An odd trailing channel becomes a mono stem.
 */
export function splitWavStereoPairs(bytes: Uint8Array): WavStem[] {
  const info = parseWavInfo(bytes);
  if (!info) throw new Error('Not a supported WAV file');
  if (info.channels <= 2) return [{ index: 1, channels: info.channels, wav: bytes }];
  const bytesPerSample = Math.ceil(info.bitDepth / 8);
  const stems: WavStem[] = [];
  for (let first = 0; first < info.channels; first += 2) {
    const count = Math.min(2, info.channels - first);
    const blockAlign = count * bytesPerSample;
    const dataLength = info.frames * blockAlign;
    const out = new Uint8Array(44 + dataLength + (dataLength % 2));
    const view = new DataView(out.buffer);
    const write = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) out[offset + i] = text.charCodeAt(i); };
    write(0, 'RIFF');
    view.setUint32(4, out.length - 8, true);
    write(8, 'WAVE');
    write(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, info.isFloat ? FORMAT_FLOAT : FORMAT_PCM, true);
    view.setUint16(22, count, true);
    view.setUint32(24, info.sampleRate, true);
    view.setUint32(28, info.sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, info.bitDepth, true);
    write(36, 'data');
    view.setUint32(40, dataLength, true);
    let dest = 44;
    for (let frame = 0; frame < info.frames; frame++) {
      const src = info.dataOffset + frame * info.blockAlign + first * bytesPerSample;
      out.set(bytes.subarray(src, src + blockAlign), dest);
      dest += blockAlign;
    }
    stems.push({ index: first / 2 + 1, channels: count, wav: out });
  }
  return stems;
}
