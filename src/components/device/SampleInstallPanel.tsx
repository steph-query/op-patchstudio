import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { deviceOperation } from '../../utils/deviceOperation';
import { mtpScanTree, mtpUploadAtPath, mtpScanPresets } from '../../utils/tauriBridge';
import { detectDeviceKind } from '../../utils/teDevices';
import {
  describeTargetFormat,
  planSampleTransfer,
  sampleTargetsForDevice,
} from '../../utils/sampleTargets';
import type { SampleTargetProfile } from '../../utils/sampleTargets';
import { probeSample, renderSampleForTarget } from '../../utils/samplePreparation';
import type { ProbedSample } from '../../utils/samplePreparation';
import { formatFileSize } from '../../utils/audio';
import { describeError } from '../../utils/describeError';
import type { TauriTreeEntry } from '../../utils/tauriBridge';

type RowState = 'ready' | 'sending' | 'sent' | 'failed' | 'not sent';

/**
 * Put samples from the Mac onto whichever device is connected.
 *
 * The panel never writes anything the user has not seen first: files are probed,
 * planned against the connected device's documented limits, and only then sent
 * through the verified upload path that refuses to replace existing content.
 */
export function SampleInstallPanel() {
  const { state, dispatch } = useAppContext();
  const kind = state.tauriDevice ? state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model) : null;
  const targets = useMemo(() => sampleTargetsForDevice(kind), [kind]);
  const [targetId, setTargetId] = useState<string | null>(null);
  const [probes, setProbes] = useState<ProbedSample[]>([]);
  const [reading, setReading] = useState(0);
  const [subfolder, setSubfolder] = useState('');
  /**
   * The destination folder as last read from the device. Null until it has been read.
   *
   * Held raw and filtered below rather than filtered on the way in, because the scan
   * depends only on the destination while the *filtering* depends on the subfolder the
   * user is typing. Re-reading per keystroke meant a full MTP scan of `samples/` for
   * every character, each one freezing the whole workspace through the busy overlay.
   */
  const [scanned, setScanned] = useState<TauriTreeEntry[] | null>(null);
  const [inventoryProblem, setInventoryProblem] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<number, RowState>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const sending = useRef(false);

  const target: SampleTargetProfile | null = targets.find(item => item.id === targetId) ?? targets[0] ?? null;

  // Read what is already in the destination so the plan can rename instead of colliding.
  // Deliberately not keyed on `subfolder`: the scan reads the same bytes whatever the
  // user types, so typing a folder name must not re-read the device.
  useEffect(() => {
    if (!target) return;
    let current = true;
    setScanned(null);
    setInventoryProblem(null);
    void deviceOperation(
      () => mtpScanTree([target.destination[0]]),
      { message: `Reading ${target.destination[0]}/ on the device so the plan can tell you about name collisions before anything is written.` },
    )
      .then(scan => { if (current) setScanned(scan.entries); })
      .catch(problem => {
        if (!current) return;
        setScanned([]);
        setInventoryProblem(`Could not list ${target.destination.join('/')} on the device (${describeError(problem)}). The device still refuses to replace existing files.`);
      });
    return () => { current = false; };
  }, [target, state.tauriDevice]);

  // Filtering is pure and cheap, so it follows the subfolder field keystroke by
  // keystroke without touching the device.
  const { existingNames, existingCount, existingFolders } = useMemo(() => {
    if (!target || scanned === null) return { existingNames: null as string[] | null, existingCount: 0, existingFolders: [] as string[] };
    const root = target.destination.join('/').toLowerCase();
    const prefix = [...target.destination, ...(subfolder.trim() ? [subfolder.trim()] : [])].join('/').toLowerCase();
    const directChildren = scanned.filter(entry => {
      const path = entry.path.toLowerCase();
      return path.startsWith(prefix + '/') && !path.slice(prefix.length + 1).includes('/');
    });
    const files = directChildren.filter(entry => !entry.is_directory);
    return {
      existingNames: files.map(entry => entry.path.split('/').pop() ?? ''),
      existingCount: files.length,
      existingFolders: scanned
        .filter(entry => entry.is_directory && entry.path.toLowerCase().startsWith(root + '/') && !entry.path.toLowerCase().slice(root.length + 1).includes('/'))
        .map(entry => (entry.path.split('/').pop() ?? '').toLowerCase()),
    };
  }, [scanned, subfolder, target]);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setSummary(null);
    setError(null);
    setReading(count => count + files.length);
    for (const file of files) {
      const probe = await probeSample(file);
      setProbes(current => [...current, probe]);
      setReading(count => count - 1);
    }
  }, []);

  const plan = useMemo(() => {
    if (!target) return null;
    return planSampleTransfer(probes.map(probe => probe.candidate), target, {
      existingNames: existingNames ?? [],
      subfolder: subfolder.trim() || undefined,
      subfolderExists: existingFolders.includes(subfolder.trim().toLowerCase()),
      freeSpaceBytes: state.tauriStorageInfo?.freeSpace,
      existingItemCount: existingCount,
    });
  }, [probes, target, existingNames, subfolder, existingCount, existingFolders, state.tauriStorageInfo]);

  const send = useCallback(async () => {
    if (!plan || !target || sending.current || !plan.accepted.length) return;
    sending.current = true;
    setError(null);
    setSummary(null);
    const path = [...target.destination, ...(subfolder.trim() ? [subfolder.trim()] : [])];
    let sent = 0;
    let stoppedAt: string | null = null;
    try {
      await deviceOperation(async () => {
        for (const [index, item] of plan.items.entries()) {
          if (item.blocked) continue;
          const probe = probes[index];
          if (!probe) continue;
          if (stoppedAt) { setRowStates(current => ({ ...current, [index]: 'not sent' })); continue; }
          setRowStates(current => ({ ...current, [index]: 'sending' }));
          try {
            const rendered = await renderSampleForTarget(probe, target, item.targetName);
            await mtpUploadAtPath(path, rendered.name, rendered.bytes, plan.createsFolder);
            sent++;
            setRowStates(current => ({ ...current, [index]: 'sent' }));
          } catch (problem) {
            stoppedAt = `${item.source.name}: ${describeError(problem)}`;
            setRowStates(current => ({ ...current, [index]: 'failed' }));
          }
        }
      }, { message: `Writing samples to ${target.label}. Keep the device connected.` });
      if (kind === 'op-xy' && sent > 0) {
        const scan = await deviceOperation(() => mtpScanPresets(), { message: 'Refreshing the library so it shows the samples that were just written. The transfer is already finished and verified.' });
        dispatch({ type: 'SET_TAURI_PRESETS', payload: scan.presets });
        dispatch({ type: 'SET_TAURI_SAMPLES', payload: scan.standalone_samples });
      }
      if (stoppedAt) {
        setError(`Stopped after ${sent} of ${plan.accepted.length}. ${stoppedAt} Nothing already on the device was changed; check the device before retrying.`);
      } else {
        setSummary(`${sent} ${sent === 1 ? 'sample' : 'samples'} written to ${path.join('/')} and verified on the device.`);
      }
    } finally {
      sending.current = false;
    }
  }, [plan, target, subfolder, probes, kind, dispatch]);

  if (!state.tauriDevice || !target) {
    return <div className="device-media"><p className="project-muted">Connect a device to install samples on it.</p></div>;
  }

  const accepted = plan?.accepted.length ?? 0;

  return <div className="device-media install-panel"
    onDragOver={event => { event.preventDefault(); setDragging(true); }}
    onDragLeave={() => setDragging(false)}
    onDrop={event => {
      event.preventDefault();
      setDragging(false);
      void addFiles(Array.from(event.dataTransfer.files));
    }}>
    <header className="device-media-hero">
      <div>
        <span>to {state.tauriDevice.model.toLowerCase()}</span>
        <h2>Install samples</h2>
        <p>{target.purpose}</p>
      </div>
      <button className="media-primary" disabled={!accepted || !!reading} onClick={() => void send()}>
        send {accepted ? accepted : ''} {accepted === 1 ? 'sample' : 'samples'}
      </button>
    </header>

    <div className="media-toolbar">
      {targets.length > 1 && <label>Destination
        <select aria-label="Destination folder" value={target.id} onChange={event => { setTargetId(event.target.value); setRowStates({}); }}>
          {targets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>}
      {target.canCreateFolders && <label>Folder (optional)
        <input aria-label="Subfolder name" type="text" value={subfolder} placeholder="e.g. field kicks"
          onChange={event => setSubfolder(event.target.value)} />
      </label>}
      <button onClick={() => fileInput.current?.click()}>Choose files…</button>
      <input ref={fileInput} type="file" multiple hidden accept=".wav,.aif,.aiff,audio/*"
        onChange={event => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {probes.length > 0 && <button onClick={() => { setProbes([]); setRowStates({}); setSummary(null); setError(null); }}>Clear</button>}
    </div>

    <p className="install-target" role="status">
      <code>{plan?.destinationPath}</code> · {describeTargetFormat(target)} · {target.note}
    </p>

    {reading > 0 && <p className="media-feedback" role="status">Reading {reading} {reading === 1 ? 'file' : 'files'}…</p>}
    {inventoryProblem && <p className="media-feedback" role="status">{inventoryProblem}</p>}
    {plan?.notes.map(note => <p key={note} className="media-feedback">{note}</p>)}
    {summary && <p className="media-feedback" role="status">{summary}</p>}
    {error && <p className="project-error" role="alert">{error}</p>}

    {!probes.length && <div className={'install-drop' + (dragging ? ' is-dragging' : '')}>
      <p>Drop audio files here, or choose files, to put them on your {target.label.replace(/^op-xy |^op-1 field |^tp-7 /, '')}.</p>
      <p className="project-muted">Nothing is written until you review the plan and press send. Files already on the device are never replaced.</p>
    </div>}

    {plan && plan.items.length > 0 && <div className="install-rows">
      {plan.items.map((item, index) => {
        const status = rowStates[index] ?? (item.blocked ? 'blocked' : 'ready');
        return <div className={'media-row install-row status-' + status} key={index}>
          <div className="media-name">
            <strong>{item.source.name}</strong>
            {!item.blocked && item.targetName !== item.source.name && <small>saves as {item.targetName}</small>}
            {item.conversions.length > 0 && <small>{item.conversions.join(' · ')}</small>}
            {item.warnings.map(warning => <small key={warning} className="install-warning">{warning}</small>)}
            {item.blocked && <small className="install-blocked">{item.blocked}</small>}
          </div>
          <code>{formatFileSize(item.estimatedBytes)}</code>
          <span className="install-status">{item.blocked ? 'skipped' : status}</span>
        </div>;
      })}
    </div>}
  </div>;
}
