import { describe, it, expect } from 'vitest';
import { needsConversion, probeSample, renderSampleForTarget } from '../../utils/samplePreparation';
import { getSampleTarget } from '../../utils/sampleTargets';
import { encodeWav } from '../../utils/wavDecode';

const opxy = getSampleTarget('op-xy-samples');
const fieldDrum = getSampleTarget('op-1-field-drum');

/** A real 16-bit mono 44.1 kHz WAV, so no resampling or channel conversion is needed. */
function wavFile(name = 'kick.wav', frames = 1000): File {
  const tone = new Float32Array(frames);
  for (let index = 0; index < frames; index++) tone[index] = Math.sin(index / 8) * 0.5;
  const bytes = encodeWav([tone], 44100, { bitDepth: 16 });
  return new File([bytes], name, { type: 'audio/wav' });
}

describe('probeSample', () => {
  it('reports what it observed and leaves the rest undefined', async () => {
    const probe = await probeSample(wavFile());
    expect(probe.candidate.name).toBe('kick.wav');
    expect(probe.candidate.sizeBytes).toBeGreaterThan(44);
    expect(probe.candidate.sampleRate).toBe(44100);
    expect(probe.candidate.channels).toBe(1);
    expect(probe.candidate.bitDepth).toBe(16);
    expect(probe.candidate.durationSeconds).toBeGreaterThan(0);
  });

  it('returns a usable candidate even when the file cannot be read as audio', async () => {
    const probe = await probeSample(new File([new Uint8Array([1, 2, 3])], 'broken.wav'));
    expect(probe.candidate.name).toBe('broken.wav');
    expect(probe.candidate.sizeBytes).toBe(3);
    expect(probe.audioBuffer).toBeNull();
    expect(probe.problem).toBeTruthy();
  });

  /**
   * `problem` had no reader anywhere, so the reason a file could not be read was
   * thrown away and the install plan saw only a candidate with no metadata — which
   * it described as "unknown until this file is read", advice that cannot help for a
   * file that has already failed to read.
   */
  it('carries the reason onto the candidate, so the plan can say it', async () => {
    const probe = await probeSample(new File([new Uint8Array([1, 2, 3])], 'broken.wav'));
    expect(probe.candidate.unreadable).toBe(probe.problem);
    expect(probe.candidate.unreadable).toBeTruthy();
  });

  it('says it once, rather than stacking a prefix per layer', async () => {
    // Three layers each wrapped the one below and a broken file produced
    // "Failed to read audio metadata: Failed to read audio metadata: Failed to read
    // WAV metadata: Unknown error."
    const probe = await probeSample(new File([new Uint8Array([1, 2, 3])], 'broken.wav'));
    const message = probe.problem ?? '';
    expect(message.match(/failed to read/gi) ?? []).toHaveLength(1);
    expect(message).not.toContain('Unknown error');
  });
});

describe('needsConversion', () => {
  it('leaves a matching wav alone for the OP-XY sample library', async () => {
    expect(needsConversion(await probeSample(wavFile()), opxy)).toBe(false);
  });

  it('converts for the field drum folder, which wants .aif', async () => {
    expect(needsConversion(await probeSample(wavFile()), fieldDrum)).toBe(true);
  });

  it('converts when the target rate or depth differs', async () => {
    const probe = await probeSample(wavFile());
    expect(needsConversion({ ...probe, candidate: { ...probe.candidate, sampleRate: 48000 } }, fieldDrum)).toBe(true);
    expect(needsConversion({ ...probe, candidate: { ...probe.candidate, bitDepth: 24 } }, fieldDrum)).toBe(true);
  });
});

describe('renderSampleForTarget', () => {
  it('passes original bytes through untouched when nothing needs to change', async () => {
    const file = wavFile();
    const source = new Uint8Array(await file.arrayBuffer());
    const rendered = await renderSampleForTarget(await probeSample(file), opxy, 'kick.wav');
    expect(rendered.original).toBe(true);
    expect(rendered.name).toBe('kick.wav');
    expect(Array.from(rendered.bytes)).toEqual(Array.from(source));
  });

  it('writes an AIFF for the field, labeled as derived', async () => {
    const rendered = await renderSampleForTarget(await probeSample(wavFile()), fieldDrum, 'kick.aif');
    expect(rendered.original).toBe(false);
    expect(rendered.name).toBe('kick.aif');
    expect(String.fromCharCode(...rendered.bytes.slice(0, 4))).toBe('FORM');
    expect(String.fromCharCode(...rendered.bytes.slice(8, 12))).toBe('AIFF');
  });

  it('refuses in plain language when conversion is needed but the audio is unreadable', async () => {
    const probe = await probeSample(new File([new Uint8Array([1, 2, 3])], 'broken.wav'));
    await expect(renderSampleForTarget(probe, fieldDrum, 'broken.aif')).rejects.toThrow(/could not be read on this Mac/);
  });
});
