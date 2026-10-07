/**
 * Teenage Engineering device knowledge shared by the whole app.
 *
 * Everything here is data: which device kinds exist, how they are recognised
 * from their MTP identity, which library folders they expose, and how a user
 * puts each one into transfer mode. Components read these profiles instead of
 * hard-coding OP-XY assumptions.
 */

export type TeDeviceKind = 'op-xy' | 'op-1-field' | 'tp-7' | 'unknown';

export type DeviceTab = 'drum' | 'multisample' | 'takes' | 'songs' | 'library' | 'tapes' | 'recordings' | 'install' | 'storage' | 'projects';

export interface FirmwareSnapshot {
  /** Latest release we researched, not a live check. */
  latest: string;
  released: string;
  checked: string;
  url: string;
  notes: string;
}

export interface DeviceProfile {
  kind: TeDeviceKind;
  /** Lowercase display name in TE style. */
  label: string;
  /** Root folders that make up the user's library on the device. */
  roots: string[];
  /**
   * The folders that hold recordings — the long audio a take library is for.
   * A subset of `roots`: a Field's `drum` and `synth` folders are patches, not
   * takes, and offering to copy a whole patch library into a recordings library
   * is not a feature. Empty when the device has no recordings of its own.
   */
  captureRoots: string[];
  /** Tabs shown while this device is connected, in order. */
  tabs: DeviceTab[];
  /** Noun used in the connection bar for the primary content count. */
  contentNoun: string;
  /** How the user reaches MTP mode on the hardware. */
  transferHint: string;
  /** Whether the device can be switched into MTP mode from the app over MIDI. */
  canSwitchOverMidi: boolean;
  /** Where "send to device" places a generated drum kit, if supported. */
  drumUploadPath: string[] | null;
  firmware: FirmwareSnapshot | null;
}

/** USB vendor id assigned to teenage engineering. */
export const TE_USB_VENDOR_ID = 0x2367;

/** Product ids observed on hardware. The TP-7 id comes from a published CoreMIDI/USB capture. */
export const TE_USB_PRODUCT_IDS: Partial<Record<number, TeDeviceKind>> = {
  0x0019: 'tp-7',
};

const PROFILES: Record<TeDeviceKind, DeviceProfile> = {
  'op-xy': {
    kind: 'op-xy',
    label: 'op-xy',
    roots: ['projects', 'presets', 'samples'],
    // The OP-XY records into its own sample folder rather than a tape.
    captureRoots: ['samples'],
    tabs: ['drum', 'multisample', 'takes', 'songs', 'library', 'install', 'storage', 'projects'],
    contentNoun: 'presets',
    transferHint: 'com › m4 (labelled t4 on some firmware)',
    canSwitchOverMidi: false,
    drumUploadPath: ['presets', 'drum'],
    firmware: {
      latest: '1.1.33',
      released: 'September 2, 2026',
      checked: 'September 4, 2026',
      url: 'https://teenage.engineering/downloads/op-xy',
      notes: 'OS 1.1.15 introduced deeper folders, UTF-8 transfers, project templates and 16 patterns per track. 1.1.18 fixed sample loss when saving to the same preset snapshot; 1.1.25 improved multisample transpose and project duplication.',
    },
  },
  'op-1-field': {
    kind: 'op-1-field',
    label: 'op-1 field',
    roots: ['drum', 'synth', 'tape', 'album'],
    // Tape tracks and album sides are the recordings; drum and synth are patches.
    captureRoots: ['tape', 'album'],
    tabs: ['drum', 'multisample', 'takes', 'songs', 'library', 'tapes', 'install', 'storage'],
    contentNoun: 'patches',
    transferHint: 'shift + com › t4 (disk mode: shift + com › shift + t4)',
    canSwitchOverMidi: false,
    drumUploadPath: null,
    firmware: {
      latest: '1.7.3',
      released: 'May 26, 2026',
      checked: 'September 5, 2026',
      url: 'https://teenage.engineering/downloads/op-1/field',
      notes: '1.7.0 added tape undo, expanded MIDI control and reorganised system settings. 1.7.3 fixed rare freezes, factory resets, preset handling and sample editing issues.',
    },
  },
  'tp-7': {
    kind: 'tp-7',
    label: 'tp-7',
    roots: ['recordings', 'memo'],
    // Everything a TP-7 holds is a recording.
    captureRoots: ['recordings', 'memo'],
    tabs: ['drum', 'multisample', 'takes', 'songs', 'recordings', 'install', 'storage'],
    contentNoun: 'recordings',
    transferHint: 'stop recording, then use prepare tp-7 with exactly one tp-7 connected, or hold ■ while powering on over usb',
    canSwitchOverMidi: true,
    drumUploadPath: null,
    firmware: {
      latest: '1.1.11',
      released: 'December 23, 2025',
      checked: 'September 5, 2026',
      url: 'https://teenage.engineering/downloads/tp-7',
      notes: '1.1.9 added mp3 support and mixdown mode with TX-6. 1.1.10 enabled reel, rocker and reverse playback in mixdown mode. 1.1.11 added the TE USB audio driver for Windows.',
    },
  },
  unknown: {
    kind: 'unknown',
    label: 'mtp device',
    roots: [],
    captureRoots: [],
    tabs: ['drum', 'multisample', 'takes', 'songs', 'storage'],
    contentNoun: 'files',
    transferHint: 'put the device in mtp mode',
    canSwitchOverMidi: false,
    drumUploadPath: null,
    firmware: null,
  },
};

export function getDeviceProfile(kind: TeDeviceKind | null | undefined): DeviceProfile {
  return PROFILES[kind ?? 'unknown'] ?? PROFILES.unknown;
}

/**
 * Recognise a device from the strings it reports over MTP or USB.
 * Model strings seen in the wild: "OP-XY", "OP-1 field", "TP-7 MTP Device".
 */
export function detectDeviceKind(model: string | null | undefined, productId?: number | null): TeDeviceKind {
  const text = (model ?? '').toLowerCase().replace(/[–—]/g, '-');
  // Split on anything that is not a letter or digit, rather than using `\b`: a regex
  // word boundary treats `_` as part of a word, so `OP_XY` would not have matched —
  // and the native classifier, which splits on non-alphanumerics, would have called
  // the same device an OP-XY. Vendors are inconsistent enough with punctuation that
  // the en-dash normalisation above already exists for this reason.
  const words = text.split(/[^\p{L}\p{N}]+/u);
  if (text.includes('op-xy') || text.includes('opxy') || words.includes('xy')) return 'op-xy';
  if (text.includes('tp-7') || text.includes('tp7')) return 'tp-7';
  if ((text.includes('op-1') || text.includes('op1')) && text.includes('field')) return 'op-1-field';
  if (productId !== undefined && productId !== null) {
    const byId = TE_USB_PRODUCT_IDS[productId];
    if (byId) return byId;
  }
  return 'unknown';
}

/** Tabs available when nothing is connected: the builders plus the local library and offline project inspector. */
export const OFFLINE_TABS: DeviceTab[] = ['drum', 'multisample', 'takes', 'songs', 'library', 'projects'];

/** The two halves of the app, in the order they are shown. */
export interface TabGroup {
  key: 'device' | 'workbench';
  /** Section heading. The device half is named after what is actually plugged in. */
  label: string;
  tabs: DeviceTab[];
}

/**
 * Screens that act on the attached instrument, most-browsed first.
 *
 * `library` is here only for an OP-1 field, where it shows the patches on the device;
 * for every other device it is the local preset library and belongs to the workbench.
 * `projects` reads `.xy` files off the device when one is connected, and is a viewer for
 * a file you drop on it when none is.
 */
const DEVICE_ORDER: DeviceTab[] = ['recordings', 'tapes', 'library', 'projects', 'install', 'storage'];

/** Screens that work with nothing plugged in. Takes leads: it is the cross-device hub. */
const WORKBENCH_ORDER: DeviceTab[] = ['songs', 'takes', 'drum', 'multisample', 'library', 'projects'];

function isDeviceScoped(tab: DeviceTab, kind: TeDeviceKind | null | undefined): boolean {
  if (!kind) return false;
  if (tab === 'library') return kind === 'op-1-field';
  return !OFFLINE_TABS.includes(tab) || tab === 'projects';
}

/**
 * The navigation, split into the device half and the always-available half.
 *
 * **This is the one ordering in the app.** `tabsForDevice` flattens it, `⌘1`–`⌘9` number
 * it, and the sidebar renders it, so the number on a screen is always the number that
 * reaches it — `shortcuts.e2e.ts` asserts exactly that against the rendered DOM.
 *
 * The device half comes first when something is attached, because that is what you came
 * to do; with nothing plugged in it is empty and the workbench leads. That is also why
 * the grouping is computed rather than stored per profile: a tab's half depends on
 * whether a device is present, not only on which device it is.
 */
export function tabGroups(kind: TeDeviceKind | null | undefined): TabGroup[] {
  const available = kind ? getDeviceProfile(kind).tabs : OFFLINE_TABS;
  const inOrder = (order: DeviceTab[], want: boolean) =>
    order.filter(tab => available.includes(tab) && isDeviceScoped(tab, kind) === want);
  const groups: TabGroup[] = [];
  const device = inOrder(DEVICE_ORDER, true);
  if (device.length) groups.push({ key: 'device', label: kind ? getDeviceProfile(kind).label : 'device', tabs: device });
  groups.push({ key: 'workbench', label: 'workbench', tabs: inOrder(WORKBENCH_ORDER, false) });
  return groups;
}

export function tabsForDevice(kind: TeDeviceKind | null | undefined): DeviceTab[] {
  return tabGroups(kind).flatMap(group => group.tabs);
}

/**
 * The audio containers this app can actually open, as a pattern so callers can
 * both test names and strip the extension.
 *
 * Matches `is_audio_file` in `src-tauri/src/main.rs` and the two containers
 * `parse_audio_header` reads. It is deliberately narrow: listing an mp3 as a
 * recording offers the user a file that cannot be auditioned, previewed or
 * sliced, which is a dead end dressed as a feature. Recognising a *patch* is a
 * different, stricter question — see `isOp1PatchFile`.
 */
export const READABLE_AUDIO = /\.(wav|aif|aiff)$/i;

/** Whether this app can read the audio in a file with this name. */
export function isReadableAudio(name: string): boolean {
  return READABLE_AUDIO.test(name);
}

/**
 * Where a scanned library sample actually lives on the device.
 *
 * The scan reports this; guessing it is how `samples/user/user/kick.wav` and
 * folders that do not exist end up in reports the user acts on. `name` is already
 * relative to `samples/`, so the fallback adds only that root.
 */
export function deviceSamplePath(sample: { name: string; path?: string | null }): string {
  return sample.path ?? `samples/${sample.name}`;
}

/**
 * Whether a device path is inside one of the device's recording folders.
 *
 * Path comparison is case-insensitive and folder-boundary aware: `tape/track1.aif`
 * matches `tape`, and a folder called `tapes-old` does not.
 */
export function isCapturePath(kind: TeDeviceKind | null | undefined, path: string): boolean {
  if (!kind) return false;
  const lower = path.toLowerCase().replace(/^\/+/, '');
  return getDeviceProfile(kind).captureRoots.some(root => {
    const prefix = root.toLowerCase();
    return lower === prefix || lower.startsWith(prefix + '/');
  });
}

/** Human label for a tab; the OP-1 field library holds patches rather than presets. */
export function tabLabel(tab: DeviceTab, kind: TeDeviceKind | null | undefined): string {
  if (kind && kind !== 'op-xy' && (tab === 'drum' || tab === 'multisample')) return `${tab} (op-xy)`;
  if (tab === 'library' && kind === 'op-1-field') return 'patches';
  return tab;
}

/**
 * Pick a tab when the connected device changes and the current one disappears.
 *
 * **Staying put is the default.** In a studio with all three instruments the cable moves
 * constantly, and five tabs — the two builders, takes, library and the project inspector
 * — need no device at all. Disconnecting used to jump unconditionally to `library`, so
 * unplugging a TP-7 to reach for an OP-XY threw you out of the kit you were building.
 *
 * When the current tab genuinely does not exist on the new device, land somewhere related
 * rather than somewhere fixed: a recorder's tabs map to your own recordings, and the
 * device-management tabs map to the library.
 */
export function resolveTabForDevice(current: DeviceTab, kind: TeDeviceKind | null | undefined): DeviceTab {
  const tabs = tabsForDevice(kind);
  if (tabs.includes(current)) return current;
  if (kind === 'tp-7') return 'recordings';
  const nearest: Partial<Record<DeviceTab, DeviceTab>> = {
    // You were working with recordings on the device; work with your own copies.
    recordings: 'takes',
    tapes: 'takes',
    // You were managing what is on the device; the library is the offline counterpart.
    install: 'library',
    storage: 'library',
  };
  const related = nearest[current];
  if (related && tabs.includes(related)) return related;
  if (kind) return tabs.includes('library') ? 'library' : tabs[0];
  return 'drum';
}
