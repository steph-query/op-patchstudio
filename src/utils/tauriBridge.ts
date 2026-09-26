/**
 * Tauri bridge for native MTP device access.
 * When running inside Tauri, this provides direct USB/MTP communication
 * via Rust's mtp-rs library. Falls back gracefully in browser environments.
 */

import type { TeDeviceKind } from './teDevices';
import { deviceOperation } from './deviceOperation';

export interface TauriDeviceInfo {
  manufacturer: string;
  model: string;
  serial: string;
  connected: boolean;
  firmware?: string;
  /** Device family recognised from the MTP model string. */
  kind?: TeDeviceKind;
  /** Whether the device advertises MTP rename support. */
  supports_rename?: boolean;
}

/** A device seen on USB, whether or not it is currently in MTP mode. */
export interface TauriAvailableDevice {
  /** Non-zero only when the device is reachable over MTP right now. */
  location_id: number;
  vendor_id: number;
  product_id: number;
  manufacturer: string | null;
  product: string | null;
  serial: string | null;
  kind: TeDeviceKind;
  /** "mtp" when an MTP session can be opened, "usb" when only seen on the bus (for example a TP-7 in audio mode). */
  mode: 'mtp' | 'usb';
}

export interface TauriStorageEntry {
  description: string;
  free_space: number;
  capacity: number;
}

export interface TauriFileEntry {
  handle: number;
  name: string;
  is_directory: boolean;
  size: number;
}

/** One object from a full library scan, with its path relative to the storage root. */
export interface TauriTreeEntry {
  /** Path including the root folder, for example "drum/user/kit.aif". */
  path: string;
  handle: number;
  parent_handle: number;
  is_directory: boolean;
  size: number;
  /** ISO-like timestamp reported by the device, when available. */
  modified: string | null;
}

export interface TauriTreeScan {
  entries: TauriTreeEntry[];
  /** Root folders that were requested but do not exist on the device. */
  missing_roots: string[];
  /** Actual folder names matched for each requested root (devices differ in capitalisation). */
  roots: Array<{ requested: string; actual: string; handle: number }>;
}

export interface TauriExportRequest {
  handle: number;
  /** Destination path relative to the chosen folder, for example "recordings/2026-02-23_112713_000.wav". */
  relative_path: string;
  size: number;
}

export interface TauriExportResult {
  path: string;
  copied: number;
  skipped: number;
  bytes: number;
  failed: Array<{ path: string; error: string }>;
}

export interface TauriSaveResult {
  path: string;
  files: number;
}

export interface Tp7SwitchReport {
  device_id: number;
  product: string | null;
  mode: string | null;
  os_version: string | null;
  serial: string | null;
  payload: number[];
}

/**
 * Check if the app is running inside a Tauri shell.
 */
export function isTauriAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

type InvokeOptions = { headers?: Record<string, string> };

async function invoke<T>(command: string, args?: Record<string, unknown> | Uint8Array, options?: InvokeOptions): Promise<T> {
  if (!isTauriAvailable()) {
    throw new Error('Tauri is not available');
  }
  // @ts-expect-error Tauri injects __TAURI__ at runtime
  const { invoke: tauriInvoke } = window.__TAURI__.core;
  return await deviceOperation(() => tauriInvoke(command, args, options));
}

function toBytes(result: unknown): Uint8Array {
  if (result instanceof ArrayBuffer) return new Uint8Array(result);
  if (result instanceof Uint8Array) return result;
  if (Array.isArray(result)) return new Uint8Array(result);
  throw new Error('Device returned data in an unexpected format');
}

export async function mtpListAvailable(): Promise<TauriAvailableDevice[]> {
  return invoke<TauriAvailableDevice[]>('mtp_list_available');
}

/** Open a session with an explicitly selected USB location; native code refuses an omitted location. */
export async function mtpConnect(locationId?: number): Promise<TauriDeviceInfo> {
  return invoke<TauriDeviceInfo>('mtp_connect', { locationId: locationId ?? null });
}

export async function mtpDisconnect(): Promise<void> {
  return invoke<void>('mtp_disconnect');
}

/** Ask a TP-7 in audio/MIDI mode to re-enumerate as an MTP device. */
export async function tp7SwitchToMtp(): Promise<Tp7SwitchReport> {
  return invoke<Tp7SwitchReport>('tp7_switch_to_mtp');
}

export interface BackupResult {
  path: string;
  files: number;
  bytes: number;
  firmware: string;
  kind?: string;
}

export function createDeviceBackup(): Promise<BackupResult | null> {
  return invoke<BackupResult | null>('create_backup');
}

export function verifyDeviceBackup(): Promise<BackupResult | null> {
  return invoke<BackupResult | null>('verify_backup');
}

export interface RestorePreview {
  token: string; path: string; model: string; serial: string;
  entries: Array<{ path: string; status: 'missing' | 'identical' | 'conflict'; size: number }>;
  required_bytes: number; free_bytes: number;
}

export const previewDeviceRestore = () => invoke<RestorePreview | null>('preview_restore');
export const restoreDeviceBackup = (token: string) => invoke<{ copied: number; skipped: number; bytes: number }>('restore_backup', { token });

export async function mtpListStorages(): Promise<TauriStorageEntry[]> {
  return invoke<TauriStorageEntry[]>('mtp_list_storages');
}

export async function mtpListDirectory(parentHandle?: number): Promise<TauriFileEntry[]> {
  return invoke<TauriFileEntry[]>('mtp_list_directory', {
    parentHandle: parentHandle ?? null,
  });
}

export async function mtpReadFile(handle: number): Promise<Uint8Array> {
  return toBytes(await invoke<unknown>('mtp_read_file', { handle }));
}

/** Read a byte range, used to sniff audio headers without downloading whole recordings. */
export async function mtpReadPartial(handle: number, offset: number, size: number): Promise<Uint8Array> {
  return toBytes(await invoke<unknown>('mtp_read_partial', { handle, offset, size }));
}

export async function mtpDelete(handle: number): Promise<void> {
  return invoke<void>('mtp_delete', { handle });
}

export async function mtpRename(handle: number, newName: string): Promise<void> {
  return invoke<void>('mtp_rename', { handle, newName });
}

/** Scan whole library folders; the caller interprets the tree for each device family. */
export async function mtpScanTree(roots: string[]): Promise<TauriTreeScan> {
  return invoke<TauriTreeScan>('mtp_scan_tree', { roots });
}

/**
 * Upload one file into a folder path such as ["drum", "user"].
 * Bytes travel as a raw IPC body; metadata rides in headers.
 */
export async function mtpUploadAtPath(
  path: string[],
  filename: string,
  data: Uint8Array,
  createMissing = false
): Promise<number> {
  return invoke<number>('mtp_upload_at_path', data, {
    headers: {
      'x-doxy-path': encodeURIComponent(path.join('/')),
      'x-doxy-filename': encodeURIComponent(filename),
      'x-doxy-create': createMissing ? '1' : '0',
    },
  });
}

/** Stream device files straight to a folder the user picks; never overwrites. Returns null if the picker is cancelled. */
export interface StemSummary {
  index: number;
  channels: number;
  bytes: number;
}

export interface StemExport {
  path: string;
  stems: StemSummary[];
  frames: number;
  source_channels: number;
  sample_rate: number;
  bits: number;
  is_float: boolean;
}

/**
 * Split a multichannel recording into per-track stems, streaming it straight to a
 * folder the user picks so length is limited by disk rather than memory.
 * Returns null if the folder picker is cancelled.
 */
export async function exportDeviceStems(handle: number, name: string, size: number): Promise<StemExport | null> {
  return invoke<StemExport | null>('export_device_stems', { handle, name, size });
}

export async function exportDeviceFiles(files: TauriExportRequest[]): Promise<TauriExportResult | null> {
  return invoke<TauriExportResult | null>('export_device_files', { files });
}

/** Save app-generated bytes (stems, mixdowns) into a folder the user picks. Returns null if cancelled. */
export async function saveFileToFolder(relativePath: string, data: Uint8Array, folder?: string): Promise<TauriSaveResult | null> {
  return invoke<TauriSaveResult | null>('save_file_to_folder', data, {
    headers: {
      'x-doxy-path': encodeURIComponent(relativePath),
      ...(folder ? { 'x-doxy-folder': encodeURIComponent(folder) } : {}),
    },
  });
}

/** Ask the user for a destination folder once, so several files can be saved together. */
export async function pickFolder(title: string): Promise<string | null> {
  return invoke<string | null>('pick_folder', { title });
}

// --- Local capture library (native catalog) ---

export interface CatalogOccurrence {
  source: string;
  device_model: string | null;
  device_serial: string | null;
  source_path: string;
  captured_at: string | null;
  imported_unix: number;
}

export interface CatalogRegion {
  id: string;
  name: string;
  start_frame: number;
  /** Exclusive, so end - start is the length in frames. */
  end_frame: number;
  created_unix: number;
}

export interface CatalogAsset {
  /** SHA-256 of the file's bytes; the library's identity for this audio. */
  id: string;
  stored_path: string;
  original_name: string;
  /** What the owner calls this take. Absent until they say; never replaces `original_name`. */
  label?: string | null;
  bytes: number;
  first_imported_unix: number;
  occurrences: CatalogOccurrence[];
  /** Marked spans of this take. Empty in libraries written before regions existed. */
  regions?: CatalogRegion[];
}

export interface CatalogStatus {
  path: string;
  assets: number;
  bytes: number;
  occurrences: number;
}

export interface CatalogImportRequest {
  handle: number;
  /** Path on the device, kept as provenance. */
  path: string;
  size: number;
  captured_at?: string | null;
}

export interface CatalogImportOutcome {
  source_path: string;
  /** "imported", "already in library" or "failed". */
  status: string;
  asset_id: string | null;
  error: string | null;
}

/** Open the library at the default location, or at `path` when one is remembered. */
export async function catalogOpen(path?: string): Promise<CatalogStatus> {
  return invoke<CatalogStatus>('catalog_open', { path: path ?? null });
}

/** Ask the user for a different library folder. Returns null if cancelled. */
export async function catalogChoose(): Promise<CatalogStatus | null> {
  return invoke<CatalogStatus | null>('catalog_choose');
}

export async function catalogStatus(): Promise<CatalogStatus | null> {
  return invoke<CatalogStatus | null>('catalog_status');
}

export async function catalogAssets(): Promise<CatalogAsset[]> {
  return invoke<CatalogAsset[]>('catalog_assets');
}

/** Copy the chosen device files into the library, hash-verified per file. */
export async function catalogImportFromDevice(files: CatalogImportRequest[]): Promise<CatalogImportOutcome[]> {
  return invoke<CatalogImportOutcome[]>('catalog_import_from_device', { files });
}

/**
 * Add recordings already on this Mac. Opens a file chooser; an empty result means
 * the user cancelled. Files are copied, never moved, and identified by content like
 * every other take, so one already imported from a device gains a second source
 * rather than a second copy.
 */
export async function catalogImportLocal(): Promise<CatalogImportOutcome[]> {
  return invoke<CatalogImportOutcome[]>('catalog_import_local', {});
}


export interface LocalAudioInfo {
  asset_id: string;
  sample_rate: number;
  channels: number;
  bits: number;
  is_float: boolean;
  frames: number;
  duration_seconds: number;
  audio_bytes: number;
}

export interface LocalAudioPeaks {
  version: number;
  asset_id: string;
  buckets: number;
  channels: number;
  frames: number;
  sample_rate: number;
  /** Channel-major: all buckets for channel 0, then channel 1, and so on. */
  min: number[];
  max: number[];
}

/** Header-only description of a library take; never reads its audio. */
export async function localAudioInfo(assetId: string): Promise<LocalAudioInfo> {
  return invoke<LocalAudioInfo>('local_audio_info', { assetId });
}

/** A window of frames as a playable WAV, with the source's samples untouched. */
export async function localAudioWindow(assetId: string, startFrame: number, frames: number): Promise<Uint8Array> {
  return toBytes(await invoke<unknown>('local_audio_window', { assetId, startFrame, frames }));
}

/** Min/max peaks for drawing a whole take, computed once and cached. */
export async function localAudioPeaks(assetId: string, buckets: number): Promise<LocalAudioPeaks> {
  return invoke<LocalAudioPeaks>('local_audio_peaks', { assetId, buckets });
}

/**
 * Name a take in your own library. An empty string clears the name.
 *
 * The file is not renamed on disk and nothing on any device is touched — the library is
 * content-addressed, so this writes one field beside the take's bytes.
 */
export async function catalogLabelAsset(assetId: string, label: string): Promise<CatalogAsset> {
  return invoke<CatalogAsset>('catalog_label_asset', { assetId, label });
}

/** Save a marked span. Regions are metadata; the audio is never rewritten. */
export async function catalogSaveRegion(
  assetId: string,
  region: { id?: string | null; name: string; start_frame: number; end_frame: number },
): Promise<CatalogRegion> {
  return invoke<CatalogRegion>('catalog_save_region', { assetId, region: { id: region.id ?? null, ...region } });
}

export async function catalogDeleteRegion(assetId: string, regionId: string): Promise<CatalogRegion[]> {
  return invoke<CatalogRegion[]>('catalog_delete_region', { assetId, regionId });
}

export interface TransferFile {
  path: string;
  bytes: number;
}

export interface CatalogTransfer {
  id: string;
  sent_unix: number;
  device_model: string;
  device_serial: string | null;
  destination: string;
  name: string;
  files: TransferFile[];
  /** "verified" or "failed". */
  outcome: string;
  error: string | null;
  source_asset_id: string | null;
  source_region: string | null;
}

/** Device writes this app made, newest first. */
export async function catalogTransfers(): Promise<CatalogTransfer[]> {
  return invoke<CatalogTransfer[]>('catalog_transfers');
}

/** Record what was written where, verified or failed. */
export async function catalogRecordTransfer(transfer: {
  device_model: string;
  device_serial: string | null;
  destination: string;
  name: string;
  files: TransferFile[];
  outcome: 'verified' | 'failed';
  error?: string;
  source_asset_id?: string | null;
  source_region?: string | null;
}): Promise<CatalogTransfer> {
  return invoke<CatalogTransfer>('catalog_record_transfer', { transfer });
}

// --- Preset scanning (OP-XY) ---

export interface TauriPatchJsonRegion {
  sample?: string;
  framecount?: number;
  pitch_keycenter?: number;
  hikey?: number;
  lokey?: number;
  playmode?: string;
  reverse?: boolean;
  transpose?: number;
  gain?: number;
  pan?: number;
}

export interface TauriPatchJson {
  preset_type?: string;
  name?: string;
  regions?: TauriPatchJsonRegion[];
}

export interface TauriPresetSample {
  handle: number;
  name: string;
  size: number;
  /**
   * Full device path, set by the scan for standalone library samples. Absent for
   * samples inside a preset folder, whose location is the preset's.
   */
  path?: string | null;
}


export interface TauriDevicePreset {
  id: string;
  name: string;
  category: string;
  preset_type: string;
  folder_handle: number;
  patch_json: TauriPatchJson | null;
  samples: TauriPresetSample[];
  total_size: number;
}

export interface TauriProject {
  handle: number;
  name: string;
  size: number;
}

export interface TauriScanResult {
  presets: TauriDevicePreset[];
  standalone_samples: TauriPresetSample[];
  projects: TauriProject[];
}

export async function mtpScanPresets(): Promise<TauriScanResult> {
  return invoke<TauriScanResult>('mtp_scan_presets');
}

export async function mtpCopyPreset(folderHandle: number, newName: string): Promise<number> {
  return invoke<number>('mtp_copy_preset', { folderHandle, newName });
}

export async function cancelRestorePreview(): Promise<void> {
  return invoke<void>('cancel_restore_preview');
}

export interface ReconcileFile {
  name: string;
  /** "identical", "different" or "absent". */
  status: string;
  device_bytes: number | null;
}

export interface ReconcileReport {
  destination: string;
  folder_exists: boolean;
  files: ReconcileFile[];
  /** Files in that folder this preset does not describe. */
  extra: string[];
  identical: number;
  different: number;
  absent: number;
  /** "nothing on the device", "already complete", "can complete" or "blocked". */
  verdict: string;
  explanation: string;
  /** Present only when the missing files can be written; authorises exactly that. */
  token: string | null;
}

/**
 * Compare a preset against what is actually in its folder on the device.
 * Read-only: useful after a failed or interrupted send, when the question is
 * "what is up there now?".
 */
export async function reconcilePresetSend(
  category: string,
  presetName: string,
  files: Array<{ name: string; data: Uint8Array }>,
): Promise<ReconcileReport> {
  const size = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const file of files) { body.set(file.data, offset); offset += file.data.byteLength; }
  return invoke<ReconcileReport>('reconcile_preset_send', body, { headers: {
    'x-doxy-category': encodeURIComponent(category),
    'x-doxy-preset-name': encodeURIComponent(presetName),
    'x-doxy-files': encodeURIComponent(JSON.stringify(files.map(file => ({ name: file.name, size: file.data.byteLength })))),
  } });
}

/**
 * Finish a partly written preset by adding only the files the device is missing.
 * Requires the token from a check whose verdict was "can complete", and is
 * refused if that folder changed in the meantime — nothing existing is replaced.
 */
export async function completePresetSend(
  category: string,
  presetName: string,
  files: Array<{ name: string; data: Uint8Array }>,
  token: string,
): Promise<number> {
  const size = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  const body = new Uint8Array(size);
  let offset = 0;
  for (const file of files) { body.set(file.data, offset); offset += file.data.byteLength; }
  return invoke<number>('complete_preset_send', body, { headers: {
    'x-doxy-category': encodeURIComponent(category),
    'x-doxy-preset-name': encodeURIComponent(presetName),
    'x-doxy-token': encodeURIComponent(token),
    'x-doxy-files': encodeURIComponent(JSON.stringify(files.map(file => ({ name: file.name, size: file.data.byteLength })))),
  } });
}

export interface SendPlan {
  /** Single-use approval bound to this device, session and payload. */
  token: string;
  device_model: string;
  device_serial: string;
  destination: string;
  files: number;
  bytes: number;
  free_space: number;
  /** True when the category folder does not exist yet and will be created. */
  creates_category: boolean;
}

/**
 * Check a send against the connected device without writing anything: name
 * collisions, free space, missing folders, wrong device kind. The returned token
 * is what authorises the write, and only for this device and payload.
 */
export async function preflightPresetSend(
  category: string,
  presetName: string,
  files: Array<{ name: string; data: Uint8Array }>,
): Promise<SendPlan> {
  return invoke<SendPlan>('preflight_preset_send', {
    category,
    presetName,
    files: files.map(file => ({ name: file.name, size: file.data.byteLength })),
  });
}

export async function mtpUploadPreset(
  category: string,
  presetName: string,
  files: Array<{ name: string; data: Uint8Array }>,
  token: string,
): Promise<number> {
  const size = files.reduce((sum, file) => sum + file.data.byteLength, 0);
  if (size > 128 * 1024 * 1024) throw new Error('Preset exceeds the 128 MB send limit. Export it to disk instead.');
  const body = new Uint8Array(size);
  let offset = 0;
  for (const file of files) { body.set(file.data, offset); offset += file.data.byteLength; }
  return invoke<number>('mtp_upload_preset', body, { headers: {
    'x-doxy-category': encodeURIComponent(category),
    'x-doxy-preset-name': encodeURIComponent(presetName),
    'x-doxy-files': encodeURIComponent(JSON.stringify(files.map(file => ({ name: file.name, size: file.data.byteLength })))),
    'x-doxy-token': encodeURIComponent(token),
  } });
}
