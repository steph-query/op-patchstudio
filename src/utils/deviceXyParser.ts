/**
 * Pure parsing functions for OP-XY .xy project files.
 * No file I/O — operates on raw byte arrays only.
 */

export interface XyPathRecord {
  offset: number;
  segments: string[];
  fullPath: string;
  type: 'preset-sample' | 'standalone-sample' | 'content' | 'short-ref';
}

export const XY_MAGIC = new Uint8Array([0xDD, 0xCC, 0xBB, 0xAA]);

function isPrintableAscii(byte: number): boolean {
  return byte >= 32 && byte <= 126;
}

function readPath(data: Uint8Array, offset: number): { segments: string[]; bytesConsumed: number } {
  const segments: string[] = [];
  let pos = offset;

  while (pos < data.length) {
    let end = pos;
    while (end < data.length && data[end] !== 0) {
      end++;
    }

    if (end === pos) {
      break;
    }

    // MTP supports UTF-8 names as of OS 1.1.15. Never reinterpret them as Latin-1.
    if (end === data.length) break;
    let segment: string;
    try {
      segment = new TextDecoder('utf-8', { fatal: true }).decode(data.slice(pos, end));
    } catch {
      break;
    }
    if ([...segment].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) break;
    segments.push(segment);
    pos = end + 1;

    if (pos >= data.length || data[pos] === 0 || (data[pos] < 32 || data[pos] === 127)) {
      break;
    }
  }

  return { segments, bytesConsumed: pos - offset };
}

export function parseXyPaths(data: Uint8Array): XyPathRecord[] {
  const records: XyPathRecord[] = [];
  const textDecoder = new TextDecoder('ascii');

  for (let i = 0; i < data.length - 6; i++) {
    // Check for /fat32/ prefix
    if (data[i] === 0x2F && data[i + 1] === 0x66 && data[i + 2] === 0x61 &&
        data[i + 3] === 0x74 && data[i + 4] === 0x33 && data[i + 5] === 0x32 &&
        data[i + 6] === 0x2F) {
      const { segments, bytesConsumed } = readPath(data, i);
      if (segments.length > 0) {
        const fullPath = segments.join('');
        let type: XyPathRecord['type'] = 'preset-sample';
        if (fullPath.includes('/samples/')) {
          type = 'standalone-sample';
        }
        records.push({ offset: i, segments, fullPath, type });
        i += bytesConsumed - 1;
      }
    }

    // Check for content/ prefix
    if (data[i] === 0x63 && data[i + 1] === 0x6F && data[i + 2] === 0x6E &&
        data[i + 3] === 0x74 && data[i + 4] === 0x65 && data[i + 5] === 0x6E &&
        data[i + 6] === 0x74 && data[i + 7] === 0x2F) {
      if (i === 0 || data[i - 1] === 0 || !isPrintableAscii(data[i - 1])) {
        const { segments, bytesConsumed } = readPath(data, i);
        if (segments.length > 0) {
          const fullPath = segments.join('');
          records.push({ offset: i, segments, fullPath, type: 'content' });
          i += bytesConsumed - 1;
        }
      }
    }

    // Check for short preset refs (#category/name)
    if (data[i] === 0x23) {
      const nextSlash = data.indexOf(0x2F, i + 1);
      if (nextSlash > i && nextSlash < i + 20) {
        const { segments, bytesConsumed } = readPath(data, i);
        if (segments.length > 0 && segments[0].includes('/')) {
          const fullPath = segments.join('');
          records.push({ offset: i, segments, fullPath, type: 'short-ref' });
          i += bytesConsumed - 1;
        }
      }
    }

    // Detect bare short refs like "drum/preset-name"
    if (i > 0 && data[i - 1] === 0) {
      const possibleCategories = ['drum/', 'keys/', 'bass/', 'lead/', 'pad/', 'strings/', 'wind/', 'brass/'];
      for (const cat of possibleCategories) {
        const catBytes = new TextEncoder().encode(cat);
        let match = true;
        for (let j = 0; j < catBytes.length; j++) {
          if (i + j >= data.length || data[i + j] !== catBytes[j]) {
            match = false;
            break;
          }
        }
        if (match) {
          if (i >= 8) {
            const preceding = textDecoder.decode(data.slice(Math.max(0, i - 8), i));
            if (preceding.includes('/fat32') || preceding.includes('presets/')) {
              break;
            }
          }
          const { segments, bytesConsumed } = readPath(data, i);
          if (segments.length > 0 && segments[0].includes('/') && !segments[0].includes('.wav') && !segments[0].includes('.aif')) {
            const fullPath = segments.join('');
            records.push({ offset: i, segments, fullPath, type: 'short-ref' });
            i += bytesConsumed - 1;
          }
          break;
        }
      }
    }
  }

  return records;
}

