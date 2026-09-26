import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { buildOp1Inventory } from '../../utils/op1Library';
import { buildTp7Inventory, formatRecordingDate } from '../../utils/tp7Library';
import { exportDeviceFiles, exportDeviceStems } from '../../utils/tauriBridge';
import type { TauriExportResult } from '../../utils/tauriBridge';
import { formatFileSize } from '../../utils/audio';
import { audioContextManager } from '../../utils/audioContext';
import { readDevicePreview } from '../../utils/deviceAudio';
import { deviceOperation } from '../../utils/deviceOperation';
import './device-media.css';
import { describeError, shortenHomePath } from '../../utils/describeError';

type MediaMode = 'patches' | 'tapes' | 'recordings';
type MediaFile = { handle: number; relative_path: string; size: number };
type Row = { id: string; name: string; folder: string; detail: string; date: string; size: number; files: MediaFile[]; audio: MediaFile[] };
const file = (item: { handle: number; path: string; size: number }): MediaFile => ({ handle: item.handle, relative_path: item.path, size: item.size });

export function DeviceMediaPage({ mode }: { mode: MediaMode }) {
  const { state } = useAppContext();
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [playing, setPlaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<TauriExportResult | null>(null);
  const [stemResult, setStemResult] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const nodes = useRef<Array<{ source: AudioBufferSourceNode; gain: GainNode }>>([]);
  const request = useRef(0);
  const running = useRef(false);

  const rows = useMemo<Row[]>(() => {
    if (mode === 'recordings') {
      return buildTp7Inventory(state.tauriTreeEntries ?? []).recordings.map(item => ({
        id: item.id, name: item.stem, folder: item.folder, detail: item.extension, date: formatRecordingDate(item.recordedAt), size: item.size,
        files: [file(item)], audio: [file(item)],
      }));
    }
    const inventory = buildOp1Inventory(state.tauriTreeEntries ?? []);
    if (mode === 'patches') return inventory.patches.map(item => ({
      id: item.id, name: item.name, folder: item.root + '/' + item.folder, detail: item.root + ' patch', date: item.modified?.slice(0, 10) ?? '—', size: item.size,
      files: [file(item)], audio: [file(item)],
    }));
    return [
      ...inventory.tapes.map(item => ({
        id: item.id, name: item.name, folder: item.folder, detail: item.tracks.length + ' tape tracks', date: '—', size: item.totalSize,
        files: [...item.tracks.map(file), ...(item.markers ? [file(item.markers)] : [])], audio: item.tracks.map(file),
      })),
      ...inventory.album.map(item => ({ id: item.id, name: item.name, folder: 'album', detail: 'album side', date: '—', size: item.size, files: [file(item)], audio: [file(item)] })),
    ];
  }, [mode, state.tauriTreeEntries]);

  const folders = useMemo(() => ['all', ...new Set(rows.map(row => row.folder))], [rows]);
  const visible = rows.filter(row => (folder === 'all' || row.folder === folder) && (row.name + ' ' + row.folder).toLowerCase().includes(query.toLowerCase()));
  const chosen = rows.filter(row => selected.has(row.id));

  const stop = useCallback(() => {
    request.current++;
    nodes.current.forEach(({ source, gain }) => { source.onended = null; try { source.stop(); } catch { /* already stopped */ } source.disconnect(); gain.disconnect(); });
    nodes.current = [];
    setPlaying(null); setLevels([]);
  }, []);

  useEffect(() => {
    stop(); setSelected(new Set()); setQuery(''); setFolder('all'); setExportResult(null); setError(null);
    return stop;
  }, [mode, state.tauriDevice, state.tauriTreeEntries, stop]);

  async function preview(row: Row) {
    if (running.current) return;
    if (playing === row.id) { stop(); return; }
    stop();
    const id = ++request.current;
    running.current = true; setBusy(true); setError(null);
    try {
      await deviceOperation(async () => {
        const ctx = await audioContextManager.getAudioContext();
        const buffers: AudioBuffer[] = [];
        for (const item of row.audio) {
          const bytes = await readDevicePreview(item.handle, item.size, start);
          if (id !== request.current) return;
          buffers.push(await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
        }
        if (id !== request.current) return;
        // Common start time keeps all tape tracks sample-aligned; headroom avoids summing overload.
        const level = 1 / Math.max(1, buffers.length);
        nodes.current = buffers.map(buffer => {
          const source = ctx.createBufferSource(); source.buffer = buffer;
          const gain = ctx.createGain(); gain.gain.value = level;
          source.connect(gain); gain.connect(ctx.destination);
          return { source, gain };
        });
        let remaining = nodes.current.length;
        const when = ctx.currentTime + 0.08;
        nodes.current.forEach(({ source }) => { source.onended = () => { if (--remaining === 0 && id === request.current) stop(); }; source.start(when); });
        setLevels(buffers.map(() => level)); setPlaying(row.id);
      }, { message: `Reading up to 30 seconds of ${row.name} from the device to preview it. Nothing is being written.` });
    } catch (error) { if (id === request.current) { stop(); setError(describeError(error)); } }
    finally { running.current = false; setBusy(false); }
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
    <header className="device-media-hero"><div><span>on {state.tauriDevice?.model.toLowerCase()}</span><h2>{title}</h2><p>{rows.length} {rows.length === 1 ? 'item' : 'items'} · {formatFileSize(rows.reduce((sum, row) => sum + row.size, 0))}</p></div><button className="media-primary" disabled={!chosen.length || busy} onClick={() => void exportRows(chosen)}>export selected{chosen.length ? ' (' + chosen.length + ')' : ''}</button></header>
    <div className="media-toolbar"><input aria-label={'Search ' + title} type="search" placeholder={'search ' + title + '…'} value={query} onChange={event => setQuery(event.target.value)} /><select aria-label="Filter folder" value={folder} onChange={event => setFolder(event.target.value)}>{folders.map(value => <option key={value}>{value}</option>)}</select></div>
    <div className="media-preview-controls"><label>Preview from (seconds) <input type="number" min="0" step="1" value={start} onChange={event => { stop(); setStart(Math.max(0, Number(event.target.value) || 0)); }} /></label><span>WAV / AIFF: up to 30 seconds per preview. Originals export in full.</span></div>
    {error && <p className="media-feedback" role="alert">{error}</p>}
    {exportResult && <div className="media-feedback" role="status"><p>{exportResult.copied} files exported · {exportResult.skipped} existing files skipped · {exportResult.failed.length} failed<br />{exportResult.path}</p>{exportResult.failed.map(item => <p key={item.path}>{item.path}: {item.error}</p>)}</div>}
    {stemResult && <p className="media-feedback" role="status">{stemResult}</p>}
    {playing && <div className="media-mixer" aria-label="Preview mixer"><button onClick={stop}>stop preview</button>{levels.map((level, index) => <label key={index}>track {index + 1}<input aria-label={'Track ' + (index + 1) + ' preview level'} type="range" min="0" max="1" step=".01" value={level} onChange={event => { const value = Number(event.target.value); if (nodes.current[index]) nodes.current[index].gain.gain.value = value; setLevels(current => current.map((item, i) => i === index ? value : item)); }} /></label>)}</div>}
    <div className="media-list" role="list">
      {visible.map(row => <article className="media-row" role="listitem" key={row.id}>
        <input aria-label={'Select ' + row.name} type="checkbox" checked={selected.has(row.id)} onChange={() => setSelected(current => { const next = new Set(current); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} />
        <button className={'media-play ' + (playing === row.id ? 'is-playing' : '')} disabled={!row.audio.length || busy} onClick={() => void preview(row)} aria-label={(playing === row.id ? 'Stop' : 'Preview') + ' ' + row.name}>{playing === row.id ? '■' : '▶'}</button>
        <div className="media-name"><strong>{row.name}</strong><small>{row.folder} · {row.detail}</small>{mode === 'recordings' && row.audio[0]?.relative_path.toLowerCase().endsWith('.wav') && <button className="media-stems" disabled={busy} onClick={() => void stems(row)}>export stereo stems</button>}</div><time>{row.date}</time><code>{formatFileSize(row.size)}</code>
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
