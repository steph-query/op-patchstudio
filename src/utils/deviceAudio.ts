import { mtpReadFile, mtpReadPartial } from './tauriBridge';
import { parseWavInfo } from './wavDecode';
import { parseCommChunk } from './aifParser';

const HEADER_LIMIT = 1024 * 1024;
const PREVIEW_LIMIT = 32 * 1024 * 1024;
const text = (data: Uint8Array, offset: number, length: number) => new TextDecoder().decode(data.subarray(offset, offset + length));

/** Build a self-contained preview window; full recordings stay on the device. */
export async function readDevicePreview(handle: number, size: number, startSeconds = 0): Promise<Uint8Array> {
  const header = await mtpReadPartial(handle, 0, Math.min(size, HEADER_LIMIT));
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
    if (size > PREVIEW_LIMIT) throw new Error('Preview format is unavailable for this large file. Export the original to audition it on your Mac.');
    return mtpReadFile(handle);
  }
  if (dataOffset > header.length || align < 1 || rate < 1 || available < 0) throw new Error('Invalid audio header. Export the original file for inspection.');
  const offsetFrames = Math.floor(Math.max(0, startSeconds) * rate);
  const start = offsetFrames * align;
  const length = Math.floor(Math.min(Math.max(0, available - start), rate * align * 30, PREVIEW_LIMIT) / align) * align;
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
