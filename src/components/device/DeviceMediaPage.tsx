import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { buildOp1Inventory } from '../../utils/op1Library';
import { buildTp7Inventory, formatRecordingDate } from '../../utils/tp7Library';
import { exportDeviceFiles, exportDeviceStems, mtpDelete, mtpRename, mtpScanTree } from '../../utils/tauriBridge';
import type { TauriExportResult } from '../../utils/tauriBridge';
import { formatFileSize } from '../../utils/audio';
import { audioContextManager } from '../../utils/audioContext';
import { readDevicePreview, PREVIEW_SECONDS } from '../../utils/deviceAudio';
import { deviceOperation } from '../../utils/deviceOperation';
import { getDeviceProfile, detectDeviceKind } from '../../utils/teDevices';
import { catalogAssets } from '../../utils/tauriBridge';
import { alreadyImported, knownOrigins } from '../../utils/takeOrigins';
import './device-media.css';
import { describeError, shortenHomePath } from '../../utils/describeError';

type MediaMode = 'patches' | 'tapes' | 'recordings';
type MediaFile = { handle: number; relative_path: string; size: number };
type Row = { id: string; name: string; folder: string; detail: string; date: string; size: number; when: number; files: MediaFile[]; audio: MediaFile[] };

/** Which column the list is ordered by, and which way. */
/**
 * How much audio is fetched before playback starts, and in what steps after that.
 *
 * Two seconds is the shortest window that reliably arrives and decodes before it is due,
 * and it buys 2 s of playback to fetch the next 6 in — roughly a tenfold margin even on a
 * slow link. Larger opening chunks trade the responsiveness this exists to fix.
 */
const OPENING_SECONDS = 2;
const CHUNK_SECONDS = 6;

type SortKey = 'name' | 'when' | 'size';
type Sort = { key: SortKey; descending: boolean };
const file = (item: { handle: number; path: string; size: number }): MediaFile => ({ handle: item.handle, relative_path: item.path, size: item.size });


/**
 * What the user is about to lose, said plainly.
 *
 * Deleting from the device is irreversible — MTP has no trash — so the one fact worth
 * putting in front of someone at that moment is whether a copy survives on this Mac.
 * The catalog knows, and the wording separates the two groups rather than giving a total,
 * because "delete 4 files" reads the same whether or not three of them exist elsewhere.
 */
export function describeDeletion(rows: Array<{ name: string; size: number; files: Array<{ relative_path: string }> }>, imported: Map<string, Set<string>>, serial: string | null | undefined): string {
  const bytes = rows.reduce((sum, row) => sum + row.size, 0);
  const onlyOnDevice = rows.filter(row => !row.files.every(file => alreadyImported(imported, file.relative_path, serial)));
  const heading = rows.length === 1
    ? `Delete ${rows[0].name} from the device?`
    // count-ok: the singular is the branch above.
    : `Delete ${rows.length} files from the device?`;
  const safety = onlyOnDevice.length === 0
    ? 'Every one of these is already in your takes library, so you keep a copy.'
    : onlyOnDevice.length === rows.length
      ? rows.length === 1
        ? 'This is not in your takes library. Deleting it means it is gone for good.'
        : 'None of these are in your takes library. Deleting them means they are gone for good.'
      : `${onlyOnDevice.length} of these ${onlyOnDevice.length === 1 ? 'is' : 'are'} not in your takes library and would be gone for good: ${onlyOnDevice.map(row => row.name).join(', ')}.`;
  return `${heading} This frees ${formatFileSize(bytes)} and cannot be undone. ${safety}`;
}

export function DeviceMediaPage({ mode }: { mode: MediaMode }) {
  const { state, dispatch } = useAppContext();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<TauriExportResult | null>(null);
  const [stemResult, setStemResult] = useState<string | null>(null);
  /**
   * Newest first, because a recorder's most recent take is the one being looked for.
   *
   * That default matters more than the control: a TP-7 names every file
   * `YYYY-MM-DD_HHMMSS_NNN` in one folder at one format, so name order *is* capture order
   * and size is a proxy for length. Sorting earns its keep on a mixed list — an OP-1's
   * tapes and patches — more than on a recorder's.
   */
  const [sort, setSort] = useState<Sort>({ key: 'when', descending: true });
  /** Non-null while a file's name is being edited in place. */
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [rowProblem, setRowProblem] = useState<string | null>(null);
  /** Rows awaiting a delete confirmation. Empty means no dialog. */
  const [pendingDelete, setPendingDelete] = useState<Row[]>([]);
  /**
   * Which device paths are already in the local take library.
   *
   * Deleting a recording off a TP-7 is irreversible — there is no device-side trash —
   * and the catalog already knows whether a copy exists on this Mac, for free: it records
   * where every take came from. So the confirmation can say which of these files the user
   * still has afterwards and which are about to stop existing anywhere. Reading the
   * catalog touches the local library only, never the device.
   */
  const [imported, setImported] = useState<Map<string, Set<string>>>(new Map());
  const [start, setStart] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  /**
   * One entry per track, each holding a gain node that outlives the individual chunks.
   *
   * Playback is assembled from several reads rather than one, so sources come and go while
   * a track keeps playing. The gain has to persist across them or a fader moved mid-preview
   * would apply only to audio already fetched.
   */
  const nodes = useRef<Array<{ gain: GainNode; sources: AudioBufferSourceNode[] }>>([]);
  const request = useRef(0);
  const running = useRef(false);

  const rows = useMemo<Row[]>(() => {
    if (mode === 'recordings') {
      return buildTp7Inventory(state.tauriTreeEntries ?? []).recordings.map(item => ({
        id: item.id, name: item.stem, folder: item.folder, detail: item.extension, date: formatRecordingDate(item.recordedAt), size: item.size,
        when: item.recordedAt?.getTime() ?? 0,
        files: [file(item)], audio: [file(item)],
      }));
    }
    const inventory = buildOp1Inventory(state.tauriTreeEntries ?? []);
    if (mode === 'patches') return inventory.patches.map(item => ({
      id: item.id, name: item.name, folder: item.root + '/' + item.folder, detail: item.root + ' patch', date: item.modified?.slice(0, 10) ?? '—', size: item.size,
      when: item.modified ? Date.parse(item.modified) || 0 : 0,
      files: [file(item)], audio: [file(item)],
    }));
    return [
      ...inventory.tapes.map(item => ({
        id: item.id, name: item.name, folder: item.folder, detail: item.tracks.length + ' tape tracks', date: '—', size: item.totalSize, when: 0,
        files: [...item.tracks.map(file), ...(item.markers ? [file(item.markers)] : [])], audio: item.tracks.map(file),
      })),
      ...inventory.album.map(item => ({ id: item.id, name: item.name, folder: 'album', detail: 'album side', date: '—', size: item.size, when: 0, files: [file(item)], audio: [file(item)] })),
    ];
  }, [mode, state.tauriTreeEntries]);

  const folders = useMemo(() => ['all', ...new Set(rows.map(row => row.folder))], [rows]);
  const visible = useMemo(() => {
    const matching = rows.filter(row => (folder === 'all' || row.folder === folder) && (row.name + ' ' + row.folder).toLowerCase().includes(query.toLowerCase()));
    const compare = (a: Row, b: Row) => {
      // Names are timestamps on a recorder and words elsewhere, so compare them the way
      // a person reads them: `localeCompare` with `numeric` puts take 2 before take 10.
      if (sort.key === 'name') return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
      const difference = a[sort.key] - b[sort.key];
      // Undated rows — an OP-1 tape has no capture time — would otherwise shuffle within
      // their tie. Falling back to the name keeps the order stable and readable.
      return difference !== 0 ? difference : a.name.localeCompare(b.name, undefined, { numeric: true });
    };
    return [...matching].sort((a, b) => (sort.descending ? -1 : 1) * compare(a, b));
  }, [rows, folder, query, sort]);
  const chosen = rows.filter(row => selected.has(row.id));

  const stop = useCallback(() => {
    // Bumping the request id is also what tells an in-flight chunk fetch to stop: the
    // stream loop checks it between reads, so nothing is scheduled after a stop.
    request.current++;
    nodes.current.forEach(({ gain, sources }) => {
      sources.forEach(source => { source.onended = null; try { source.stop(); } catch { /* already stopped */ } source.disconnect(); });
      gain.disconnect();
    });
    nodes.current = [];
    setPlaying(null); setLevels([]);
  }, []);

  useEffect(() => {
    stop(); setSelected(new Set()); setQuery(''); setFolder('all'); setExportResult(null); setError(null);
    return stop;
  }, [mode, state.tauriDevice, state.tauriTreeEntries, stop]);

  /**
   * Re-read the device after a change, so the list reflects what is actually there.
   *
   * Removing the row locally would be faster and would also be a guess: if the device
   * kept the file, the list would be the only thing claiming it had gone.
   */
  useEffect(() => {
    let live = true;
    catalogAssets()
      .then(assets => { if (live) setImported(knownOrigins(assets)); })
      // A library that cannot be read means the confirmation says "not checked" rather
      // than wrongly claiming a file is safe to remove.
      .catch(() => { if (live) setImported(new Map()); });
    return () => { live = false; };
  }, [state.tauriDevice]);

  const rescan = useCallback(async () => {
    const kind = state.tauriDevice?.kind ?? detectDeviceKind(state.tauriDevice?.model ?? '');
    const tree = await mtpScanTree(getDeviceProfile(kind).roots);
    dispatch({ type: 'SET_TAURI_TREE_ENTRIES', payload: tree.entries });
    dispatch({ type: 'SET_TAURI_MISSING_ROOTS', payload: tree.missing_roots });
  }, [dispatch, state.tauriDevice]);

  /**
   * Rename the file on the device.
   *
   * A row carries exactly one file here — a tape is the exception and is not renameable,
   * since the track number lives in the name. The extension is kept: the user edits the
   * part they named, and the native layer refuses a change of ending anyway.
   */
  async function commitRename() {
    if (!renaming) return;
    const row = rows.find(item => item.id === renaming.id);
    const target = row?.files[0];
    const currentStem = row?.name ?? '';
    const text = renaming.text.trim();
    if (!row || !target || !text || text === currentStem) { setRenaming(null); return; }
    const extension = target.relative_path.includes('.') ? '.' + target.relative_path.split('.').pop() : '';
    if (running.current) return;
    running.current = true; setBusy(true); setRowProblem(null);
    try {
      await deviceOperation(async () => {
        await mtpRename(target.handle, text + extension);
        await rescan();
      }, { message: 'Renaming ' + row.name + ' on the device.' });
      setRenaming(null);
    } catch (error) {
      // Stay in the field with the text intact: retyping a rejected name is the
      // irritating part, not being told it was rejected.
      setRowProblem(describeError(error));
    }
    finally { running.current = false; setBusy(false); }
  }

  /** Remove the confirmed files. There is no device-side trash; this does not come back. */
  async function confirmDelete() {
    const targets = pendingDelete;
    setPendingDelete([]);
    if (!targets.length || running.current) return;
    running.current = true; setBusy(true); setError(null); setRowProblem(null); setExportResult(null); setStemResult(null);
    try {
      await deviceOperation(async () => {
        const outcome = await mtpDelete(targets.flatMap(row => row.files).map(file => file.handle));
        await rescan();
        setSelected(new Set());
        const parts: string[] = [];
        if (outcome.deleted.length) parts.push(outcome.deleted.length + ' ' + (outcome.deleted.length === 1 ? 'file' : 'files') + ' deleted (' + formatFileSize(outcome.deleted_bytes) + ' freed)');
        if (outcome.already_gone) parts.push(outcome.already_gone + ' already gone');
        // Failures are named individually: "3 of 4 deleted" does not say which one is
        // still there, and that is the only part the user has to act on.
        if (outcome.failed.length) parts.push(outcome.failed.map(item => item.name + ': ' + item.error).join('; '));
        setStemResult(parts.join(' · '));
      }, { message: 'Deleting ' + targets.length + ' ' + (targets.length === 1 ? 'file' : 'files') + ' from the device.' });
    } catch (error) { setError(describeError(error)); }
    finally { running.current = false; setBusy(false); }
  }

  /**
   * Put one chunk of already-decoded audio on the timeline and report when it ends.
   *
   * Chunks are cut on frame boundaries by `readDevicePreview`, so consecutive windows abut
   * exactly; scheduling each one at the previous one's end time is sample-accurate and
   * therefore gapless. The most recently scheduled chunk on track 0 carries the handler
   * that ends the preview, and the one before it has its handler cleared — otherwise a
   * mid-stream chunk finishing would stop playback while more was still to come.
   */
  function scheduleChunk(ctx: AudioContext, buffers: AudioBuffer[], at: number, id: number): number {
    buffers.forEach((buffer, index) => {
      const track = nodes.current[index];
      if (!track) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(track.gain);
      if (index === 0) {
        const previous = track.sources[track.sources.length - 1];
        if (previous) previous.onended = null;
        source.onended = () => { if (id === request.current) stop(); };
      }
      source.start(at);
      track.sources.push(source);
    });
    return at + (buffers[0]?.duration ?? 0);
  }

  const decode = (ctx: AudioContext, bytes: Uint8Array) =>
    ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);

  /**
   * Keep reading the rest of the window while the opening chunk plays.
   *
   * Deliberately outside `deviceOperation`: that marks the workspace busy and makes the
   * panel inert, which is right for the read the user is waiting on and wrong for one
   * happening behind audio that is already sounding. The native layer holds a mutex per
   * device, so these reads interleave safely with anything else the user starts.
   */
  async function streamRemainder(row: Row, ctx: AudioContext, id: number, at: number, covered: number) {
    let fetched = covered;
    let next = at;
    while (fetched < PREVIEW_SECONDS && id === request.current) {
      const take = Math.min(CHUNK_SECONDS, PREVIEW_SECONDS - fetched);
      let buffers: AudioBuffer[];
      try {
        const chunk = await Promise.all(row.audio.map(item => readDevicePreview(item.handle, item.size, start + fetched, take)));
        if (id !== request.current) return;
        buffers = await Promise.all(chunk.map(bytes => decode(ctx, bytes)));
      } catch {
        // The recording ended inside the window, or the device went away. What is already
        // scheduled keeps playing and ends by itself; there is nothing to report.
        return;
      }
      if (id !== request.current) return;
      fetched += take;
      next = scheduleChunk(ctx, buffers, next, id);
    }
  }

  async function preview(row: Row) {
    if (running.current) return;
    if (playing === row.id) { stop(); return; }
    stop();
    const id = ++request.current;
    running.current = true; setBusy(true); setError(null);
    try {
      const ctx = await audioContextManager.getAudioContext();
      // Only the opening chunk is read under the busy banner — it is the sole part the
      // user waits through. It used to be the whole 30 seconds, about 9.7 MB over MTP
      // before a single sample sounded.
      const opening = await deviceOperation(
        () => Promise.all(row.audio.map(item => readDevicePreview(item.handle, item.size, start, OPENING_SECONDS))),
        { message: `Reading ${row.name} from the device. Nothing is being written.` },
      );
      if (id !== request.current) return;
      const buffers = await Promise.all(opening.map(bytes => decode(ctx, bytes)));
      if (id !== request.current) return;

      // Headroom against summing several tape tracks into clipping.
      const level = 1 / Math.max(1, buffers.length);
      nodes.current = buffers.map(() => {
        const gain = ctx.createGain();
        gain.gain.value = level;
        gain.connect(ctx.destination);
        return { gain, sources: [] as AudioBufferSourceNode[] };
      });
      const at = scheduleChunk(ctx, buffers, ctx.currentTime + 0.08, id);
      setLevels(buffers.map(() => level));
      setPlaying(row.id);
      // Audio is sounding and the device is free: release the controls before fetching
      // the rest, so the list is usable while a preview runs.
      running.current = false; setBusy(false);

      // A file shorter than the opening request comes back whole, and so does the
      // fallback for a header this app cannot parse. Either way there is nothing left.
      if ((buffers[0]?.duration ?? 0) < OPENING_SECONDS - 0.05) return;
      void streamRemainder(row, ctx, id, at, OPENING_SECONDS);
    } catch (error) {
      if (id === request.current) { stop(); setError(describeError(error)); }
    } finally {
      // Already cleared on the success path, where playback continues past this point.
      running.current = false; setBusy(false);
    }
  }

  async function exportRows(items: Row[]) {
    if (!items.length || running.current) return;
    running.current = true; setBusy(true); setError(null); setExportResult(null); setStemResult(null);
    try { setExportResult(await exportDeviceFiles(items.flatMap(item => item.files))); }
    catch (error) { setError(describeError(error)); }
    finally { running.current = false; setBusy(false); }
  }

  async function stems(row: Row) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null); setStemResult(null);
    try {
      await deviceOperation(async () => {
        const result = await exportDeviceStems(row.audio[0].handle, row.name, row.size);
        if (!result) return;
        const tracks = result.stems.map(stem => 'track-' + stem.index + (stem.channels === 1 ? ' (mono)' : '')).join(', ');
        setStemResult(result.stems.length + ' stems written to ' + shortenHomePath(result.path) + ': ' + tracks
          + '. ' + result.source_channels + ' source channels at ' + (result.sample_rate / 1000).toFixed(1)
          + ' khz / ' + result.bits + '-bit kept exactly; container metadata is not copied to derived stems.');
      }, { message: 'Splitting ' + row.name + ' into stems. Keep the device connected.' });
    } catch (error) { setError(describeError(error)); }
    finally { running.current = false; setBusy(false); }
  }

  const title = mode === 'recordings' ? 'recordings' : mode === 'tapes' ? 'tapes + album' : 'patch library';
  // Which device folders this view reads, so an empty list can say whether the
  // folders are missing or merely empty. Owners hit exactly this: a field with no
  // tape or album folder over one transfer mode shows nothing here, and the notice
  // explaining why used to live only on the connection bar above.
  const readsFolders = mode === 'recordings' ? ['recordings', 'memo'] : mode === 'tapes' ? ['tape', 'album'] : ['drum', 'synth'];
  const absent = (state.tauriMissingRoots ?? []).filter(root => readsFolders.includes(root));
  return <div className="device-media">
    <header className="device-media-hero"><div><span>on {state.tauriDevice?.model.toLowerCase()}</span><h2>{title}</h2><p>{rows.length} {rows.length === 1 ? 'item' : 'items'} · {formatFileSize(rows.reduce((sum, row) => sum + row.size, 0))}</p></div><div className="media-hero-actions">
      <button className="media-primary" disabled={!chosen.length || busy} onClick={() => void exportRows(chosen)}>export selected{chosen.length ? ' (' + chosen.length + ')' : ''}</button>
      <button className="media-danger" disabled={!chosen.length || busy} onClick={() => setPendingDelete(chosen)}>delete{chosen.length ? ' (' + chosen.length + ')' : ''}</button>
    </div></header>
    <div className="media-toolbar"><input aria-label={'Search ' + title} type="search" placeholder={'search ' + title + '…'} value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Filter folder" value={folder} onChange={event => setFolder(event.target.value)}>{folders.map(value => <option key={value}>{value}</option>)}</select></div>
    {/* One bar, always present, fixed height. The track faders used to live in a second
        bar that only existed while something was playing, so starting a preview inserted
        it into the flow and shoved the list down — under the pointer of whoever had just
        clicked play. They live here now, and the row's own ■ is the stop control, so
        there is nothing left to appear or disappear. */}
    <div className="media-preview-controls">
      <label>Preview from (seconds) <input type="number" min="0" step="1" value={start} onChange={event => { stop(); setStart(Math.max(0, Number(event.target.value) || 0)); }} /></label>
      {/* Faders only earn their space when there is a balance to strike: an OP-1 field tape
          plays four tracks at once. A single-track TP-7 recording has nothing to mix. */}
      {playing && levels.length > 1
        ? <div className="media-mixer-inline" aria-label="Preview mixer">{levels.map((level, index) => <label key={index}>track {index + 1}<input aria-label={'Track ' + (index + 1) + ' preview level'} type="range" min="0" max="1" step=".01" value={level} onChange={event => { const value = Number(event.target.value); if (nodes.current[index]) nodes.current[index].gain.gain.value = value; setLevels(current => current.map((item, i) => i === index ? value : item)); }} /></label>)}</div>
        : <span>WAV / AIFF: up to 30 seconds per preview. Originals export in full.</span>}
    </div>
    {error && <p className="media-feedback" role="alert">{error}</p>}
    {exportResult && <div className="media-feedback" role="status"><p>{exportResult.copied} files exported · {exportResult.skipped} existing files skipped · {exportResult.failed.length} failed<br />{exportResult.path}</p>{exportResult.failed.map(item => <p key={item.path}>{item.path}: {item.error}</p>)}</div>}
    {stemResult && <p className="media-feedback" role="status">{stemResult}</p>}
    {/* Column headers that sort. `aria-sort` on the header is what announces the order
        to a screen reader; the arrow is decorative. */}
    <div className="media-head" role="row">
      <span className="media-head-spacer" />
      {([['name', 'Name'], ['when', 'Recorded'], ['size', 'Size']] as const).map(([key, label]) =>
        <button key={key} role="columnheader" className={'media-head-cell is-' + key + (sort.key === key ? ' is-active' : '')}
          aria-sort={sort.key === key ? (sort.descending ? 'descending' : 'ascending') : 'none'}
          onClick={() => setSort(current => current.key === key
            // Same column: flip. New column: start the way that column is most useful —
            // newest and largest first, but names from A.
            ? { key, descending: !current.descending }
            : { key, descending: key !== 'name' })}>
          {label}<span aria-hidden="true" className="media-head-arrow">{sort.key === key ? (sort.descending ? '↓' : '↑') : ''}</span>
        </button>)}
      <span className="media-head-spacer" />
    </div>
    {pendingDelete.length > 0 && <ConfirmationModal
      isOpen
      message={describeDeletion(pendingDelete, imported, state.tauriDevice?.serial)}
      confirmLabel={pendingDelete.length === 1 ? 'delete it' : `delete ${pendingDelete.length} files`}
      onConfirm={() => void confirmDelete()}
      onCancel={() => setPendingDelete([])}
    />}
    <div className="media-list" role="list">
      {visible.map(row => <article className="media-row" role="listitem" key={row.id}>
        <input aria-label={'Select ' + row.name} type="checkbox" checked={selected.has(row.id)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} />
        <button className={'media-play ' + (playing === row.id ? 'is-playing' : '')} disabled={!row.audio.length || busy} onClick={() => void preview(row)} aria-label={(playing === row.id ? 'Stop' : 'Preview') + ' ' + row.name}>{playing === row.id ? '■' : '▶'}</button>
        <div className="media-name">{renaming?.id === row.id
          ? <input
              className="take-rename-input"
              aria-label={'Rename ' + row.name}
              autoFocus
              value={renaming.text}
              onClick={event => event.stopPropagation()}
              onChange={event => setRenaming({ id: row.id, text: event.target.value })}
              onBlur={() => void commitRename()}
              onKeyDown={event => {
                event.stopPropagation();
                if (event.key === 'Enter') { event.preventDefault(); void commitRename(); }
                // Escape clears first so the blur that follows has nothing to write.
                if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); setRowProblem(null); }
              }}
            />
          /* A tape row is four files whose names carry their track numbers, so it is not
             renameable — the native layer refuses it too, and offering the control here
             would only produce a refusal the user could have been spared. */
          : mode === 'tapes'
            ? <strong>{row.name}</strong>
            : <button className="take-rename-trigger" aria-label={'Rename ' + row.name}
                onClick={event => { event.stopPropagation(); setRowProblem(null); setRenaming({ id: row.id, text: row.name }); }}
              ><strong>{row.name}</strong></button>}
        {renaming?.id === row.id && rowProblem && <small role="alert">{rowProblem}</small>}<small>{row.folder} · {row.detail}</small>{/* Named for what it does, not for what it produces. It was "export stereo stems",
            which read as a second export button — and on a stereo recording that is
            exactly what it is, since channels are grouped into pairs and a 2-channel file
            yields one stem identical to the original. Splitting is a different operation
            from copying, so it is worded and styled as one.

            It cannot yet be hidden on the files where it is pointless: channel count is
            not in the device scan, only in each file's header, so knowing would cost a
            read per row. See `docs/device-workspace-design.md`. */}
          {mode === 'recordings' && row.audio[0]?.relative_path.toLowerCase().endsWith('.wav') && <button className="media-stems" disabled={busy} onClick={() => void stems(row)}>split into stems</button>}</div><time>{row.date}</time><code>{formatFileSize(row.size)}</code>
        <button className="media-export" disabled={busy} onClick={() => void exportRows([row])}>export</button>
      </article>)}
      {!visible.length && <div className="media-empty">
        {rows.length ? 'nothing matches these filters' : absent.length ? <>
          <p>{absent.length === 1
            ? `There is no ${absent[0]} folder on this device.`
            : `There are no ${absent.join(' or ')} folders on this device.`}</p>
          <p>{`Some transfer modes and firmware versions do not expose ${absent.length === 1 ? 'it' : 'them'}. If you expect ${absent.length === 1 ? 'it' : 'them'} to be here, reconnect in the other transfer mode and use refresh device.`}</p>
        </> : 'no ' + title + ' found on this device'}
      </div>}
    </div>
  </div>;
}
