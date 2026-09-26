import { describe, it, expect } from 'vitest';
import { describeTape, planTape, TAPE_MINUTES_HINT, tapeTrackName } from '../../utils/op1Tape';
import type { TapeCandidate } from '../../utils/op1Tape';

function candidate(name: string, overrides: Partial<TapeCandidate> = {}): TapeCandidate {
  return { name, durationSeconds: 60, sampleRate: 44100, bitDepth: 16, channels: 2, ...overrides };
}

describe('tapeTrackName', () => {
  it('uses the names the device expects', () => {
    expect(tapeTrackName(1)).toBe('track_1.aif');
    expect(tapeTrackName(4)).toBe('track_4.aif');
  });
});

describe('planTape', () => {
  it('assigns files to tracks in order and leaves the rest empty', () => {
    const plan = planTape([candidate('drums.aif'), candidate('bass.aif')]);
    expect(plan.tracks).toHaveLength(4);
    expect(plan.tracks.map(track => track.source?.name ?? null)).toEqual(['drums.aif', 'bass.aif', null, null]);
    expect(plan.used).toHaveLength(2);
    expect(plan.used.map(track => track.fileName)).toEqual(['track_1.aif', 'track_2.aif']);
  });

  it('says so when more than four files are offered, rather than dropping them silently', () => {
    const plan = planTape(['a', 'b', 'c', 'd', 'e', 'f'].map(name => candidate(`${name}.aif`)));
    expect(plan.used).toHaveLength(4);
    expect(plan.notes.join(' ')).toContain('e.aif, f.aif were left out');
  });

  it('lists the conversions each source needs in plain language', () => {
    const plan = planTape([candidate('loop.wav', { sampleRate: 48000, bitDepth: 24, channels: 1 })]);
    const [track] = plan.used;
    expect(track.conversions).toContain('44.1 khz');
    expect(track.conversions).toContain('16-bit');
    expect(track.conversions).toContain('mono to stereo');
    expect(track.conversions).toContain('converted to .aif');
  });

  it('asks for no conversion when a source already matches', () => {
    const plan = planTape([candidate('ready.aif')]);
    expect(plan.used[0].conversions).toEqual([]);
  });

  it('warns about unknown metadata instead of assuming it', () => {
    const plan = planTape([{ name: 'mystery.wav' }]);
    const [track] = plan.used;
    expect(track.blocked).toBeUndefined();
    expect(track.warnings.join(' ')).toContain('audio details are unknown');
    expect(track.warnings.join(' ')).toContain('length is unknown');
  });

  it('warns rather than refuses when a source runs past the length an OP-1 tape held', () => {
    const plan = planTape([candidate('long set.aif', { durationSeconds: (TAPE_MINUTES_HINT + 4) * 60 })]);
    expect(plan.used).toHaveLength(1);
    expect(plan.used[0].warnings.join(' ')).toContain('may truncate it');
  });

  it('refuses a file that is not audio', () => {
    const plan = planTape([candidate('notes.txt'), candidate('drums.aif')]);
    expect(plan.blocked).toHaveLength(1);
    expect(plan.blocked[0].blocked).toContain('not an audio file');
    expect(plan.used.map(track => track.source?.name)).toEqual(['drums.aif']);
    expect(plan.notes.join(' ')).toContain('1 file will not be written');
  });

  it('reports the tape length as its longest track', () => {
    const plan = planTape([candidate('a.aif', { durationSeconds: 30 }), candidate('b.aif', { durationSeconds: 95 })]);
    expect(plan.longestSeconds).toBe(95);
  });

  it('states every limit of what it produces, and that it will not write over USB', () => {
    const notes = planTape([candidate('drums.aif')]).notes.join(' ');
    expect(notes).toContain('44.1 khz, 16-bit stereo .aif');
    expect(notes).toContain('Tracks you leave empty are not written');
    expect(notes).toContain('will not do it over USB');
    expect(notes).toContain('Slice markers are not produced');
  });

  it('plans nothing from nothing', () => {
    const plan = planTape([]);
    expect(plan.used).toEqual([]);
    expect(plan.blocked).toEqual([]);
    expect(plan.longestSeconds).toBe(0);
    expect(plan.notes).toEqual([]);
  });
});

describe('describeTape', () => {
  it('invites a first file when empty', () => {
    expect(describeTape(planTape([]))).toContain('Add one to four audio files');
  });

  it('summarises the tape that will be produced', () => {
    const summary = describeTape(planTape([candidate('a.aif', { durationSeconds: 95 }), candidate('b.aif', { durationSeconds: 30 })]));
    expect(summary).toBe('2 of 4 tracks · 1:35 · 44.1 khz · 16-bit · stereo');
  });

  it('says the length is unknown rather than showing 0:00', () => {
    expect(describeTape(planTape([{ name: 'mystery.aif' }]))).toContain('unknown length');
  });
});

describe('planTape — what it will accept', () => {
  it('refuses a container the app cannot read, and means what it says', () => {
    // The refusal reads "not an audio file this app can read", which was untrue
    // while mp3, flac, m4a and ogg were accepted here: nothing downstream can
    // decode them, so the track would have been planned and then failed.
    const plan = planTape([
      { name: 'bounce.wav', durationSeconds: 60, sampleRate: 44100, bitDepth: 16, channels: 2 },
      { name: 'mixdown.mp3', durationSeconds: 60 },
      { name: 'stem.flac', durationSeconds: 60 },
      { name: 'voice.m4a', durationSeconds: 60 },
    ]);
    expect(plan.used.map(track => track.source?.name)).toEqual(['bounce.wav']);
    expect(plan.blocked.map(track => track.source?.name)).toEqual(['mixdown.mp3', 'stem.flac', 'voice.m4a']);
    for (const track of plan.blocked) {
      expect(track.blocked).toBe('This is not an audio file this app can read.');
    }
    expect(plan.notes.some(note => note.includes('3 files will not be written'))).toBe(true);
  });

  it('accepts both spellings of aiff and says nothing about converting them', () => {
    const plan = planTape([
      { name: 'side.aif', durationSeconds: 10, sampleRate: 44100, bitDepth: 16, channels: 2 },
      { name: 'side.aiff', durationSeconds: 10, sampleRate: 44100, bitDepth: 16, channels: 2 },
    ]);
    expect(plan.blocked).toEqual([]);
    expect(plan.used.every(track => track.conversions.length === 0)).toBe(true);
  });

  it('says a wav becomes an aif, because on a tape it must', () => {
    const plan = planTape([{ name: 'bounce.wav', durationSeconds: 10, sampleRate: 44100, bitDepth: 16, channels: 2 }]);
    expect(plan.used[0].conversions).toEqual(['converted to .aif']);
  });
});
