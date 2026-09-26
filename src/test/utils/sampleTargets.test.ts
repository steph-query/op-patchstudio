import { describe, it, expect } from 'vitest';
import {
  describeTargetFormat,
  getSampleTarget,
  planSampleTransfer,
  sampleTargetsForDevice,
  sanitizeDeviceFileName,
} from '../../utils/sampleTargets';
import type { SampleCandidate } from '../../utils/sampleTargets';

const opxy = getSampleTarget('op-xy-samples');
const fieldDrum = getSampleTarget('op-1-field-drum');
const tp7 = getSampleTarget('tp-7-recordings');

function candidate(name: string, overrides: Partial<SampleCandidate> = {}): SampleCandidate {
  return { name, sizeBytes: 100_000, ...overrides };
}

describe('sampleTargetsForDevice', () => {
  it('offers only the targets a connected device accepts', () => {
    expect(sampleTargetsForDevice('op-xy').map(target => target.id)).toEqual(['op-xy-samples']);
    expect(sampleTargetsForDevice('op-1-field').map(target => target.id)).toEqual(['op-1-field-drum', 'op-1-field-synth']);
    expect(sampleTargetsForDevice('tp-7').map(target => target.id)).toEqual(['tp-7-recordings']);
    expect(sampleTargetsForDevice(null)).toEqual([]);
    expect(sampleTargetsForDevice('unknown')).toEqual([]);
  });
});

describe('sanitizeDeviceFileName', () => {
  it('strips characters the OP charset rejects and keeps the extension', () => {
    expect(sanitizeDeviceFileName('kick★/loud.wav', 'te-preset', 'wav')).toBe('kickloud.wav');
    expect(sanitizeDeviceFileName('  deep   bass .WAV', 'te-preset', 'wav')).toBe('deep bass.wav');
    expect(sanitizeDeviceFileName('kit (2) #3.aif', 'te-preset', 'aif')).toBe('kit (2) #3.aif');
  });

  it('keeps underscores and hyphens for recorder filenames', () => {
    expect(sanitizeDeviceFileName('2026-02-23_112713_000.wav', 'filesystem-safe', 'wav')).toBe('2026-02-23_112713_000.wav');
    expect(sanitizeDeviceFileName('take:1?.wav', 'filesystem-safe', 'wav')).toBe('take1.wav');
  });

  it('never returns an empty name and can force a new extension', () => {
    expect(sanitizeDeviceFileName('★★.wav', 'te-preset', 'wav')).toBe('sample.wav');
    expect(sanitizeDeviceFileName('loop.mp3', 'te-preset', 'aif')).toBe('loop.aif');
  });
});

describe('planSampleTransfer — OP-XY sample library', () => {
  it('accepts a sample inside the documented 20 second limit and blocks one past it', () => {
    const plan = planSampleTransfer(
      [candidate('short.wav', { durationSeconds: 19.5 }), candidate('long.wav', { durationSeconds: 21 })],
      opxy,
    );
    expect(plan.accepted.map(item => item.targetName)).toEqual(['short.wav']);
    expect(plan.blocked[0].blocked).toContain('20 second limit');
    expect(plan.destinationPath).toBe('samples');
    expect(plan.notes).toContain('1 of 2 files will not be written');
  });

  it('warns rather than blocks when the length is unknown', () => {
    const plan = planSampleTransfer([candidate('unknown.wav')], opxy);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.accepted[0].warnings.join(' ')).toContain('length is unknown');
  });

  it('refuses a format the target cannot convert', () => {
    const plan = planSampleTransfer([candidate('loop.mp3', { durationSeconds: 2 })], opxy);
    expect(plan.blocked[0].blocked).toContain('.wav or .aif or .aiff');
  });

  it('renames instead of overwriting existing device files', () => {
    const plan = planSampleTransfer(
      [candidate('kick.wav', { durationSeconds: 1 }), candidate('kick.wav', { durationSeconds: 1 })],
      opxy,
      { existingNames: ['Kick.wav'] },
    );
    expect(plan.accepted.map(item => item.targetName)).toEqual(['kick 2.wav', 'kick 3.wav']);
    // The new name is shown beside the file already; the warning carries the reason,
    // not a second copy of the name.
    expect(plan.accepted[0].warnings[0]).toBe('a file of that name is already on the device, so this one is renamed rather than replacing it');
    expect(plan.accepted[0].warnings[0]).not.toContain('kick 2.wav');
  });

  it('gives the reason for a rename rather than restating the new name', () => {
    // Both lines used to read "renamed to tombadname.wav", once beside "saves as
    // tombadname.wav" — three statements of one fact on the screen someone reads
    // before writing to their instrument.
    const plan = planSampleTransfer([candidate('tom?bad:name.wav', { durationSeconds: 1 })], opxy);
    expect(plan.accepted[0].targetName).toBe('tombadname.wav');
    expect(plan.accepted[0].conversions).toContain('renamed for characters this device will not accept');
    expect(plan.accepted[0].conversions.join(' ')).not.toContain('tombadname.wav');
  });

  it('warns when a filename contains a note the device would read as the pitch', () => {
    const plan = planSampleTransfer(
      [candidate('blue strings c0.wav', { durationSeconds: 3 }), candidate('kick.wav', { durationSeconds: 1 })],
      opxy,
    );
    expect(plan.items[0].warnings.join(' ')).toContain('reads the note in the filename');
    expect(plan.items[1].warnings.join(' ')).not.toContain('reads the note');
  });

  it('blocks files that no longer fit in the reported free space', () => {
    const plan = planSampleTransfer(
      [candidate('a.wav', { sizeBytes: 800 }), candidate('b.wav', { sizeBytes: 800 })],
      opxy,
      { freeSpaceBytes: 1000 },
    );
    expect(plan.accepted.map(item => item.targetName)).toEqual(['a.wav']);
    expect(plan.blocked[0].blocked).toContain('not enough free space');
    expect(plan.totalBytes).toBe(800);
  });
});

describe('planSampleTransfer — OP-1 field drum folder', () => {
  it('applies the mono limit only when the result is mono', () => {
    const mono = planSampleTransfer([candidate('hit.aif', { durationSeconds: 15, channels: 1 })], fieldDrum);
    expect(mono.blocked[0].blocked).toContain('12 second mono limit');

    const stereo = planSampleTransfer([candidate('hit.aif', { durationSeconds: 15, channels: 2 })], fieldDrum);
    expect(stereo.accepted).toHaveLength(1);
  });

  it('warns instead of blocking when the channel count is unknown', () => {
    const plan = planSampleTransfer([candidate('hit.aif', { durationSeconds: 15 })], fieldDrum);
    expect(plan.accepted).toHaveLength(1);
    expect(plan.accepted[0].warnings.join(' ')).toContain('over the 12 second mono limit');
  });

  it('lists the conversions a wav source needs in plain language', () => {
    const plan = planSampleTransfer(
      [candidate('snare.wav', { durationSeconds: 1, sampleRate: 48000, bitDepth: 24, channels: 2 })],
      fieldDrum,
    );
    const [item] = plan.accepted;
    expect(item.targetName).toBe('snare.aif');
    expect(item.conversions).toContain('converted to .aif');
    expect(item.conversions).toContain('44.1 khz');
    expect(item.conversions).toContain('16-bit');
  });

  it('does not limit how many patches a field folder holds', () => {
    // 24 is the number of keys in a drum *patch*. The folder holds as many patches as
    // the card fits, so counting files against 24 refused every install into a folder
    // that already held two dozen — for a reason that was not true.
    const plan = planSampleTransfer(
      [candidate('a.aif', { durationSeconds: 1 }), candidate('b.aif', { durationSeconds: 1 }), candidate('c.aif', { durationSeconds: 1 })],
      fieldDrum,
      { existingItemCount: 23 },
    );
    expect(plan.accepted).toHaveLength(3);
    expect(plan.blocked).toEqual([]);
    expect(plan.notes.join(' ')).not.toContain('slots used');
  });

  it('is plain that each file arrives as a file, not as an assembled patch', () => {
    // The purpose used to read "load as a drum patch", which a bare .aif cannot be:
    // it carries none of the op-1 slice metadata that makes a file a 24-key kit.
    expect(fieldDrum.purpose).not.toContain('load as a drum patch');
    expect(fieldDrum.note).toContain('each file arrives as its own file');
    expect(fieldDrum.note).toContain('does not assemble a 24-key drum patch');
  });

  it('still enforces a slot count for a profile that has one', () => {
    // The mechanism is kept for a device limit that is actually established; this
    // exercises it without asserting a false fact about real hardware.
    const limited = { ...fieldDrum, maxItems: 2 };
    const plan = planSampleTransfer(
      [candidate('a.aif', { durationSeconds: 1 }), candidate('b.aif', { durationSeconds: 1 })],
      limited,
      { existingItemCount: 1 },
    );
    expect(plan.accepted).toHaveLength(1);
    expect(plan.blocked[0].blocked).toContain('holds 2 items and is full');
    expect(plan.notes).toContain('2 of 2 slots used after this transfer');
  });

  it('marks community-sourced limits so the user knows to verify on the device', () => {
    const plan = planSampleTransfer([candidate('a.aif', { durationSeconds: 1 })], fieldDrum);
    expect(plan.notes.join(' ')).toContain('community reports');
  });
});

describe('planSampleTransfer — TP-7 recordings folder', () => {
  it('writes timestamp names unchanged into the existing folder', () => {
    const plan = planSampleTransfer([candidate('2026-02-23_112713_000.wav')], tp7);
    expect(plan.accepted[0].targetName).toBe('2026-02-23_112713_000.wav');
    expect(plan.accepted[0].conversions).toEqual([]);
    expect(plan.destinationPath).toBe('recordings');
  });

  it('refuses the whole plan when it would need a folder this firmware rejects', () => {
    const plan = planSampleTransfer([candidate('take.wav')], tp7, { subfolder: 'session 4' });
    expect(plan.accepted).toHaveLength(0);
    expect(plan.blocked[0].blocked).toContain('refuses new folders over usb');
    expect(plan.createsFolder).toBe(false);
    expect(plan.destinationPath).toBe('recordings/session 4');
  });

  it('accepts a subfolder that already exists', () => {
    const plan = planSampleTransfer([candidate('take.wav')], tp7, { subfolder: 'memo', subfolderExists: true });
    expect(plan.accepted).toHaveLength(1);
  });

  it('accepts wav only', () => {
    const plan = planSampleTransfer([candidate('take.aif')], tp7);
    expect(plan.blocked[0].blocked).toContain('.wav only');
  });
});

describe('describeTargetFormat', () => {
  it('states what every file will become', () => {
    expect(describeTargetFormat(opxy)).toBe('.wav / .aif / .aiff · up to 20 s');
    expect(describeTargetFormat(fieldDrum)).toBe('.aif · 44.1 khz · 16-bit · 12 s mono / 20 s stereo');
    expect(describeTargetFormat(tp7)).toBe('.wav');
  });
});

describe('planSampleTransfer — edge cases', () => {
  it('handles an empty selection without inventing notes', () => {
    const plan = planSampleTransfer([], opxy);
    expect(plan.items).toEqual([]);
    expect(plan.totalBytes).toBe(0);
    expect(plan.notes).toEqual([]);
  });

  it('blocks a file with no extension rather than guessing', () => {
    const plan = planSampleTransfer([candidate('mystery')], opxy);
    expect(plan.blocked[0].blocked).toContain('no extension');
  });
});
