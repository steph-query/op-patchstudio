/**
 * Catch the documented mis-tune before it reaches the instrument.
 *
 * The OP-XY reads a sample's pitch from its WAV metadata and, failing that,
 * from a note written in the filename ("a3"). Owners have reported a file named
 * `blue strings c0` loading into the multisampler at +60.00 semitones, which is
 * indistinguishable from a broken transfer. So when a filename carries a note
 * that disagrees with the root note assigned here, say so before sending.
 *
 * Deliberately self-contained: no imports, so it stays usable from components
 * whose tests replace the audio utilities wholesale.
 */

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** A note token followed by an octave, as a trailing or separated word: "pad c3", "kick_f#2". */
const NOTE_TOKEN = /(?:^|[^a-z0-9#])([a-g])([#b]?)(-?\d{1,2})(?![0-9])/gi;

export type MidiNoteMapping = 'C3' | 'C4';

/** Note name for a MIDI value under the app's current C3/C4 convention. */
export function midiToNoteName(value: number, mapping: MidiNoteMapping): string {
  if (!Number.isFinite(value) || value < 0 || value > 127) return '';
  const octave = Math.floor(value / 12) - (mapping === 'C3' ? 2 : 1);
  return `${NOTE_NAMES[((value % 12) + 12) % 12]}${octave}`;
}

/** Compare note spellings without caring about case, spacing, or flat/sharp punctuation style. */
function normalize(note: string): string {
  return note.replace(/\s+/g, '').toUpperCase();
}

/**
 * The note a device would most likely read out of this filename, or null.
 * The last token wins, because the convention in shared packs is a trailing note.
 */
export function noteTokenInFilename(filename: string): string | null {
  const stem = filename.replace(/\.[^/.]+$/, '');
  let found: string | null = null;
  for (const match of stem.matchAll(NOTE_TOKEN)) {
    found = `${match[1].toUpperCase()}${match[2].toLowerCase() === 'b' ? 'b' : match[2]}${match[3]}`;
  }
  return found;
}

export interface PitchNameMismatch {
  name: string;
  /** Note spelled in the filename. */
  filenameNote: string;
  /** Note this app assigned as the sample's root. */
  rootNote: string;
}

/**
 * Files whose filename note disagrees with their assigned root note.
 * Files with no note in the name are not flagged: nothing contradicts anything.
 */
export function findPitchNameMismatches(
  files: Array<{ name: string; rootNote: number }>,
  mapping: MidiNoteMapping,
): PitchNameMismatch[] {
  const mismatches: PitchNameMismatch[] = [];
  for (const file of files) {
    const filenameNote = noteTokenInFilename(file.name);
    if (!filenameNote) continue;
    const rootNote = midiToNoteName(file.rootNote, mapping);
    if (!rootNote || normalize(filenameNote) === normalize(rootNote)) continue;
    mismatches.push({ name: file.name, filenameNote, rootNote });
  }
  return mismatches;
}

/** One sentence for the UI, naming the risk and the fix rather than the mechanism. */
export function describePitchNameMismatches(mismatches: PitchNameMismatch[]): string {
  if (!mismatches.length) return '';
  const examples = mismatches.slice(0, 3).map(item => `${item.name} says ${item.filenameNote}, mapped to ${item.rootNote}`);
  const rest = mismatches.length > examples.length ? ` and ${mismatches.length - examples.length} more` : '';
  // The verb and the possessive both have to follow the count: "2 files have a note
  // … that differs from its root note" reads as though the app lost track of them.
  const one = mismatches.length === 1;
  const subject = one ? 'file has' : 'files have';
  const clause = one ? 'differs from its' : 'differ from their';
  return `${mismatches.length} ${subject} a note in the filename that ${clause} root note (${examples.join('; ')}${rest}). The device reads the filename when a sample carries no pitch metadata, so rename the file or change the root note to agree.`;
}
