import { describe, it, expect } from 'vitest';
import {
  describePitchNameMismatches,
  findPitchNameMismatches,
  midiToNoteName,
  noteTokenInFilename,
} from '../../utils/pitchNaming';

describe('midiToNoteName', () => {
  it('follows the app\'s C3 and C4 conventions', () => {
    expect(midiToNoteName(60, 'C3')).toBe('C3');
    expect(midiToNoteName(60, 'C4')).toBe('C4');
    expect(midiToNoteName(61, 'C3')).toBe('C#3');
    expect(midiToNoteName(0, 'C3')).toBe('C-2');
    expect(midiToNoteName(127, 'C3')).toBe('G8');
  });

  it('returns nothing for values outside the MIDI range', () => {
    expect(midiToNoteName(-1, 'C3')).toBe('');
    expect(midiToNoteName(128, 'C3')).toBe('');
    expect(midiToNoteName(Number.NaN, 'C3')).toBe('');
  });
});

describe('noteTokenInFilename', () => {
  it('finds the note a device would read', () => {
    expect(noteTokenInFilename('blue strings c0.wav')).toBe('C0');
    expect(noteTokenInFilename('pad f#3.aif')).toBe('F#3');
    expect(noteTokenInFilename('kick_bb2.wav')).toBe('Bb2');
    expect(noteTokenInFilename('cello-a3')).toBe('A3');
  });

  it('prefers the trailing note, the convention in shared packs', () => {
    expect(noteTokenInFilename('g2 layered with c4.wav')).toBe('C4');
  });

  it('does not invent a note out of ordinary words or numbers', () => {
    expect(noteTokenInFilename('take5.wav')).toBeNull();
    expect(noteTokenInFilename('snare 024.wav')).toBeNull();
    expect(noteTokenInFilename('kick.wav')).toBeNull();
    expect(noteTokenInFilename('field recording 2026.wav')).toBeNull();
  });
});

describe('findPitchNameMismatches', () => {
  it('flags the reported case: a c0 filename mapped to something else', () => {
    const mismatches = findPitchNameMismatches([{ name: 'blue strings c0.wav', rootNote: 60 }], 'C3');
    expect(mismatches).toEqual([{ name: 'blue strings c0.wav', filenameNote: 'C0', rootNote: 'C3' }]);
  });

  it('stays quiet when the filename and the root note agree', () => {
    expect(findPitchNameMismatches([{ name: 'pad c3.wav', rootNote: 60 }], 'C3')).toEqual([]);
    expect(findPitchNameMismatches([{ name: 'pad C3.WAV', rootNote: 60 }], 'C3')).toEqual([]);
    expect(findPitchNameMismatches([{ name: 'pad c4.wav', rootNote: 60 }], 'C4')).toEqual([]);
  });

  it('respects the active mapping, so switching conventions changes the answer', () => {
    const files = [{ name: 'pad c3.wav', rootNote: 60 }];
    expect(findPitchNameMismatches(files, 'C3')).toEqual([]);
    expect(findPitchNameMismatches(files, 'C4')).toEqual([
      { name: 'pad c3.wav', filenameNote: 'C3', rootNote: 'C4' },
    ]);
  });

  it('ignores files with no note in the name', () => {
    expect(findPitchNameMismatches([{ name: 'kick.wav', rootNote: 60 }], 'C3')).toEqual([]);
  });

  it('reports every offending file', () => {
    const mismatches = findPitchNameMismatches([
      { name: 'a c0.wav', rootNote: 60 },
      { name: 'b c3.wav', rootNote: 60 },
      { name: 'c f2.wav', rootNote: 64 },
    ], 'C3');
    expect(mismatches.map(item => item.name)).toEqual(['a c0.wav', 'c f2.wav']);
  });
});

describe('describePitchNameMismatches', () => {
  it('says nothing when there is nothing to say', () => {
    expect(describePitchNameMismatches([])).toBe('');
  });

  it('names the risk, the examples and the fix', () => {
    const text = describePitchNameMismatches(findPitchNameMismatches([{ name: 'blue strings c0.wav', rootNote: 60 }], 'C3'));
    expect(text).toContain('blue strings c0.wav says C0, mapped to C3');
    expect(text).toContain('reads the filename when a sample carries no pitch metadata');
    expect(text).toContain('rename the file or change the root note');
  });

  it('summarises rather than listing twenty files', () => {
    const files = Array.from({ length: 6 }, (_, index) => ({ name: `take ${index} c0.wav`, rootNote: 60 }));
    const text = describePitchNameMismatches(findPitchNameMismatches(files, 'C3'));
    expect(text).toContain('6 files have');
    expect(text).toContain('and 3 more');
  });
});

describe('the warning reads as English at either count', () => {
  it('agrees with one mismatch and with several', () => {
    const one = describePitchNameMismatches(findPitchNameMismatches(
      [{ name: 'pad c2.wav', rootNote: 91 }],
      'C3',
    ));
    expect(one).toContain('1 file has a note in the filename that differs from its root note');

    const many = describePitchNameMismatches(findPitchNameMismatches(
      [{ name: 'pad c2.wav', rootNote: 91 }, { name: 'pad c3.wav', rootNote: 91 }],
      'C3',
    ));
    // "2 files have a note … that differs from its root note" read as though the app
    // had lost track of which file it meant.
    expect(many).toContain('2 files have a note in the filename that differ from their root note');
  });
});
