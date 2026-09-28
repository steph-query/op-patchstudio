import { mtpReadFile, mtpReadPartial } from './tauriBridge';
import { parseWavInfo } from './wavDecode';
import { parseCommChunk } from './aifParser';

/**
 * How much of the front of a file is read to find where the audio starts.
 *
 * It was always 1 MB — to read the ~100 bytes of a WAV header. Over MTP that was the
 * single largest fixed cost of pressing play, and once playback streams (below) it would
 * have been *the* thing the user waited for. 64 KB is still far more than any header
 * these instruments write; `HEADER_LIMIT` remains as the retry for a file that buries
 * its `data` chunk behind a lot of metadata.
 */
const HEADER_PROBE = 64 * 1024;
const HEADER_LIMIT = 1024 * 1024;
const PREVIEW_LIMIT = 32 * 1024 * 1024;
/** The window a preview covers when the caller does not ask for less. */
export const PREVIEW_SECONDS = 30;
const text = (data: Uint8Array, offset: number, length: number) => new TextDecoder().decode(data.subarray(offset, offset + length));

/**
 * Build a self-contained preview window; full recordings stay on the device.
 *
 * `seconds` exists so playback can start on a short opening chunk and keep reading while
 * it plays, rather than fetching the whole window before the first sample sounds. Each
 * call returns a complete, independently decodable WAV or AIFF — chunks are cut on frame
 * boundaries, so consecutive windows abut exactly and can be scheduled back to back.
 */
export async function readDevicePreview(handle: number, size: number, startSeconds = 0, seconds = PREVIEW_SECONDS, headerBytes = HEADER_PROBE): Promise<Uint8Array> {
  const header = await mtpReadPartial(handle, 0, Math.min(size, headerBytes));
  const wav = parseWavInfo(header, size);
  let dataOffset = wav?.dataOffset ?? 0;
  let available = wav?.dataLength ?? 0;
  let align = wav?.blockAlign ?? 0;
  let rate = wav?.sampleRate ?? 0;
  let ssnd = 0;
  let comm = 0;
  if (!wav && text(header, 0, 4) === 'FORM') {
    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    for (let offset = 12; offset + 8 <= header.length;) {
      const length = view.getUint32(offset + 4, false);
      const body = offset + 8;
      const id = text(header, offset, 4);
      if (id === 'COMM' && body + length <= header.length) {
        const info = parseCommChunk(view, header.buffer as ArrayBuffer, body, length, text(header, 8, 4));
        if (info.compressionType && !['NONE', 'twos', 'sowt', 'fl32', 'FL32', 'fl64', 'FL64'].includes(info.compressionType)) throw new Error('Compressed AIFF preview is unavailable. Export the original to audition it on your Mac.');
        align = info.channels * Math.ceil(info.bitDepth / 8); rate = info.sampleRate; comm = body;
      }
      if (id === 'SSND' && body + 8 <= header.length) {
        ssnd = body;
        const padding = view.getUint32(body, false);
        dataOffset = body + 8 + padding;
        available = Math.min(size - dataOffset, length - 8 - padding);
        break;
      }
      offset = body + length + length % 2;
    }
  }
  if (!dataOffset || !align || !rate || (!wav && !comm)) {
    if (headerBytes < HEADER_LIMIT && size > headerBytes) return readDevicePreview(handle, size, startSeconds, seconds, HEADER_LIMIT);
    if (size > PREVIEW_LIMIT) throw new Error('Preview format is unavailable for this large file. Export the original to audition it on your Mac.');
    return mtpReadFile(handle);
  }
  if (dataOffset > header.length && headerBytes < HEADER_LIMIT && size > headerBytes) {
    // The audio starts beyond what was read — a file with a lot of metadata in front of
    // it. Read further before concluding anything about the file.
    return readDevicePreview(handle, size, startSeconds, seconds, HEADER_LIMIT);
  }
  if (dataOffset > header.length || align < 1 || rate < 1 || available < 0) throw new Error('Invalid audio header. Export the original file for inspection.');
  const offsetFrames = Math.floor(Math.max(0, startSeconds) * rate);
  const start = offsetFrames * align;
  const length = Math.floor(Math.min(Math.max(0, available - start), rate * align * seconds, PREVIEW_LIMIT) / align) * align;
  if (!length) throw new Error('No audio at this preview position.');
  const samples = await mtpReadPartial(handle, dataOffset + start, length);
  if (samples.length !== length) throw new Error('Device returned an incomplete audio preview.');
  const result = new Uint8Array(dataOffset + length + length % 2);
  result.set(header.subarray(0, dataOffset)); result.set(samples, dataOffset);
  const out = new DataView(result.buffer);
  out.setUint32(4, result.length - 8, !!wav);
  if (wav) out.setUint32(dataOffset - 4, length, true);
  else {
    out.setUint32(comm + 2, length / align, false);
    out.setUint32(ssnd - 4, dataOffset - ssnd + length, false);
  }
  return result;
}
