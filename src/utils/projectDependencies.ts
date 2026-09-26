import type { XyPathRecord } from './deviceXyParser';
import type { TauriDevicePreset, TauriPresetSample } from './tauriBridge';

export interface ProjectDependency {
  path: string;
  type: XyPathRecord['type'];
  occurrences: number;
  status: 'found' | 'unresolved' | 'built-in' | 'not-checked';
  size?: number;
}

/** Resolve exact paths, never basenames: different folders often contain the same sample name. */
export function inspectProjectDependencies(
  records: XyPathRecord[],
  presets: TauriDevicePreset[],
  samples: TauriPresetSample[],
  hasDeviceInventory: boolean,
): ProjectDependency[] {
  const files = new Map<string, number>();
  const presetNames = new Set<string>();
  for (const preset of presets) {
    presetNames.add(preset.id.replace(/\.preset$/, ''));
    for (const sample of preset.samples) files.set(`/fat32/presets/${preset.id}/${sample.name}`, sample.size);
  }
  for (const sample of samples) files.set(sample.path ? `/fat32/${sample.path}` : `/fat32/samples/user/${sample.name}`, sample.size);
  const unique = new Map<string, ProjectDependency>();
  for (const record of records) {
    const key = `${record.type}:${record.fullPath}`;
    const previous = unique.get(key);
    if (previous) { previous.occurrences++; continue; }
    const size = files.get(record.fullPath);
    const found = record.type === 'short-ref'
      ? presetNames.has(record.fullPath.replace(/^#/, '').replace(/\.preset$/, ''))
      : size !== undefined;
    unique.set(key, {
      path: record.fullPath, type: record.type, occurrences: 1, size,
      status: record.type === 'content' ? 'built-in' : !hasDeviceInventory ? 'not-checked' : found ? 'found' : 'unresolved',
    });
  }
  return [...unique.values()].sort((a, b) => a.path.localeCompare(b.path));
}
