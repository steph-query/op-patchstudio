import { useCallback, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { deviceOperation } from '../utils/deviceOperation';
import { catalogRecordTransfer, completePresetSend, mtpScanPresets, mtpUploadPreset, preflightPresetSend, reconcilePresetSend } from '../utils/tauriBridge';
import type { ReconcileReport, SendPlan } from '../utils/tauriBridge';
import { detectDeviceKind } from '../utils/teDevices';
import { describeError } from '../utils/describeError';

/**
 * Shown while the app re-reads the device library after a write.
 *
 * It says the transfer is already finished, because it is: the write was verified before
 * this runs, and the rescan only updates what this app displays. Without that the user
 * sat through a generic "Working…" immediately after a successful send, with no way to
 * tell whether the thing they cared about had happened.
 */
const REFRESHING_LIBRARY = { message: 'Refreshing the library so it shows what is now on the device. The transfer is already finished and verified — nothing is at risk here.' };

export interface SendFile {
  name: string;
  data: Uint8Array;
}

export interface PendingSend {
  /** Preset folder name as it will appear on the device. */
  name: string;
  /** Category folder under `presets/`. */
  category: string;
  files: SendFile[];
  /** Plain-language summary of the audio format being written. */
  format: string;
  deviceModel: string;
  deviceSerial: string | null;
  totalBytes: number;
  /** Device-checked facts from the preflight, and the token that authorises the write. */
  plan: SendPlan;
}

/**
 * One review, one confirmation, one recorded outcome for a device write.
 *
 * The builders used to upload the moment their send button was pressed. Now they
 * describe the write, the user sees exactly what will land where and confirms
 * once, and the result — verified or failed — is written to the library's
 * transfer history so a sound on the instrument can be traced back later. The
 * safety properties of the upload itself are unchanged: it still refuses to
 * replace existing content and still reads back what it wrote.
 */
export function useConfirmedSend() {
  const { state, dispatch } = useAppContext();
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [sending, setSending] = useState(false);
  const [reconciliation, setReconciliation] = useState<ReconcileReport | null>(null);
  const [checking, setChecking] = useState(false);

  const notify = useCallback((type: 'success' | 'error', title: string, message: string) => {
    dispatch({ type: 'ADD_NOTIFICATION', payload: { id: crypto.randomUUID(), type, title, message } });
  }, [dispatch]);

  /** Build the review. Nothing is written until confirm() is called. */
  const request = useCallback((build: () => Promise<Omit<PendingSend, 'deviceModel' | 'deviceSerial' | 'totalBytes' | 'plan'>>) => {
    const device = state.tauriDevice;
    if (!device || detectDeviceKind(device.model) !== 'op-xy') {
      notify('error', 'no op-xy connected', 'Connect an OP-XY in transfer mode to send a preset to it.');
      return;
    }
    void (async () => {
      try {
        setReconciliation(null);
        const described = await build();
        if (!described.files.length) {
          notify('error', 'nothing to send', 'This preset has no files to write.');
          return;
        }
        // Ask the device before showing anything: collisions, space and folders are its answer, not a guess.
        const plan = await preflightPresetSend(described.category, described.name, described.files);
        setPending({
          ...described,
          deviceModel: plan.device_model,
          deviceSerial: plan.device_serial || (device.serial ?? null),
          totalBytes: plan.bytes,
          plan,
        });
      } catch (error) {
        notify('error', 'could not prepare that send', describeError(error));
      }
    })();
  }, [state.tauriDevice, notify]);

  const cancel = useCallback(() => { setPending(null); setReconciliation(null); }, []);

  /**
   * After a failure, ask the device what is actually in that folder. Read-only:
   * an interrupted send leaves a partial folder that blocks a retry, and this is
   * how the user finds out what it holds without a file manager.
   */
  const check = useCallback(async () => {
    if (!pending || checking) return;
    setChecking(true);
    try {
      setReconciliation(await deviceOperation(
        () => reconcilePresetSend(pending.category, pending.name, pending.files),
        { message: `Reading ${pending.name}.preset back from the device and comparing every file. Nothing is being written.` },
      ));
    } catch (error) {
      notify('error', 'could not check the device', describeError(error));
    } finally {
      setChecking(false);
    }
  }, [pending, checking, notify]);

  /**
   * Write only the files the check found missing, into the folder that is already
   * there. This is the one way a partly written preset is finished without
   * renaming it: a retry under the same name is still refused outright, because
   * completing is only safe for the files the device does not have.
   */
  const complete = useCallback(async () => {
    const token = reconciliation?.token;
    if (!pending || sending || !token) return;
    setSending(true);
    const destination = `presets/${pending.category}`;
    const missing = pending.files.filter(file => reconciliation.files.some(entry => entry.name === file.name && entry.status === 'absent'));
    try {
      const written = await deviceOperation(
        () => completePresetSend(pending.category, pending.name, pending.files, token),
        { message: `Adding the missing files to ${destination}/${pending.name}.preset. Keep the device connected.` },
      );
      // Announced before the rescan, because the verified write is the news and the
      // rescan only refreshes this app's own view of the device. Reporting success
      // afterwards meant an unexplained "Working…" between the two — and if the rescan
      // failed, a completed transfer was reported as a failure.
      notify('success', 'completed and verified', `${written} ${written === 1 ? 'file' : 'files'} added, so ${pending.name} is now whole in ${destination}. On the device: instrument → shift + [track] → ${pending.name}.`);
      const scan = await deviceOperation(() => mtpScanPresets(), REFRESHING_LIBRARY);
      dispatch({ type: 'SET_TAURI_PRESETS', payload: scan.presets });
      dispatch({ type: 'SET_TAURI_SAMPLES', payload: scan.standalone_samples });
      await catalogRecordTransfer({
        device_model: pending.deviceModel,
        device_serial: pending.deviceSerial,
        destination,
        name: pending.name,
        files: missing.map(file => ({ path: file.name, bytes: file.data.length })),
        outcome: 'verified',
      }).catch(() => { /* history is a record, not a gate on a write that already succeeded */ });
      setReconciliation(null);
      setPending(null);
    } catch (error) {
      const message = describeError(error);
      notify('error', 'could not complete that preset', `${message} Nothing already on the device was replaced.`);
      // The approval was single-use: whatever happened, that report can no longer authorise a write.
      setReconciliation(null);
    } finally {
      setSending(false);
    }
  }, [pending, sending, reconciliation, dispatch, notify]);

  /** Perform the reviewed write, then record its outcome either way. */
  const confirm = useCallback(async () => {
    if (!pending || sending) return;
    setSending(true);
    const destination = `presets/${pending.category}`;
    const files = pending.files.map(file => ({ path: file.name, bytes: file.data.length }));
    try {
      await deviceOperation(
        () => mtpUploadPreset(pending.category, pending.name, pending.files, pending.plan.token),
        { message: `Writing ${pending.name} to ${destination}. Keep the device connected.` },
      );
      notify('success', 'sent and verified', `${pending.name} is in ${destination}. On the device: instrument → shift + [track] → ${pending.name}.`);
      const scan = await deviceOperation(() => mtpScanPresets(), REFRESHING_LIBRARY);
      dispatch({ type: 'SET_TAURI_PRESETS', payload: scan.presets });
      dispatch({ type: 'SET_TAURI_SAMPLES', payload: scan.standalone_samples });
      await catalogRecordTransfer({
        device_model: pending.deviceModel,
        device_serial: pending.deviceSerial,
        destination,
        name: pending.name,
        files,
        outcome: 'verified',
      }).catch(() => { /* history is a record, not a gate on the write that already succeeded */ });
      setReconciliation(null);
      setPending(null);
    } catch (error) {
      const message = describeError(error);
      notify('error', 'send failed', `${message} Nothing already on the device was replaced.`);
      await catalogRecordTransfer({
        device_model: pending.deviceModel,
        device_serial: pending.deviceSerial,
        destination,
        name: pending.name,
        files,
        outcome: 'failed',
        error: message,
      }).catch(() => { /* never turn a failed write into a second failure */ });
    } finally {
      setSending(false);
    }
  }, [pending, sending, dispatch, notify]);

  return { pending, sending, request, confirm, cancel, reconciliation, checking, check, complete };
}
