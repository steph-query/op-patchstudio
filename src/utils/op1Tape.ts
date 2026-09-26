/**
 * Assemble audio into an OP-1 field tape set.
 *
 * The field's tape folder holds four tracks as `track_1.aif` … `track_4.aif`,
 * which is what makes building one from finished audio possible at all. What is
 * *not* established is the tape length limit, the `tape.json` slice-marker
 * schema, or whether writing these files over USB is safe — a tape is a
 * recording the user made, and replacing one is destructive. So this module
 * plans and exports to a folder on the Mac, and deliberately offers no device
 * write. Evidence for each rule is recorded in `docs/te-companion-feature-research.md`.
 */

import { isReadableAudio } from './teDevices';

export const TAPE_TRACKS = 4;
/** Format the field's tape tracks use. Community-sourced, not a vendor guide. */
export const TAPE_SAMPLE_RATE = 44100;
export const TAPE_BIT_DEPTH = 16;
export const TAPE_CHANNELS = 2;
/** Length the original OP-1's tape held per track. Treated as a warning, never a refusal. */
export const TAPE_MINUTES_HINT = 6;

export interface TapeCandidate {
  name: string;
  /** Omit when unknown; an unknown value warns rather than blocks. */
  durationSeconds?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
}

export interface PlannedTapeTrack {
  /** 1-based track number, matching the file name on the device. */
  track: number;
  fileName: string;
  source: TapeCandidate | null;
  conversions: string[];
  warnings: string[];
  blocked?: string;
}

export interface TapePlan {
  tracks: PlannedTapeTrack[];
  /** Tracks that will actually be written. */
  used: PlannedTapeTrack[];
  blocked: PlannedTapeTrack[];
  /** Longest source, which is how long the assembled tape plays. */
  longestSeconds: number;
  notes: string[];
}


export function tapeTrackName(track: number): string {
  return `track_${track}.aif`;
}

/**
 * Decide what each track becomes. Nothing is read or written here: the plan is
 * shown first so every conversion is visible before a file is produced.
 */
export function planTape(candidates: TapeCandidate[]): TapePlan {
  const tracks: PlannedTapeTrack[] = [];
  const overflow = candidates.slice(TAPE_TRACKS);

  for (let index = 0; index < TAPE_TRACKS; index++) {
    const source = candidates[index] ?? null;
    const conversions: string[] = [];
    const warnings: string[] = [];
    let blocked: string | undefined;

    if (source) {
      if (!isReadableAudio(source.name)) {
        blocked = 'This is not an audio file this app can read.';
      } else {
        if (source.sampleRate && source.sampleRate !== TAPE_SAMPLE_RATE) conversions.push('44.1 khz');
        if (source.bitDepth && source.bitDepth !== TAPE_BIT_DEPTH) conversions.push('16-bit');
        if (source.channels && source.channels !== TAPE_CHANNELS) conversions.push(source.channels === 1 ? 'mono to stereo' : 'stereo');
        if (!/\.aif{1,2}$/i.test(source.name)) conversions.push('converted to .aif');
        if (!source.sampleRate || !source.bitDepth || !source.channels) warnings.push('audio details are unknown until this file is read');
        if (source.durationSeconds === undefined) {
          warnings.push('length is unknown until this file is read');
        } else if (source.durationSeconds > TAPE_MINUTES_HINT * 60) {
          warnings.push(`${(source.durationSeconds / 60).toFixed(1)} minutes is longer than the ${TAPE_MINUTES_HINT} minutes an OP-1 tape held; the device may truncate it`);
        }
      }
    }

    tracks.push({ track: index + 1, fileName: tapeTrackName(index + 1), source, conversions, warnings, blocked });
  }

  const used = tracks.filter(track => track.source && !track.blocked);
  const blocked = tracks.filter(track => track.blocked);
  const longestSeconds = used.reduce((longest, track) => Math.max(longest, track.source?.durationSeconds ?? 0), 0);

  const notes: string[] = [];
  if (overflow.length) {
    notes.push(`A tape has ${TAPE_TRACKS} tracks, so ${overflow.map(item => item.name).join(', ')} ${overflow.length === 1 ? 'was' : 'were'} left out.`);
  }
  if (used.length) {
    notes.push(`Every track becomes 44.1 khz, 16-bit stereo .aif — the format the field's tape tracks use. Tracks you leave empty are not written, so anything already in those slots on the device stays.`);
    notes.push('These files are written to a folder on your Mac. Copy them into the device’s tape folder yourself: replacing a tape is destructive and the format is not vendor-documented, so this app will not do it over USB.');
    notes.push('Slice markers are not produced, because the tape.json schema is unverified. The tape will play; it will not show segments.');
  }
  if (blocked.length) {
    notes.push(`${blocked.length} ${blocked.length === 1 ? 'file' : 'files'} will not be written.`);
  }
  return { tracks, used, blocked, longestSeconds, notes };
}

/** One line describing the tape, for the review UI. */
export function describeTape(plan: TapePlan): string {
  if (!plan.used.length) return 'Add one to four audio files to build a tape.';
  const minutes = Math.floor(plan.longestSeconds / 60);
  const seconds = Math.round(plan.longestSeconds % 60);
  const length = plan.longestSeconds > 0 ? `${minutes}:${String(seconds).padStart(2, '0')}` : 'unknown length';
  return `${plan.used.length} of ${TAPE_TRACKS} tracks · ${length} · 44.1 khz · 16-bit · stereo`;
}
