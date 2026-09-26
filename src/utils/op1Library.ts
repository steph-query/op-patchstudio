/**
 * Interpret an OP-1 field library scan.
 *
 * The device exposes four root folders over MTP: drum/, synth/, tape/ and
 * album/. Patches are single .aif files (audio plus an "op-1" JSON chunk),
 * tapes are groups of track_1.aif … track_4.aif with an optional tape.json,
 * and the album holds side_a.aif / side_b.aif. Folder depth varies between
 * firmware versions, so everything is matched by name rather than position.
 */

import type { TauriTreeEntry } from './tauriBridge';

export interface Op1PatchEntry {
  id: string;
  name: string;
  /** Folder between the root and the file, for example "user" or a pack name. Empty for top-level files. */
  folder: string;
  root: 'drum' | 'synth';
  path: string;
  handle: number;
  size: number;
  modified: string | null;
}

export interface Op1TapeTrack {
  index: number;
  name: string;
  path: string;
  handle: number;
  size: number;
}

export interface Op1Tape {
  id: string;
  name: string;
  folder: string;
  tracks: Op1TapeTrack[];
  markers: { path: string; handle: number; size: number } | null;
  totalSize: number;
}

export interface Op1AlbumSide {
  id: string;
  name: string;
  path: string;
  handle: number;
  size: number;
}

export interface Op1Inventory {
  patches: Op1PatchEntry[];
  tapes: Op1Tape[];
  album: Op1AlbumSide[];
  /** Files under the library roots that this reader does not recognise. */
  other: number;
  bytesByRoot: Record<string, number>;
}

/** Stricter than `isReadableAudio`: an OP-1 field patch is always AIFF, so a
 * `.wav` sitting in `drum/` is not a patch even though the app can read it. */
const PATCH_EXTENSION = /\.(aif|aiff)$/i;
const TRACK_NAME = /^track[_ -]?([1-4])\.(aif|aiff)$/i;

export function isOp1PatchFile(name: string): boolean {
  return PATCH_EXTENSION.test(name);
}

function prettify(folder: string): string {
  return folder.replace(/[_-]+/g, ' ').trim();
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function buildOp1Inventory(entries: TauriTreeEntry[]): Op1Inventory {
  const patches: Op1PatchEntry[] = [];
  const album: Op1AlbumSide[] = [];
  const tapeGroups = new Map<string, Op1Tape>();
  const bytesByRoot: Record<string, number> = {};
  let other = 0;

  for (const entry of entries) {
    if (entry.is_directory) continue;
    const segments = entry.path.split('/');
    const root = (segments[0] ?? '').toLowerCase();
    const fileName = segments[segments.length - 1] ?? '';
    bytesByRoot[root] = (bytesByRoot[root] ?? 0) + entry.size;

    if ((root === 'drum' || root === 'synth') && PATCH_EXTENSION.test(fileName)) {
      patches.push({
        id: entry.path,
        name: fileName.replace(PATCH_EXTENSION, ''),
        folder: segments.slice(1, -1).join('/'),
        root,
        path: entry.path,
        handle: entry.handle,
        size: entry.size,
        modified: entry.modified,
      });
      continue;
    }

    if (root === 'tape') {
      const folder = segments.slice(0, -1).join('/');
      const track = TRACK_NAME.exec(fileName);
      const isMarkers = fileName.toLowerCase() === 'tape.json';
      if (!track && !isMarkers) { other++; continue; }
      let tape = tapeGroups.get(folder);
      if (!tape) {
        const leaf = segments.length > 2 ? segments[segments.length - 2] : 'tape';
        tape = { id: folder, name: prettify(leaf), folder, tracks: [], markers: null, totalSize: 0 };
        tapeGroups.set(folder, tape);
      }
      if (track) {
        tape.tracks.push({ index: Number(track[1]), name: fileName, path: entry.path, handle: entry.handle, size: entry.size });
        tape.totalSize += entry.size;
      } else {
        tape.markers = { path: entry.path, handle: entry.handle, size: entry.size };
        tape.totalSize += entry.size;
      }
      continue;
    }

    if (root === 'album' && PATCH_EXTENSION.test(fileName)) {
      album.push({
        id: entry.path,
        name: prettify(fileName.replace(PATCH_EXTENSION, '')),
        path: entry.path,
        handle: entry.handle,
        size: entry.size,
      });
      continue;
    }

    other++;
  }

  const tapes = [...tapeGroups.values()]
    .filter(tape => tape.tracks.length > 0)
    .map(tape => ({ ...tape, tracks: [...tape.tracks].sort((a, b) => a.index - b.index) }))
    .sort((a, b) => naturalCompare(a.folder, b.folder));

  patches.sort((a, b) => naturalCompare(`${a.root}/${a.folder}/${a.name}`, `${b.root}/${b.folder}/${b.name}`));
  album.sort((a, b) => naturalCompare(a.name, b.name));

  return { patches, tapes, album, other, bytesByRoot };
}

/** Distinct folders under a root, in display order, with "user" first when present. */
export function op1Folders(patches: Op1PatchEntry[], root: 'drum' | 'synth'): string[] {
  const folders = new Set<string>();
  for (const patch of patches) if (patch.root === root) folders.add(patch.folder);
  return [...folders].sort((a, b) => {
    if (a === 'user') return -1;
    if (b === 'user') return 1;
    return naturalCompare(a, b);
  });
}
