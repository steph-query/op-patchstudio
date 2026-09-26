/**
 * Turn a file on the Mac into the bytes a device will accept.
 *
 * Pairs with `sampleTargets.ts`: that module decides what has to change, this
 * one performs it using the exporters the sample builders already use. When
 * nothing needs to change the original bytes are passed through untouched,
 * because an unnecessary re-encode is a quiet quality loss.
 */

import { readAudioMetadata } from './audioFormats';
import { audioBufferToWav } from './wavExport';
import { audioBufferToAiff } from './aiffExport';
import type { SampleCandidate, SampleTargetProfile } from './sampleTargets';
import { describeError } from './describeError';

export interface ProbedSample {
  file: File;
  /** What the planner needs to decide, with unknown fields left undefined. */
  candidate: SampleCandidate;
  /** Decoded audio, or null when this Mac could not decode the file. */
  audioBuffer: AudioBuffer | null;
  /** Set when metadata could not be read at all. */
  problem?: string;
}

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name.trim());
  return match ? match[1].toLowerCase() : '';
}

/**
 * Read what we can about a file without asserting anything we did not observe.
 * A file that cannot be decoded still produces a candidate so the planner can
 * report it honestly rather than dropping it silently.
 */
export async function probeSample(file: File): Promise<ProbedSample> {
  const base: SampleCandidate = { name: file.name, sizeBytes: file.size };
  try {
    const metadata = await readAudioMetadata(file);
    return {
      file,
      audioBuffer: metadata.audioBuffer ?? null,
      candidate: {
        ...base,
        durationSeconds: metadata.duration > 0 ? metadata.duration : undefined,
        sampleRate: metadata.sampleRate || undefined,
        bitDepth: metadata.bitDepth || undefined,
        channels: metadata.channels || undefined,
      },
    };
  } catch (error) {
    // The reason travels on the candidate as well as the probe: the probe's own
    // `problem` field had no reader, so a failed read reached the plan as silence.
    const problem = describeError(error);
    return { file, audioBuffer: null, candidate: { ...base, unreadable: problem }, problem };
  }
}

/** True when the file can be written exactly as it is. */
export function needsConversion(probe: ProbedSample, profile: SampleTargetProfile): boolean {
  const extension = extensionOf(probe.file.name);
  if (!profile.accepted.includes(extension)) return true;
  if (profile.sampleRate !== null && probe.candidate.sampleRate !== profile.sampleRate) return true;
  if (profile.bitDepth !== null && probe.candidate.bitDepth !== profile.bitDepth) return true;
  if (profile.channels !== 'keep') {
    const wanted = profile.channels === 'mono' ? 1 : 2;
    if (probe.candidate.channels !== wanted) return true;
  }
  return false;
}

export interface RenderedSample {
  name: string;
  bytes: Uint8Array;
  /** True when these are the file's original bytes. */
  original: boolean;
}

/**
 * Produce the bytes to upload under `targetName`, converting only when the
 * target requires it. Throws in the user's words when conversion is needed but
 * the audio could not be decoded.
 */
export async function renderSampleForTarget(
  probe: ProbedSample,
  profile: SampleTargetProfile,
  targetName: string,
): Promise<RenderedSample> {
  if (!needsConversion(probe, profile)) {
    return { name: targetName, bytes: new Uint8Array(await probe.file.arrayBuffer()), original: true };
  }
  if (!probe.audioBuffer) {
    throw new Error(`${probe.file.name} needs converting for this device, but its audio could not be read on this Mac. Convert it yourself and try again.`);
  }
  const channels = profile.channels === 'keep' ? undefined : profile.channels === 'mono' ? 1 : 2;
  const sampleRate = profile.sampleRate ?? undefined;
  const bitDepth = profile.bitDepth ?? 16;
  const blob = profile.outputExtension === 'aif'
    ? await audioBufferToAiff(probe.audioBuffer, { bitDepth, sampleRate, channels })
    : await audioBufferToWav(probe.audioBuffer, bitDepth, { sampleRate, channels });
  return { name: targetName, bytes: new Uint8Array(await blob.arrayBuffer()), original: false };
}
