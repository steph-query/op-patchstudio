/**
 * Interpret a TP-7 library scan.
 *
 * The recorder keeps everything in two root folders, recordings/ and memo/,
 * and names files by capture time: 2026-02-23_112713_000.wav. Multitrack
 * takes are single interleaved WAV files with one stereo pair per track.
 */

import type { TauriTreeEntry } from './tauriBridge';
import { READABLE_AUDIO } from './teDevices';

export interface Tp7Recording {
  id: string;
  /** File name including extension. */
  name: string;
  /** File name without extension. */
  stem: string;
  /** Lower-case root folder, normally "recordings" or "memo". */
  folder: string;
  path: string;
  handle: number;
  size: number;
  modified: string | null;
  recordedAt: Date | null;
  extension: string;
}

export interface Tp7FolderSummary {
  name: string;
  count: number;
  bytes: number;
}

export interface Tp7Inventory {
  recordings: Tp7Recording[];
  folders: Tp7FolderSummary[];
  other: number;
}

const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[_T -](\d{2})(\d{2})(\d{2})/;

/** Parse the capture time encoded in a TP-7 file name; local time, as the device records it. */
export function parseTp7Timestamp(name: string): Date | null {
  const match = TIMESTAMP.exec(name);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  return Number.isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day ? null : date;
}

/** Device "modified" strings look like 2026-05-07T12:30:45. */
function parseDeviceDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildTp7Inventory(entries: TauriTreeEntry[]): Tp7Inventory {
  const recordings: Tp7Recording[] = [];
  const folders = new Map<string, Tp7FolderSummary>();
  let other = 0;

  for (const entry of entries) {
    if (entry.is_directory) continue;
    const segments = entry.path.split('/');
    const folder = (segments[0] ?? '').toLowerCase();
    if (folder !== 'recordings' && folder !== 'memo') continue;
    const name = segments[segments.length - 1] ?? '';
    const summary = folders.get(folder) ?? { name: folder, count: 0, bytes: 0 };
    summary.count++;
    summary.bytes += entry.size;
    folders.set(folder, summary);

    const extensionMatch = READABLE_AUDIO.exec(name);
    if (!extensionMatch) { other++; continue; }
    recordings.push({
      id: entry.path,
      name,
      stem: name.replace(READABLE_AUDIO, ''),
      folder,
      path: entry.path,
      handle: entry.handle,
      size: entry.size,
      modified: entry.modified,
      recordedAt: parseTp7Timestamp(name) ?? parseDeviceDate(entry.modified),
      extension: extensionMatch[1].toLowerCase(),
    });
  }

  recordings.sort((a, b) => {
    const timeA = a.recordedAt?.getTime() ?? 0;
    const timeB = b.recordedAt?.getTime() ?? 0;
    if (timeA !== timeB) return timeB - timeA;
    return b.name.localeCompare(a.name, undefined, { numeric: true });
  });

  return {
    recordings,
    folders: [...folders.values()].sort((a, b) => a.name.localeCompare(b.name)),
    other,
  };
}

export function formatRecordingDate(date: Date | null): string {
  if (!date) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const whole = Math.round(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/** Suggest a clean export name: keep the timestamp stem, drop characters that upset file systems. */
export function sanitizeRecordingName(name: string): string {
  return name.replace(/[/\\:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}
