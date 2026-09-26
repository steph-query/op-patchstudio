/**
 * Where a sample can be written on each field-system device, and what has to
 * change about it first.
 *
 * Getting audio onto these devices is the friction owners complain about most
 * after transfer reliability itself: the duration caps, formats, folder
 * conventions and filename rules differ per device and are only discoverable by
 * failing. Everything here is data plus pure functions, so a plan can be shown
 * before anything is written and reused by the builders, the send flow and tests.
 *
 * Evidence for every limit is recorded in `docs/te-companion-feature-research.md`
 * and classified: `documented` comes from a teenage engineering guide,
 * `community` from consistent third-party reports. Anything unknown must widen
 * into a warning, never a silent assumption.
 */

import { sanitizeName } from './audio';
import type { TeDeviceKind } from './teDevices';

export type SampleTargetId =
  | 'op-xy-samples'
  | 'op-1-field-drum'
  | 'op-1-field-synth'
  | 'tp-7-recordings';

/** How strictly a device's filenames are constrained. */
export type NameCharset =
  /** The charset the OP family accepts for presets and samples: letters, digits, space, `#`, `-`, `(`, `)`, `.` */
  | 'te-preset'
  /** Anything a file system tolerates; keeps underscores and the TP-7's timestamp names intact. */
  | 'filesystem-safe';

export type ChannelRule = 'keep' | 'mono' | 'stereo';

export interface SampleTargetProfile {
  id: SampleTargetId;
  kind: TeDeviceKind;
  /** Lowercase label in the app's voice. */
  label: string;
  /** What the user gets out of writing here. */
  purpose: string;
  /** Folder path on the device, from the storage root. */
  destination: string[];
  /** Extensions accepted as-is, lowercase, without the dot. */
  accepted: string[];
  /** Extension everything is converted to, or null to keep the source extension. */
  outputExtension: 'wav' | 'aif' | null;
  /** Longest sample the device will play, in seconds. */
  maxSeconds: number | null;
  /** Stricter cap that applies when the result is mono, if the device has one. */
  maxSecondsMono?: number;
  /**
   * Most items the destination folder holds, when a device defines one. No shipped
   * profile sets this: none of these devices document a per-folder item limit, and
   * a limit that belongs to a *patch* is not a limit on the folder holding patches.
   */
  maxItems: number | null;
  /** Target sample rate, or null to leave the source rate alone. */
  sampleRate: number | null;
  /** Target bit depth, or null to leave the source depth alone. */
  bitDepth: number | null;
  channels: ChannelRule;
  charset: NameCharset;
  /** Whether a subfolder may be created inside the destination. */
  canCreateFolders: boolean;
  /** Whether the device reads a note name in the filename as the sample's pitch. */
  readsPitchFromName: boolean;
  evidence: 'documented' | 'community';
  /** Shown next to the target so the user knows how firm the rules are. */
  note: string;
}

const PROFILES: Record<SampleTargetId, SampleTargetProfile> = {
  'op-xy-samples': {
    id: 'op-xy-samples',
    kind: 'op-xy',
    label: 'op-xy sample library',
    purpose: 'browse and load from the sample browser, or build a kit from them on the device',
    destination: ['samples'],
    accepted: ['wav', 'aif', 'aiff'],
    outputExtension: null,
    maxSeconds: 20,
    maxItems: null,
    sampleRate: null,
    bitDepth: null,
    channels: 'keep',
    charset: 'te-preset',
    canCreateFolders: true,
    readsPitchFromName: true,
    evidence: 'documented',
    note: 'aiff and wav, up to 20 seconds each. sound packs install as a folder here.',
  },
  'op-1-field-drum': {
    id: 'op-1-field-drum',
    kind: 'op-1-field',
    label: 'op-1 field drum folder',
    purpose: 'keep a sample alongside your drum snapshots',
    destination: ['drum'],
    accepted: ['aif', 'aiff'],
    outputExtension: 'aif',
    maxSeconds: 20,
    maxSecondsMono: 12,
    // Not 24. A field drum *patch* has 24 keys; the folder holds as many patches as
    // the card fits. Counting files against 24 refused every install into a folder
    // that already held two dozen patches, with a reason that was not true.
    maxItems: null,
    sampleRate: 44100,
    bitDepth: 16,
    channels: 'keep',
    charset: 'te-preset',
    canCreateFolders: true,
    readsPitchFromName: false,
    evidence: 'community',
    note: 'each file arrives as its own file — this app does not assemble a 24-key drum patch, because the op-1 slice format is not established well enough to write. playability on your firmware is unverified.',
  },
  'op-1-field-synth': {
    id: 'op-1-field-synth',
    kind: 'op-1-field',
    label: 'op-1 field synth folder',
    purpose: 'keep a sample alongside your synth snapshots',
    destination: ['synth'],
    accepted: ['aif', 'aiff'],
    outputExtension: 'aif',
    maxSeconds: 20,
    maxSecondsMono: 12,
    maxItems: null,
    sampleRate: 44100,
    bitDepth: 16,
    channels: 'keep',
    charset: 'te-preset',
    canCreateFolders: true,
    readsPitchFromName: false,
    evidence: 'community',
    note: 'each file arrives as its own file; this app does not write op-1 patch metadata. playability on your firmware is unverified.',
  },
  'tp-7-recordings': {
    id: 'tp-7-recordings',
    kind: 'tp-7',
    label: 'tp-7 recordings folder',
    purpose: 'play back or edit a multitrack take on the recorder',
    destination: ['recordings'],
    accepted: ['wav'],
    outputExtension: null,
    maxSeconds: null,
    maxItems: null,
    sampleRate: null,
    bitDepth: null,
    channels: 'keep',
    charset: 'filesystem-safe',
    // Firmware 1.1.9 accepts uploads but rejects folder creation over MTP.
    canCreateFolders: false,
    readsPitchFromName: false,
    evidence: 'community',
    note: 'wav only, written straight into the existing recordings folder. this firmware refuses new folders over usb.',
  },
};

export function getSampleTarget(id: SampleTargetId): SampleTargetProfile {
  return PROFILES[id];
}

/** Targets a connected device can accept, in the order they should be offered. */
export function sampleTargetsForDevice(kind: TeDeviceKind | null | undefined): SampleTargetProfile[] {
  if (!kind) return [];
  return Object.values(PROFILES).filter(profile => profile.kind === kind);
}

/** Note names the OP-XY may read out of a filename as a sample's pitch. */
const NOTE_IN_NAME = /(^|[^a-z0-9])([a-g])(#|b)?(-?[0-9])([^0-9]|$)/i;

/** Path separators and reserved characters. Underscores, hyphens and spaces survive, so TP-7 timestamp names stay intact. */
const FILESYSTEM_RESERVED = /[/\\:*?"<>|]+/g;

/** Control characters are dropped by code point rather than by regex, matching the other parsers in this codebase. */
function withoutControlCharacters(text: string): string {
  return [...text].filter(character => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join('');
}

function splitExtension(name: string): { stem: string; extension: string } {
  const match = /^(.*)\.([a-z0-9]+)$/i.exec(name);
  if (!match) return { stem: name, extension: '' };
  return { stem: match[1], extension: match[2].toLowerCase() };
}

/**
 * Make a filename the device will accept, without inventing a name.
 * `te-preset` reuses the existing OP charset helper so there is one definition
 * of that rule in the codebase.
 */
export function sanitizeDeviceFileName(name: string, charset: NameCharset, outputExtension?: string | null): string {
  const { stem, extension } = splitExtension(name.trim());
  const cleanedStem = (charset === 'te-preset' ? sanitizeName(stem) : withoutControlCharacters(stem).replace(FILESYSTEM_RESERVED, ''))
    .replace(/\s+/g, ' ')
    .trim();
  const finalExtension = (outputExtension ?? extension ?? '').toLowerCase();
  const safeStem = cleanedStem || 'sample';
  return finalExtension ? `${safeStem}.${finalExtension}` : safeStem;
}

export interface SampleCandidate {
  /** Filename as it exists now, including extension. */
  name: string;
  sizeBytes: number;
  /** Omit when unknown — an unknown duration produces a warning, never a silent pass. */
  durationSeconds?: number;
  sampleRate?: number;
  bitDepth?: number;
  channels?: number;
  /**
   * Why reading this file failed, when it did.
   *
   * Without this a failed read is indistinguishable from a read that has not
   * happened yet, and the two deserve different words: "unknown until this file is
   * read" tells the user to wait, which is wrong advice for a file that cannot be
   * read at all.
   */
  unreadable?: string;
}

export interface PlannedSample {
  source: SampleCandidate;
  /** Name as it will appear on the device. */
  targetName: string;
  /** Plain-language description of each change, for example "44.1 khz". */
  conversions: string[];
  warnings: string[];
  /** Set when this file will not be written, with the reason in the user's words. */
  blocked?: string;
  /** Best estimate of the bytes this file will occupy on the device. */
  estimatedBytes: number;
}

export interface SamplePlan {
  target: SampleTargetProfile;
  /** Destination path including any subfolder, for display. */
  destinationPath: string;
  items: PlannedSample[];
  accepted: PlannedSample[];
  blocked: PlannedSample[];
  /** Estimated bytes for the accepted files only. */
  totalBytes: number;
  /** True when the plan needs a folder the device does not have yet. */
  createsFolder: boolean;
  /** Plan-level notes: slot limits, space, folder refusals. */
  notes: string[];
}

export interface PlanOptions {
  /** Filenames already present in the destination, so nothing is overwritten. */
  existingNames?: string[];
  /** Subfolder inside the destination, for pack installs. */
  subfolder?: string;
  /** Whether that subfolder already exists on the device. */
  subfolderExists?: boolean;
  /** Free space reported by the device. */
  freeSpaceBytes?: number;
  /** Items already in the destination, when the device caps them. */
  existingItemCount?: number;
}

function bytesPerSampleFor(bitDepth: number): number {
  return Math.max(1, Math.ceil(bitDepth / 8));
}

function estimateBytes(candidate: SampleCandidate, profile: SampleTargetProfile, channels: number | undefined): number {
  const rate = profile.sampleRate ?? candidate.sampleRate;
  const depth = profile.bitDepth ?? candidate.bitDepth;
  if (candidate.durationSeconds === undefined || !rate || !depth || !channels) return candidate.sizeBytes;
  return Math.round(candidate.durationSeconds * rate) * channels * bytesPerSampleFor(depth) + 44;
}

function resultingChannels(candidate: SampleCandidate, profile: SampleTargetProfile): number | undefined {
  if (profile.channels === 'mono') return 1;
  if (profile.channels === 'stereo') return 2;
  return candidate.channels;
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? `${value}` : value.toFixed(1);
}

/** One line describing what a target will do to every file, for the review UI. */
export function describeTargetFormat(profile: SampleTargetProfile): string {
  const parts: string[] = [];
  parts.push(profile.outputExtension ? `.${profile.outputExtension}` : profile.accepted.map(ext => `.${ext}`).join(' / '));
  if (profile.sampleRate) parts.push(`${(profile.sampleRate / 1000).toFixed(1)} khz`);
  if (profile.bitDepth) parts.push(`${profile.bitDepth}-bit`);
  if (profile.channels !== 'keep') parts.push(profile.channels);
  if (profile.maxSeconds !== null) {
    parts.push(profile.maxSecondsMono !== undefined
      ? `${formatSeconds(profile.maxSecondsMono)} s mono / ${formatSeconds(profile.maxSeconds)} s stereo`
      : `up to ${formatSeconds(profile.maxSeconds)} s`);
  }
  return parts.join(' · ');
}

/**
 * Work out exactly what writing these files to a target would do.
 *
 * Nothing here touches a device or the file system. Unknown metadata widens
 * into a warning so a file is never blocked on a guess, and never silently
 * accepted past a documented limit either.
 */
export function planSampleTransfer(
  candidates: SampleCandidate[],
  profile: SampleTargetProfile,
  options: PlanOptions = {},
): SamplePlan {
  const { existingNames = [], subfolder, subfolderExists = false, freeSpaceBytes, existingItemCount = 0 } = options;
  const taken = new Set(existingNames.map(name => name.toLowerCase()));
  const destinationPath = [...profile.destination, ...(subfolder ? [subfolder] : [])].join('/');
  const notes: string[] = [];
  const createsFolder = !!subfolder && !subfolderExists;

  let folderRefusal: string | null = null;
  if (createsFolder && !profile.canCreateFolders) {
    folderRefusal = `this device refuses new folders over usb, so ${subfolder} cannot be created. write into ${profile.destination.join('/')} instead.`;
    notes.push(folderRefusal);
  }

  let slotsLeft = profile.maxItems === null ? Number.POSITIVE_INFINITY : Math.max(0, profile.maxItems - existingItemCount);
  let spaceLeft = freeSpaceBytes ?? Number.POSITIVE_INFINITY;

  const items = candidates.map((candidate): PlannedSample => {
    const conversions: string[] = [];
    const warnings: string[] = [];
    const { extension } = splitExtension(candidate.name);
    const channels = resultingChannels(candidate, profile);
    const estimatedBytes = estimateBytes(candidate, profile, channels);

    const targetName = sanitizeDeviceFileName(
      candidate.name,
      profile.charset,
      profile.outputExtension ?? (extension || null),
    );
    let unique = targetName;
    const collides = taken.has(unique.toLowerCase());
    if (collides) {
      const { stem, extension: outExtension } = splitExtension(targetName);
      for (let suffix = 2; taken.has(unique.toLowerCase()); suffix++) {
        unique = outExtension ? `${stem} ${suffix}.${outExtension}` : `${stem} ${suffix}`;
      }
      // The new name is already shown beside the file as "saves as …", so this says
      // only the part that name cannot: why it changed.
      warnings.push('a file of that name is already on the device, so this one is renamed rather than replacing it');
    }
    taken.add(unique.toLowerCase());
    const { stem: sourceStem } = splitExtension(candidate.name);
    if (!collides && splitExtension(unique).stem !== sourceStem) {
      // Likewise: what changed is visible, so state the reason instead of repeating it.
      conversions.push('renamed for characters this device will not accept');
    }

    const plan = (blocked?: string): PlannedSample => ({ source: candidate, targetName: unique, conversions, warnings, blocked, estimatedBytes });

    if (folderRefusal) return plan(folderRefusal);

    if (!extension) return plan('this file has no extension, so the device cannot tell what it is.');
    if (!profile.accepted.includes(extension)) {
      if (!profile.outputExtension) {
        return plan(`${profile.label} accepts ${profile.accepted.map(ext => `.${ext}`).join(' or ')} only.`);
      }
      conversions.push(`converted to .${profile.outputExtension}`);
    }

    if (profile.sampleRate && candidate.sampleRate && candidate.sampleRate !== profile.sampleRate) {
      conversions.push(`${(profile.sampleRate / 1000).toFixed(1)} khz`);
    }
    if (profile.bitDepth && candidate.bitDepth && candidate.bitDepth !== profile.bitDepth) {
      conversions.push(`${profile.bitDepth}-bit`);
    }
    if (profile.channels !== 'keep' && candidate.channels && candidate.channels !== (profile.channels === 'mono' ? 1 : 2)) {
      conversions.push(profile.channels);
    }
    if (candidate.unreadable) {
      warnings.push(`could not be read: ${candidate.unreadable} it will be sent exactly as it is, and the instrument may not play it`);
    } else if (!candidate.sampleRate || !candidate.bitDepth || !candidate.channels) {
      warnings.push('audio details are unknown until this file is read');
    }

    if (profile.maxSeconds !== null) {
      const monoCap = profile.maxSecondsMono ?? profile.maxSeconds;
      if (candidate.durationSeconds === undefined) {
        // An unreadable file has already said why above; repeating "will be checked"
        // would promise a check that cannot happen.
        if (!candidate.unreadable) warnings.push(`length is unknown; it will be checked against the ${formatSeconds(profile.maxSeconds)} second limit before writing`);
      } else if (channels === undefined) {
        // Judge against the looser cap rather than blocking on an unknown channel count.
        if (candidate.durationSeconds > profile.maxSeconds) {
          return plan(`${formatSeconds(candidate.durationSeconds)} s is longer than the ${formatSeconds(profile.maxSeconds)} second limit. trim it first.`);
        }
        if (candidate.durationSeconds > monoCap) {
          warnings.push(`over the ${formatSeconds(monoCap)} second mono limit, so this must stay stereo`);
        }
      } else {
        const cap = channels === 1 ? monoCap : profile.maxSeconds;
        // Only call it a mono limit when this device actually has a separate one.
        const monoSpecific = channels === 1 && monoCap !== profile.maxSeconds;
        if (candidate.durationSeconds > cap) {
          return plan(`${formatSeconds(candidate.durationSeconds)} s is longer than the ${formatSeconds(cap)} second ${monoSpecific ? 'mono ' : ''}limit. trim it first.`);
        }
      }
    }

    if (profile.readsPitchFromName && NOTE_IN_NAME.test(splitExtension(unique).stem)) {
      warnings.push('this device reads the note in the filename as the sample pitch — rename it if that is not the root note');
    }

    if (slotsLeft <= 0) {
      return plan(`${profile.label} holds ${profile.maxItems} items and is full.`);
    }
    if (estimatedBytes > spaceLeft) {
      return plan('there is not enough free space on the device for this file.');
    }

    slotsLeft -= 1;
    spaceLeft -= estimatedBytes;
    return plan();
  });

  const accepted = items.filter(item => !item.blocked);
  const blocked = items.filter(item => item.blocked);
  if (profile.maxItems !== null && accepted.length + existingItemCount > 0) {
    notes.push(`${accepted.length + existingItemCount} of ${profile.maxItems} slots used after this transfer`);
  }
  if (blocked.length) {
    notes.push(`${blocked.length} of ${items.length} ${items.length === 1 ? 'file' : 'files'} will not be written`);
  }
  if (profile.evidence === 'community') {
    notes.push('these limits come from community reports, not a teenage engineering guide; check the result on the device');
  }

  return {
    target: profile,
    destinationPath,
    items,
    accepted,
    blocked,
    totalBytes: accepted.reduce((sum, item) => sum + item.estimatedBytes, 0),
    createsFolder: createsFolder && profile.canCreateFolders,
    notes,
  };
}
