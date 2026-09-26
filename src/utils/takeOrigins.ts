/**
 * Deciding which recordings on a device are worth offering to import.
 *
 * Pure matching logic, kept out of the panel so it can be reasoned about on its
 * own: what counts as a recording, where it lives, and whether the library has
 * already seen that exact file. Content hashing during the import itself is what
 * actually prevents duplicates — this only decides what to offer.
 */
import type { CatalogAsset, CatalogImportRequest, TauriPresetSample, TauriTreeEntry } from './tauriBridge';
import { deviceSamplePath, isCapturePath, isReadableAudio } from './teDevices';
import type { TeDeviceKind } from './teDevices';

/** What the device holds, narrowed to the parts that decide an import. */
export interface DeviceContents {
  kind: TeDeviceKind | null;
  serial?: string | null;
  samples?: TauriPresetSample[];
  treeEntries?: TauriTreeEntry[];
}

/**
 * Which device paths the library already holds, as path → the serials it saw them on.
 *
 * Names alone are not an identity. An OP-1 field calls every tape track
 * `track_1.aif`, so matching by name meant that after importing one side, every
 * other side was filtered out as already known — silently, with the button
 * reporting nothing new to import. Content still decides during the import
 * itself; this only decides what is worth offering.
 */
export function knownOrigins(assets: CatalogAsset[]): Map<string, Set<string>> {
  const origins = new Map<string, Set<string>>();
  for (const asset of assets) {
    for (const occurrence of asset.occurrences) {
      const path = occurrence.source_path.toLowerCase();
      const serials = origins.get(path) ?? new Set<string>();
      serials.add((occurrence.device_serial ?? '').toLowerCase());
      origins.set(path, serials);
    }
  }
  return origins;
}

/**
 * Whether this exact file has already been imported from this device.
 *
 * The serial only discriminates when both sides have one: if either is unknown,
 * the same path is treated as the same take, because offering a duplicate is a
 * smaller error than hiding a recording the user can never reach.
 */
export function alreadyImported(origins: Map<string, Set<string>>, path: string, serial: string | null | undefined): boolean {
  const serials = origins.get(path.toLowerCase());
  if (!serials) return false;
  const current = (serial ?? '').toLowerCase();
  if (!current) return true;
  return serials.has('') || serials.has(current);
}

/**
 * Takes on the device that are not obviously in the library yet. Matched by where
 * they came from; hashes decide during import.
 *
 * Only audio inside the device's recording folders counts. The tree scan covers
 * the whole library — on an OP-1 field that is `drum` and `synth` as well as
 * `tape` and `album` — and sweeping all of it would offer to copy an entire patch
 * library into a library meant for recordings.
 */
export function importCandidates(
  device: DeviceContents,
  known: Map<string, Set<string>>,
): CatalogImportRequest[] {
  const { kind, serial = null } = device;
  const candidates: CatalogImportRequest[] = [];
  if (kind === 'op-xy') {
    for (const sample of device.samples ?? []) {
      if (isReadableAudio(sample.name)) {
        // The scan knows where each sample actually is, and a guessed path would be
        // recorded as this take's origin for good.
        candidates.push({ handle: sample.handle, path: deviceSamplePath(sample), size: sample.size });
      }
    }
  } else {
    for (const entry of device.treeEntries ?? []) {
      if (!entry.is_directory && isReadableAudio(entry.path) && isCapturePath(kind, entry.path)) {
        candidates.push({ handle: entry.handle, path: entry.path, size: entry.size, captured_at: entry.modified });
      }
    }
  }
  return candidates.filter(candidate => !alreadyImported(known, candidate.path, serial));
}

/**
 * What to call a take on screen.
 *
 * One function rather than `asset.label ?? asset.original_name` at ten call sites: the
 * fallback is a rule about the whole app, and a site that forgets it shows a timestamp
 * where every other site shows the name the owner chose.
 */
export function takeName(asset: { label?: string | null; original_name: string }): string {
  const label = asset.label?.trim();
  return label ? label : asset.original_name;
}

/**
 * The take's name with no file extension, for naming things derived from it.
 *
 * Only `original_name` is a filename, so only it has an extension to remove. A label is
 * a name someone typed and is used verbatim — stripping it as though it were a filename
 * turned "take 2.1 rough" into "take 2".
 */
export function takeStem(asset: { label?: string | null; original_name: string }): string {
  const label = asset.label?.trim();
  return label ? label : asset.original_name.replace(/\.[^/.]+$/, '');
}
