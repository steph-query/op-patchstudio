import { describe, expect, it } from 'vitest';
import { isReadableAudio } from '../../utils/teDevices';

/**
 * What the drum builder's drop targets accept.
 *
 * All four of them tested `file.type.startsWith('audio/') || name.endsWith('.wav')`.
 * A `.aif` dragged from the desktop usually arrives with an **empty** MIME type, so
 * every one of them rejected it — silently, with no message — while the rest of the
 * app reads AIFF happily and an OP-1 field's entire library is `.aif`.
 *
 * They share one predicate now. These assertions are about that predicate as the
 * drop handlers apply it, including the MIME fallback they keep for files whose
 * name says nothing useful.
 */
const accepted = (file: { name: string; type: string }) => isReadableAudio(file.name) || file.type.startsWith('audio/');

describe('files the drum builder accepts from a drop', () => {
  it('takes a field tape track with no MIME type at all', () => {
    expect(accepted({ name: 'tape track.aif', type: '' })).toBe(true);
    expect(accepted({ name: 'patch.aiff', type: '' })).toBe(true);
    // The old rule, for contrast: it looked only at the type and the .wav suffix.
    const oldRule = (f: { name: string; type: string }) => f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.wav');
    expect(oldRule({ name: 'tape track.aif', type: '' })).toBe(false);
  });

  it('still takes what it always took', () => {
    expect(accepted({ name: 'kick.wav', type: 'audio/wav' })).toBe(true);
    expect(accepted({ name: 'no mime.wav', type: '' })).toBe(true);
    // A name that says nothing, but a type that does.
    expect(accepted({ name: 'recording', type: 'audio/wav' })).toBe(true);
  });

  it('refuses what it cannot open', () => {
    expect(accepted({ name: 'notes.txt', type: 'text/plain' })).toBe(false);
    expect(accepted({ name: 'patch.json', type: 'application/json' })).toBe(false);
    // mp3 and flac are not containers this app reads, whatever the name suggests.
    expect(accepted({ name: 'bounce.mp3', type: '' })).toBe(false);
  });

  it('is the same predicate the rest of the app uses', () => {
    // Not a second opinion about what "audio" means: that divergence is what put
    // five different definitions in this codebase before.
    expect(isReadableAudio('take.aif')).toBe(true);
    expect(isReadableAudio('take.mp3')).toBe(false);
  });
});
