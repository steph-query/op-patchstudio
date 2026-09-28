import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { deviceOperation } from '../../utils/deviceOperation';
import {
  catalogAssets,
  catalogChoose,
  catalogImportFromDevice,
  catalogImportLocal,
  catalogLabelAsset,
  catalogOpen,
  catalogTransfers,
} from '../../utils/tauriBridge';
import type { CatalogAsset, CatalogImportOutcome, CatalogStatus, CatalogTransfer } from '../../utils/tauriBridge';
import { detectDeviceKind, getDeviceProfile } from '../../utils/teDevices';
import { importCandidates, knownOrigins } from '../../utils/takeOrigins';
import { formatFileSize } from '../../utils/audio';
import { TakeAudition } from './TakeAudition';
import '../device/device-media.css';
import { describeError, shortenHomePath } from '../../utils/describeError';
import { takeName } from '../../utils/takeOrigins';

function formatImported(unix: number): string {
  if (!unix) return '—';
  const date = new Date(unix * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The local library of imported takes: usable with nothing plugged in, and the
 * place recordings land so they outlive the cable. Importing copies originals and
 * never replaces anything; identical audio becomes another occurrence.
 */
export function CaptureLibraryPanel() {
  const { state } = useAppContext();
  const kind = state.tauriDevice ? state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model) : null;
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [assets, setAssets] = useState<CatalogAsset[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [outcomes, setOutcomes] = useState<CatalogImportOutcome[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<CatalogTransfer[]>([]);
  const [focused, setFocused] = useState(0);
  const rows = useRef<Array<HTMLDivElement | null>>([]);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    const opened = await catalogOpen();
    setStatus(opened);
    setAssets(await catalogAssets());
    // History is a record of past writes; its absence must never block the library.
    setTransfers(await catalogTransfers().catch(() => []));
  }, []);

  // First run opens the default location with no dialog, per the experience contract.
  useEffect(() => {
    let live = true;
    refresh().catch(error => { if (live) setProblem(describeError(error)); });
    return () => { live = false; };
  }, [refresh]);

  /**
   * Which take is being renamed inline, and the text so far.
   *
   * Renaming is the default act here, not an exception: a TP-7 hands you
   * `2026-09-27_224345_000` and nothing else, so every take worth keeping gets named.
   * It used to require selecting a take and finding the field inside the audition panel;
   * clicking the name is the shortest path to the thing you were always going to do.
   *
   * This writes a *label*. The bytes, the file name and the path are untouched, and
   * nothing on the instrument is renamed — the recorder still lists its own name, and
   * re-importing the same audio is still recognized as a duplicate.
   */
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [renameProblem, setRenameProblem] = useState<string | null>(null);

  const commitRename = useCallback(async () => {
    if (!renaming) return;
    const { id, text } = renaming;
    // Blur fires on the way to Escape and on an unchanged name; neither is a write.
    const asset = assets.find(item => item.id === id);
    if (!asset || text.trim() === (asset.label ?? '').trim()) { setRenaming(null); return; }
    try {
      const updated = await catalogLabelAsset(id, text.trim());
      setAssets(current => current.map(item => item.id === updated.id ? updated : item));
      setRenaming(null);
      setRenameProblem(null);
    } catch (error) {
      // Keep the field open with the text intact: retyping a rejected name is the
      // irritating part, not being told it was rejected.
      setRenameProblem(describeError(error));
    }
  }, [renaming, assets]);

  const knownSources = useMemo(() => knownOrigins(assets), [assets]);
  const candidates = useMemo(
    () => (kind ? importCandidates(
      { kind, serial: state.tauriDevice?.serial ?? null, samples: state.tauriSamples, treeEntries: state.tauriTreeEntries },
      knownSources,
    ) : []),
    [kind, state.tauriDevice?.serial, state.tauriSamples, state.tauriTreeEntries, knownSources],
  );
  const captureFolders = kind ? getDeviceProfile(kind).captureRoots : [];
  const looksIn = captureFolders.length
    ? captureFolders.map(folder => folder + '/').join(' and ')
    : null;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assets;
    return assets.filter(asset =>
      asset.original_name.toLowerCase().includes(needle) ||
      (asset.label ?? '').toLowerCase().includes(needle) ||
      asset.occurrences.some(item => item.source_path.toLowerCase().includes(needle) || (item.device_model ?? '').toLowerCase().includes(needle)));
  }, [assets, query]);

  useEffect(() => {
    setFocused(current => Math.max(0, Math.min(current, visible.length - 1)));
  }, [visible.length]);

  const selectedAsset = useMemo(() => assets.find(asset => asset.id === selected) ?? null, [assets, selected]);

  /** Arrow keys walk the list, space or enter opens a take for audition. */
  const moveFocus = useCallback((event: React.KeyboardEvent, index: number) => {
    const last = visible.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = Math.min(last, index + 1);
    else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const asset = visible[index];
      if (asset) setSelected(current => (current === asset.id ? null : asset.id));
      return;
    }
    if (next === null) return;
    event.preventDefault();
    setFocused(next);
    rows.current[next]?.focus();
  }, [visible]);

  const chooseLocation = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    try {
      const chosen = await catalogChoose();
      if (chosen) {
        setStatus(chosen);
        setAssets(await catalogAssets());
      }
    } catch (error) { setProblem(describeError(error)); }
    finally { busy.current = false; }
  }, []);

  const importNew = useCallback(async () => {
    if (busy.current || !candidates.length) return;
    busy.current = true;
    setProblem(null);
    setOutcomes(null);
    setImporting(true);
    try {
      const results = await deviceOperation(
        () => catalogImportFromDevice(candidates),
        { message: `Copying ${candidates.length} ${candidates.length === 1 ? 'take' : 'takes'} into your library. Keep the device connected.` },
      );
      setOutcomes(results);
      await refresh();
    } catch (error) { setProblem(describeError(error)); }
    finally { busy.current = false; setImporting(false); }
  }, [candidates, refresh]);

  /**
   * Recordings already on this Mac. No device involved, so this works with
   * everything unplugged — which is the point: the audition, region marking and
   * hand-off to a pad were reachable only through a cable before.
   */
  const addFromMac = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setProblem(null);
    setOutcomes(null);
    setImporting(true);
    try {
      const results = await catalogImportLocal();
      // An empty result means the chooser was cancelled; say nothing rather than
      // reporting a transfer that never happened.
      if (results.length) {
        setOutcomes(results);
        await refresh();
      }
    } catch (error) { setProblem(describeError(error)); }
    finally { busy.current = false; setImporting(false); }
  }, [refresh]);

  const imported = outcomes?.filter(outcome => outcome.status === 'imported').length ?? 0;
  const duplicates = outcomes?.filter(outcome => outcome.status === 'already in library').length ?? 0;
  const failures = outcomes?.filter(outcome => outcome.status === 'failed') ?? [];

  return <div className="device-media capture-library">
    <header className="device-media-hero">
      <div>
        {/* Three states, not two: a failed open left this saying "opening…" for ever,
            beside the error explaining that it never would. */}
        <span>{status ? shortenHomePath(status.path) : problem ? 'no library open' : 'opening your library…'}</span>
        <h2>Takes</h2>
        <p>
          {status
            ? `${status.assets} ${status.assets === 1 ? 'take' : 'takes'} · ${formatFileSize(status.bytes)} · ${status.occurrences} recorded ${status.occurrences === 1 ? 'source' : 'sources'}`
            : problem
              ? 'Choose a different folder, or fix the one below and refresh.'
              : 'Imported recordings are copied here, so they stay available with everything unplugged.'}
        </p>
      </div>
      <div className="capture-actions">
        {/* Adding needs somewhere to add to; without a library this could only fail. */}
        <button disabled={importing || !status} onClick={() => void addFromMac()}>add files…</button>
        {kind && <button className="media-primary" disabled={!candidates.length || importing} onClick={() => void importNew()}>
          {importing ? 'importing…' : candidates.length ? `import ${candidates.length} new` : 'nothing new to import'}
        </button>}
      </div>
    </header>

    <div className="media-toolbar">
      <input aria-label="Search takes" type="search" placeholder="search takes…" value={query} onChange={event => setQuery(event.target.value)} />
      <button onClick={() => void chooseLocation()}>Change location…</button>
      <button onClick={() => void refresh().catch(error => setProblem(describeError(error)))}>Refresh</button>
      <span className="audition-hint">↑↓ moves · space auditions</span>
    </div>

    {kind && candidates.length > 0 && <p className="install-target">
      {candidates.length} {candidates.length === 1 ? 'take' : 'takes'} on {state.tauriDevice?.model.toLowerCase()} {candidates.length === 1 ? 'is' : 'are'} not in your library yet, matched by name.
      Each one is copied and checked by content during import, so an identical file already here is recorded as another source rather than copied twice.
    </p>}

    {kind && !candidates.length && looksIn && <p className="install-target">
      Nothing new in {looksIn} on {state.tauriDevice?.model.toLowerCase()}. Takes come from there
      {kind === 'op-1-field' ? ', not from your drum and synth patches — those stay in the patch library.' : '.'}
    </p>}

    {problem && <p className="project-error" role="alert">{problem}</p>}

    {outcomes && <p className="media-feedback" role="status">
      {imported} imported · {duplicates} already in your library · {failures.length} failed
      {failures.length > 0 && <>{': '}{failures.map(failure => `${failure.source_path} (${failure.error})`).join('; ')}</>}
    </p>}

    {!assets.length && !problem && <div className="install-drop">
      <p>No takes yet.</p>
      <p className="project-muted">
        {kind
          ? 'Use import to copy recordings off the connected device, or add files already on this Mac.'
          : 'Add files from this Mac, or connect a recorder and import from it. Either way they stay here afterwards.'}
      </p>
    </div>}

    {visible.length > 0 && <div className="install-rows" role="listbox" aria-label="Takes" aria-activedescendant={visible[focused] ? 'take-' + visible[focused].id : undefined}>
      {visible.map((asset, index) => {
        const first = asset.occurrences[0];
        const isSelected = selected === asset.id;
        return <div
          className={'media-row install-row take-row' + (isSelected ? ' is-selected' : '')}
          key={asset.id}
          id={'take-' + asset.id}
          role="option"
          aria-selected={isSelected}
          aria-label={takeName(asset)}
          tabIndex={index === focused ? 0 : -1}
          ref={element => { rows.current[index] = element; }}
          onFocus={() => setFocused(index)}
          onClick={() => setSelected(isSelected ? null : asset.id)}
          onKeyDown={event => moveFocus(event, index)}
        >
          <div className="media-name">
            {renaming?.id === asset.id
              ? <input
                  className="take-rename-input"
                  aria-label={'Rename ' + takeName(asset)}
                  autoFocus
                  value={renaming.text}
                  onClick={event => event.stopPropagation()}
                  onChange={event => setRenaming({ id: asset.id, text: event.target.value })}
                  onBlur={() => void commitRename()}
                  onKeyDown={event => {
                    event.stopPropagation();
                    if (event.key === 'Enter') { event.preventDefault(); void commitRename(); }
                    // Escape clears first so the blur that follows has nothing to write.
                    if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); setRenameProblem(null); }
                  }}
                />
              : <button
                  className="take-rename-trigger"
                  aria-label={'Rename ' + takeName(asset)}
                  onClick={event => { event.stopPropagation(); setRenameProblem(null); setRenaming({ id: asset.id, text: asset.label ?? '' }); }}
                ><strong>{takeName(asset)}</strong></button>}
            {renaming?.id === asset.id && renameProblem && <small role="alert">{renameProblem}</small>}
            {/* Once a take is named, the name the recorder gave it is provenance rather
                than noise — it is what the device still calls the file. */}
            {asset.label && <small>filed as {asset.original_name}</small>}
            <small>{asset.stored_path}</small>
            {first && <small>
              from {first.device_model ?? first.source} · {first.source_path}
              {first.captured_at ? ` · recorded ${first.captured_at.slice(0, 16).replace('T', ' ')}` : ''}
            </small>}
            {asset.occurrences.length > 1 && <small>{asset.occurrences.length} sources hold this same audio</small>}
          </div>
          <code>{formatFileSize(asset.bytes)}</code>
          <span className="install-status">{isSelected ? 'auditioning' : formatImported(asset.first_imported_unix)}</span>
        </div>;
      })}
    </div>}

    {assets.length > 0 && !visible.length && <p className="media-feedback">No takes match “{query}”.</p>}

    {transfers.length > 0 && <details className="take-history">
      <summary>Sent to devices ({transfers.length})</summary>
      <ul>
        {transfers.slice(0, 20).map(transfer => <li key={transfer.id}>
          <strong>{transfer.name}</strong>
          <span>{transfer.outcome === 'verified' ? 'verified on' : 'failed writing to'} {transfer.device_model.toLowerCase()}{transfer.device_serial ? ` · ${transfer.device_serial}` : ''}</span>
          <code>{transfer.destination}</code>
          <span>{formatImported(transfer.sent_unix)} · {transfer.files.length} {transfer.files.length === 1 ? 'file' : 'files'}</span>
          {transfer.error && <small>{transfer.error}</small>}
        </li>)}
      </ul>
    </details>}

    {selectedAsset && <TakeAudition
      asset={selectedAsset}
      onRegionsChanged={regions => setAssets(current => current.map(asset => asset.id === selectedAsset.id ? { ...asset, regions } : asset))}
      onRenamed={updated => setAssets(current => current.map(asset => asset.id === updated.id ? updated : asset))}
    />}
  </div>;
}
