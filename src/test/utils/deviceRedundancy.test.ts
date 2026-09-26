import { describe, it, expect } from 'vitest';
import { analyzeRedundancy, buildRedundancyReport } from '../../utils/deviceRedundancy';
import type { TauriDevicePreset, TauriPresetSample } from '../../utils/tauriBridge';

function preset(id: string, name: string, samples: Array<[string, number]>, regions?: string[]): TauriDevicePreset {
  return {
    id,
    name,
    category: id.split('/')[0] ?? '',
    preset_type: 'drum',
    folder_handle: 100,
    patch_json: regions ? { regions: regions.map(sample => ({ sample })) } : null,
    samples: samples.map(([sampleName, size], index) => ({ handle: 200 + index, name: sampleName, size })),
    total_size: samples.reduce((sum, [, size]) => sum + size, 0),
  };
}

function librarySample(name: string, size: number, handle = 1): TauriPresetSample {
  return { handle, name, size };
}

describe('analyzeRedundancy — duplicate candidates', () => {
  it('pairs a library sample with the snapshot copy inside a preset', () => {
    const report = analyzeRedundancy(
      [preset('drum/big kit.preset', 'big kit', [['kick.wav', 2048]])],
      [librarySample('kick.wav', 2048, 7)],
    );
    expect(report.duplicates).toHaveLength(1);
    const [group] = report.duplicates;
    expect(group.name).toBe('kick.wav');
    expect(group.reclaimable).toBe(2048);
    expect(group.copies.map(copy => copy.path)).toEqual([
      'samples/kick.wav',
      'presets/drum/big kit.preset/kick.wav',
    ]);
    expect(group.copies.map(copy => copy.role)).toEqual(['sample library', 'preset folder']);
    expect(group.copies[1].preset).toBe('big kit');
  });

  it('does not pair files that share a name but differ in size', () => {
    const report = analyzeRedundancy(
      [preset('drum/kit.preset', 'kit', [['kick.wav', 4096]])],
      [librarySample('kick.wav', 2048)],
    );
    expect(report.duplicates).toEqual([]);
    expect(report.totals.reclaimableBytes).toBe(0);
  });

  it('matches case-insensitively and counts every extra copy once', () => {
    const report = analyzeRedundancy(
      [
        preset('drum/a.preset', 'a', [['Kick.wav', 1000]]),
        preset('drum/b.preset', 'b', [['KICK.wav', 1000]]),
      ],
      [librarySample('kick.wav', 1000)],
    );
    expect(report.duplicates[0].copies).toHaveLength(3);
    expect(report.duplicates[0].reclaimable).toBe(2000);
    expect(report.totals.duplicateCopies).toBe(3);
  });

  it('compares basenames so a sample in a subfolder still matches', () => {
    const report = analyzeRedundancy(
      [preset('keys/pad.preset', 'pad', [['pad c3.wav', 512]])],
      [librarySample('field/pad c3.wav', 512)],
    );
    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0].copies[0].path).toBe('samples/field/pad c3.wav');
  });

  it('ranks the groups that account for the most bytes first', () => {
    const report = analyzeRedundancy(
      [preset('drum/kit.preset', 'kit', [['small.wav', 10], ['big.wav', 5000]])],
      [librarySample('small.wav', 10, 1), librarySample('big.wav', 5000, 2)],
    );
    expect(report.duplicates.map(group => group.name)).toEqual(['big.wav', 'small.wav']);
  });
});

describe('analyzeRedundancy — unreferenced library samples', () => {
  it('lists only samples no readable preset names', () => {
    const report = analyzeRedundancy(
      [preset('drum/kit.preset', 'kit', [['used.wav', 100]], ['used.wav'])],
      [librarySample('used.wav', 100, 1), librarySample('forgotten.wav', 900, 2)],
    );
    expect(report.unreferenced.map(sample => sample.path)).toEqual(['samples/forgotten.wav']);
    expect(report.totals.unreferencedBytes).toBe(900);
  });

  it('treats a patch.json region as a reference even when the preset folder has no copy', () => {
    const report = analyzeRedundancy(
      [preset('keys/pad.preset', 'pad', [], ['shared pad.wav'])],
      [librarySample('shared pad.wav', 700)],
    );
    expect(report.unreferenced).toEqual([]);
  });

  it('never calls a sample unreferenced when a project points at it', () => {
    const report = analyzeRedundancy(
      [],
      [librarySample('loop.wav', 300)],
      ['/fat32/samples/user/loop.wav'],
    );
    expect(report.unreferenced).toEqual([]);
    expect(report.caveats.join(' ')).toContain('may still be needed');
  });

  it('says plainly that preset-only analysis is incomplete when no projects were supplied', () => {
    const report = analyzeRedundancy([], [librarySample('loop.wav', 300)]);
    expect(report.unreferenced).toHaveLength(1);
    expect(report.caveats.join(' ')).toContain('only reflects presets');
  });

  it('largest first, so the biggest question is answered first', () => {
    const report = analyzeRedundancy([], [librarySample('a.wav', 10, 1), librarySample('b.wav', 99, 2)]);
    expect(report.unreferenced.map(sample => sample.path)).toEqual(['samples/b.wav', 'samples/a.wav']);
  });
});

describe('analyzeRedundancy — honesty about what it proves', () => {
  it('never claims the copies are identical or recommends deleting them', () => {
    const report = analyzeRedundancy(
      [preset('drum/kit.preset', 'kit', [['kick.wav', 2048]])],
      [librarySample('kick.wav', 2048)],
    );
    const caveats = report.caveats.join(' ');
    expect(caveats).toContain('not certainly');
    expect(caveats).toContain('Nothing here is a deletion recommendation');
    expect(caveats).toContain('is not a mistake');
    expect(caveats.toLowerCase()).not.toContain('safe to delete');
  });

  it('counts an empty device without inventing findings', () => {
    const report = analyzeRedundancy([], []);
    expect(report.duplicates).toEqual([]);
    expect(report.unreferenced).toEqual([]);
    expect(report.totals).toMatchObject({ duplicateGroups: 0, reclaimableBytes: 0, unreferencedCount: 0, librarySamples: 0, presetSamples: 0 });
  });
});

describe('buildRedundancyReport', () => {
  it('records the device, the scope and the caveats alongside the findings', () => {
    const analysis = analyzeRedundancy(
      [preset('drum/kit.preset', 'kit', [['kick.wav', 2048]])],
      [librarySample('kick.wav', 2048), librarySample('spare.wav', 64)],
    );
    const report = buildRedundancyReport(analysis, { model: 'OP-XY', firmware: '1.1.33' });
    expect(report.device).toEqual({ model: 'OP-XY', firmware: '1.1.33' });
    expect(report.scope).toContain('Not a byte-level comparison');
    expect(report.duplicates[0].copies[1]).toEqual({ path: 'presets/drum/kit.preset/kick.wav', role: 'preset folder', preset: 'kit' });
    expect(report.unreferenced[0].path).toBe('samples/spare.wav');
    expect(report.caveats.length).toBeGreaterThan(2);
    expect(Date.parse(report.generatedAt)).not.toBeNaN();
  });

  it('handles a disconnected device without inventing identity', () => {
    const report = buildRedundancyReport(analyzeRedundancy([], []), null);
    expect(report.device).toEqual({ model: null, firmware: null });
  });
});

describe('the paths a space review reports', () => {
  it('uses the path the scan reported, because the report is something people act on', () => {
    // A user reads this report — and its exported JSON — and then goes looking for
    // the file with another transfer tool. A path that does not exist wastes that
    // trip; an invented `user/` folder is exactly how that happens.
    const report = analyzeRedundancy(
      [preset('drum/kit.preset', 'kit', [['kick.wav', 2048]])],
      [{ handle: 7, name: 'breaks/kick.wav', size: 2048, path: 'samples/breaks/kick.wav' }],
    );
    expect(report.duplicates[0].copies[0].path).toBe('samples/breaks/kick.wav');
  });

  it('falls back to the samples folder itself, never to a subfolder it made up', () => {
    const report = analyzeRedundancy([], [{ handle: 8, name: 'user/nested.wav', size: 10 }]);
    // `name` is already relative to samples/, so the fallback adds only that root —
    // it does not repeat a folder that is part of the name.
    expect(report.unreferenced[0].path).toBe('samples/user/nested.wav');
  });
});
