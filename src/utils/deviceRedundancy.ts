/**
 * Answer the question owners actually ask: which files on this device are
 * redundant, and what still points at them?
 *
 * The recurring OP-XY complaint is finding the same audio in `samples/user/`
 * and again inside a preset's snapshot folder, with no way to tell what is safe
 * to remove. This module reports the evidence and refuses to draw the
 * conclusion: matches are by name and size, which is a *candidate* for
 * identical content, not proof, and "no preset references this" is not the same
 * as "unused" while project parsing is incomplete. Nothing here deletes
 * anything — device deletion stays disabled.
 */

import type { TauriDevicePreset, TauriPresetSample } from './tauriBridge';
import { deviceSamplePath } from './teDevices';

/** Where a copy of a file lives, in the user's terms. */
export type CopyRole = 'sample library' | 'preset folder';

export interface FileCopy {
  /** Full device path, for display and for a report. */
  path: string;
  handle: number;
  role: CopyRole;
  /** Preset this copy belongs to, when the copy sits inside one. */
  preset?: string;
}

export interface DuplicateGroup {
  name: string;
  size: number;
  copies: FileCopy[];
  /** Bytes that would come back if only one copy were kept. Not a recommendation. */
  reclaimable: number;
}

export interface UnreferencedSample {
  path: string;
  handle: number;
  size: number;
}

export interface RedundancyReport {
  duplicates: DuplicateGroup[];
  /** Library samples that no readable preset points at. */
  unreferenced: UnreferencedSample[];
  totals: {
    duplicateGroups: number;
    duplicateCopies: number;
    reclaimableBytes: number;
    unreferencedCount: number;
    unreferencedBytes: number;
    librarySamples: number;
    presetSamples: number;
  };
  /** Limits of this analysis, meant to be shown next to the numbers. */
  caveats: string[];
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

/**
 * Group the device's audio files by name and size, and find library samples no
 * preset region names. `projectReferences` may carry full paths recovered from
 * `.xy` inspection; anything they mention is never called unreferenced.
 */
export function analyzeRedundancy(
  presets: TauriDevicePreset[],
  librarySamples: TauriPresetSample[],
  projectReferences: string[] = [],
): RedundancyReport {
  const groups = new Map<string, DuplicateGroup>();
  const add = (name: string, size: number, copy: FileCopy) => {
    const key = `${name.toLowerCase()}:${size}`;
    const group = groups.get(key) ?? { name, size, copies: [], reclaimable: 0 };
    group.copies.push(copy);
    groups.set(key, group);
  };

  for (const sample of librarySamples) {
    add(basename(sample.name), sample.size, {
      path: deviceSamplePath(sample),
      handle: sample.handle,
      role: 'sample library',
    });
  }
  for (const preset of presets) {
    for (const sample of preset.samples) {
      add(basename(sample.name), sample.size, {
        path: `presets/${preset.id}/${sample.name}`,
        handle: sample.handle,
        role: 'preset folder',
        preset: preset.name,
      });
    }
  }

  const duplicates = [...groups.values()]
    .filter(group => group.copies.length > 1)
    .map(group => ({ ...group, reclaimable: group.size * (group.copies.length - 1) }))
    .sort((a, b) => b.reclaimable - a.reclaimable || a.name.localeCompare(b.name));

  // A region's `sample` field is a filename inside its preset folder, so compare on basenames.
  const referencedNames = new Set<string>();
  for (const preset of presets) {
    for (const region of preset.patch_json?.regions ?? []) {
      if (region.sample) referencedNames.add(basename(region.sample).toLowerCase());
    }
    for (const sample of preset.samples) referencedNames.add(basename(sample.name).toLowerCase());
  }
  const referencedPaths = new Set(projectReferences.map(path => path.toLowerCase()));

  const unreferenced = librarySamples
    .filter(sample => {
      const name = basename(sample.name).toLowerCase();
      if (referencedNames.has(name)) return false;
      const path = `samples/user/${sample.name}`.toLowerCase();
      return ![...referencedPaths].some(reference => reference.endsWith(path) || reference.endsWith(name));
    })
    .map(sample => ({ path: deviceSamplePath(sample), handle: sample.handle, size: sample.size }))
    .sort((a, b) => b.size - a.size);

  const presetSamples = presets.reduce((count, preset) => count + preset.samples.length, 0);
  const caveats = [
    'Copies are matched by name and size. That makes them likely to be the same audio, not certainly — confirming it means reading both files.',
    'A preset that saves its own snapshot of a sample is meant to have a second copy. A match here is not a mistake.',
    projectReferences.length
      ? 'Project references come from reading the .xy files this app could parse; a sample no project appears to use may still be needed.'
      : 'No project references were supplied, so this only reflects presets. Inspect projects before treating anything as unused.',
    'Nothing here is a deletion recommendation, and this app does not delete device content.',
  ];

  return {
    duplicates,
    unreferenced,
    totals: {
      duplicateGroups: duplicates.length,
      duplicateCopies: duplicates.reduce((count, group) => count + group.copies.length, 0),
      reclaimableBytes: duplicates.reduce((bytes, group) => bytes + group.reclaimable, 0),
      unreferencedCount: unreferenced.length,
      unreferencedBytes: unreferenced.reduce((bytes, sample) => bytes + sample.size, 0),
      librarySamples: librarySamples.length,
      presetSamples,
    },
    caveats,
  };
}

/** A report the user can keep or diff later, with its own limits stated inside it. */
export function buildRedundancyReport(report: RedundancyReport, device: { model?: string; firmware?: string } | null) {
  return {
    generatedAt: new Date().toISOString(),
    device: { model: device?.model ?? null, firmware: device?.firmware ?? null },
    scope: 'Name-and-size comparison of device audio files plus preset reference lookup. Not a byte-level comparison, not a deletion plan.',
    totals: report.totals,
    caveats: report.caveats,
    duplicates: report.duplicates.map(group => ({
      name: group.name,
      size: group.size,
      reclaimable: group.reclaimable,
      copies: group.copies.map(copy => ({ path: copy.path, role: copy.role, preset: copy.preset ?? null })),
    })),
    unreferenced: report.unreferenced,
  };
}
