import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  catalogDeleteRegion,
  catalogSaveRegion,
  localAudioInfo,
  localAudioPeaks,
  localAudioWindow,
} from '../../utils/tauriBridge';
import type { CatalogAsset, CatalogRegion, LocalAudioInfo, LocalAudioPeaks } from '../../utils/tauriBridge';
import { audioContextManager } from '../../utils/audioContext';
import { findNearestZeroCrossing } from '../../utils/audio';
import { useRegionHandoff } from '../../hooks/useRegionHandoff';
import { describeError } from '../../utils/describeError';
import { takeName, takeStem } from '../../utils/takeOrigins';
import { catalogLabelAsset } from '../../utils/tauriBridge';

const BUCKETS = 1200;
/** Longest stretch played or rendered in one read, matching the native window cap comfortably. */
const MAX_AUDITION_SECONDS = 30;

function formatTime(frames: number, sampleRate: number): string {
  if (!sampleRate) return '—';
  const total = frames / sampleRate;
  const minutes = Math.floor(total / 60);
  const seconds = total - minutes * 60;
  return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
}

/**
 * Audition a take and mark named regions in it.
 *
 * Nothing here loads the whole file: the waveform is drawn from cached peaks and
 * playback reads a bounded window, so the last minute of a long recording opens
 * as fast as the first. Regions are frame positions saved as metadata — the
 * original audio is never rewritten.
 */
export function TakeAudition({ asset, onRegionsChanged, onRenamed }: {
  asset: CatalogAsset;
  onRegionsChanged?: (regions: CatalogRegion[]) => void;
  onRenamed?: (asset: CatalogAsset) => void;
}) {
  const [info, setInfo] = useState<LocalAudioInfo | null>(null);
  /** Non-null while the take's name is being edited. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameProblem, setRenameProblem] = useState<string | null>(null);
  const [peaks, setPeaks] = useState<LocalAudioPeaks | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [markIn, setMarkIn] = useState(0);
  const [markOut, setMarkOut] = useState(0);
  const [snap, setSnap] = useState(true);
  const [name, setName] = useState('');
  const [playing, setPlaying] = useState(false);
  const [regions, setRegions] = useState<CatalogRegion[]>(asset.regions ?? []);
  const [saving, setSaving] = useState(false);
  const { toDrumLab, toSampleLab, sendMany } = useRegionHandoff();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const source = useRef<AudioBufferSourceNode | null>(null);

  /**
   * Keep the saved-region list in step with the parent, and nothing else.
   *
   * This used to share the effect below, so any change to `asset.regions` — saving a
   * region, deleting one, or renaming the take — reset the whole panel: the waveform
   * blanked, the header was re-read, the playhead jumped to 0 and **the in and out
   * marks the user had just made were wiped**. Marking a hit and saving it destroyed
   * the marks for the next one, which is the core of building a kit from one take.
   *
   * The reads below depend only on which take is open; this depends only on its regions.
   */
  useEffect(() => {
    const current = asset.regions ?? [];
    setRegions(current);
    // A region that no longer exists cannot stay selected, but the rest of the
    // selection survives — clearing it wholesale lost a batch mid-assembly.
    setPicked(picked => {
      const alive = new Set(current.map(region => region.id));
      const kept = [...picked].filter(id => alive.has(id));
      return kept.length === picked.size ? picked : new Set(kept);
    });
  }, [asset.regions]);

  useEffect(() => {
    let live = true;
    setInfo(null);
    setPeaks(null);
    setProblem(null);
    setPlayhead(0);
    setMarkIn(0);
    setMarkOut(0);
    setName('');
    (async () => {
      try {
        const described = await localAudioInfo(asset.id);
        if (!live) return;
        setInfo(described);
        setMarkOut(Math.min(described.frames, described.sample_rate));
        const summary = await localAudioPeaks(asset.id, BUCKETS);
        if (live) setPeaks(summary);
      } catch (error) {
        if (live) setProblem(describeError(error));
      }
    })();
    return () => { live = false; };
  }, [asset.id]);

  const stop = useCallback(() => {
    if (source.current) {
      try { source.current.stop(); } catch { /* already finished */ }
      source.current = null;
    }
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  /** Read a window from the playhead, decode it, and play it. */
  const play = useCallback(async (fromFrame: number, lengthFrames?: number) => {
    if (!info) return;
    stop();
    setProblem(null);
    try {
      const frames = Math.max(1, Math.min(lengthFrames ?? info.sample_rate * MAX_AUDITION_SECONDS, info.sample_rate * MAX_AUDITION_SECONDS));
      const bytes = await localAudioWindow(asset.id, Math.floor(fromFrame), Math.floor(frames));
      const context = await audioContextManager.getAudioContext();
      const buffer = await context.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.connect(context.destination);
      node.onended = () => { setPlaying(false); source.current = null; };
      node.start();
      source.current = node;
      setPlaying(true);
    } catch (error) {
      setProblem(describeError(error));
      setPlaying(false);
    }
  }, [asset.id, info, stop]);

  /** Nudge a mark onto the nearest zero crossing, using the loaded window only. */
  const settle = useCallback(async (frame: number): Promise<number> => {
    if (!snap || !info) return frame;
    try {
      const radius = Math.min(1024, info.sample_rate);
      const start = Math.max(0, frame - radius);
      const bytes = await localAudioWindow(asset.id, start, radius * 2);
      const context = await audioContextManager.getAudioContext();
      const buffer = await context.decodeAudioData(bytes.buffer.slice(0) as ArrayBuffer);
      // The helper works in frames within the buffer it is given, so offset in and back out.
      const crossing = findNearestZeroCrossing(buffer, frame - start, 'both');
      return Math.max(0, Math.min(info.frames, start + Math.round(crossing)));
    } catch {
      // Snapping is a convenience; a failed read must not block marking.
      return frame;
    }
  }, [asset.id, info, snap]);

  // Draw the take from its peaks.
  useEffect(() => {
    const element = canvas.current;
    if (!element || !peaks || !info) return;
    const context = element.getContext('2d');
    if (!context) return;
    const width = element.width;
    const height = element.height;
    context.clearRect(0, 0, width, height);
    const lanes = Math.max(1, peaks.channels);
    const laneHeight = height / lanes;
    context.fillStyle = '#4a4a44';
    for (let lane = 0; lane < lanes; lane++) {
      const centre = laneHeight * lane + laneHeight / 2;
      for (let bucket = 0; bucket < peaks.buckets; bucket++) {
        const x = (bucket / peaks.buckets) * width;
        const low = peaks.min[lane * peaks.buckets + bucket] ?? 0;
        const high = peaks.max[lane * peaks.buckets + bucket] ?? 0;
        const top = centre - (high * laneHeight) / 2;
        const bottom = centre - (low * laneHeight) / 2;
        context.fillRect(x, Math.min(top, bottom), Math.max(1, width / peaks.buckets), Math.max(1, Math.abs(bottom - top)));
      }
    }
    if (info.frames > 0) {
      const markAt = (frame: number) => (frame / info.frames) * width;
      context.fillStyle = 'rgba(214, 110, 48, 0.25)';
      context.fillRect(markAt(markIn), 0, Math.max(1, markAt(markOut) - markAt(markIn)), height);
      context.fillStyle = '#d66e30';
      context.fillRect(markAt(playhead), 0, 1, height);
    }
  }, [peaks, info, playhead, markIn, markOut]);

  const frameFromEvent = useCallback((event: React.MouseEvent<HTMLCanvasElement>): number => {
    if (!info) return 0;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
    return Math.floor(ratio * info.frames);
  }, [info]);

  const saveRegion = useCallback(async () => {
    if (!info || saving) return;
    setSaving(true);
    setProblem(null);
    try {
      const saved = await catalogSaveRegion(asset.id, {
        name: name.trim() || `${takeStem(asset)} ${(regions.length + 1).toString().padStart(2, '0')}`,
        start_frame: Math.min(markIn, markOut),
        end_frame: Math.max(markIn, markOut),
      });
      const next = [...regions.filter(region => region.id !== saved.id), saved];
      setRegions(next);
      onRegionsChanged?.(next);
      setName('');
    } catch (error) { setProblem(describeError(error)); }
    finally { setSaving(false); }
  }, [asset, info, markIn, markOut, name, regions, saving, onRegionsChanged]);

  const removeRegion = useCallback(async (region: CatalogRegion) => {
    setProblem(null);
    try {
      const remaining = await catalogDeleteRegion(asset.id, region.id);
      setRegions(remaining);
      onRegionsChanged?.(remaining);
    } catch (error) { setProblem(describeError(error)); }
  }, [asset.id, onRegionsChanged]);

  /**
   * Save the take's name, or clear it by saving nothing.
   *
   * Only ever writes a label: the file on disk keeps its name, and the device — which
   * this app never renames anything on — is not involved at all.
   */
  const commitRename = useCallback(async () => {
    if (renaming === null) return;
    setRenameProblem(null);
    try {
      const updated = await catalogLabelAsset(asset.id, renaming);
      onRenamed?.(updated);
      setRenaming(null);
    } catch (error) {
      // Stay in the field with the text intact: retyping a rejected name from scratch
      // is the annoying part, not being told it was rejected.
      setRenameProblem(describeError(error));
    }
  }, [asset.id, renaming, onRenamed]);

  const handleKeys = useCallback(async (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === ' ') {
      event.preventDefault();
      if (playing) stop(); else void play(playhead);
    } else if (event.key.toLowerCase() === 'i') {
      event.preventDefault();
      setMarkIn(await settle(playhead));
    } else if (event.key.toLowerCase() === 'o') {
      event.preventDefault();
      setMarkOut(await settle(playhead));
    }
  }, [playhead, playing, play, stop, settle]);

  const handoffSource = useMemo(
    () => ({ assetId: asset.id, takeName: takeName(asset), sampleRate: info?.sample_rate ?? 0 }),
    [asset, info?.sample_rate],
  );
  const chosenRegions = useMemo(() => regions.filter(region => picked.has(region.id)), [regions, picked]);
  const selectionFrames = Math.abs(markOut - markIn);
  const sampleRate = info?.sample_rate ?? 0;
  const summary = useMemo(() => {
    if (!info) return 'reading this take…';
    return `${info.channels === 1 ? 'mono' : `${info.channels} channels`} · ${(info.sample_rate / 1000).toFixed(1)} khz · ${info.bits}-bit${info.is_float ? ' float' : ''} · ${formatTime(info.frames, info.sample_rate)}`;
  }, [info]);

  return <section className="take-audition" aria-label={`Audition ${takeName(asset)}`} tabIndex={0} onKeyDown={event => void handleKeys(event)}>
    <header>
      <div>
        {renaming === null
          ? <button className="take-rename" onClick={() => { setRenaming(asset.label ?? ''); setRenameProblem(null); }} title="rename this take in your library">
              <strong>{takeName(asset)}</strong>
            </button>
          : <div className="take-rename-edit">
              <label>
                Take name
                <input
                  autoFocus
                  value={renaming}
                  placeholder={asset.original_name}
                  onChange={event => setRenaming(event.target.value)}
                  onKeyDown={event => {
                    // Enter commits and escape abandons. Blur does neither: committing on
                    // blur means the save button's own mousedown commits before its click
                    // arrives, which is how one zone's key ended up on another.
                    if (event.key === 'Enter') { event.preventDefault(); void commitRename(); }
                    if (event.key === 'Escape') { event.preventDefault(); setRenaming(null); setRenameProblem(null); }
                  }}
                />
              </label>
              <button onClick={() => void commitRename()}>save name</button>
              <button onClick={() => { setRenaming(null); setRenameProblem(null); }}>cancel</button>
              <small>
                {asset.label
                  ? `Clear the field to go back to ${asset.original_name}.`
                  : 'The file on disk keeps its name. Nothing on the device is renamed.'}
              </small>
            </div>}
        {renameProblem && <small className="project-error" role="alert">{renameProblem}</small>}
        <small>{summary}</small>
      </div>
      <div className="audition-transport">
        {/* Both stay disabled until the header lands: `play` needs the sample rate to
            size its window, so a click before then did nothing at all and said nothing
            about why. A big take on a slow disk makes that gap visible. */}
        <button disabled={!info} onClick={() => (playing ? stop() : void play(playhead))}>{playing ? 'stop' : 'play from playhead'}</button>
        <button disabled={!info || selectionFrames < 1} onClick={() => void play(Math.min(markIn, markOut), selectionFrames)}>play region</button>
        <span className="audition-hint">space plays · i marks in · o marks out</span>
      </div>
    </header>

    {problem && <p className="project-error" role="alert">{problem}</p>}

    <canvas
      ref={canvas}
      width={900}
      height={140}
      role="img"
      aria-label={`Waveform of ${takeName(asset)}`}
      onClick={event => setPlayhead(frameFromEvent(event))}
      onDoubleClick={event => void play(frameFromEvent(event))}
    />

    <div className="audition-marks">
      {/* Frames in the field, because marking and zero-crossing snapping are
          frame-exact; the time beside it because everything else in this panel — the
          length, the duration, the saved regions — is read in minutes and seconds. */}
      <label>in <input aria-label="Region start in frames" type="number" min={0} max={info?.frames ?? 0} value={markIn}
        onChange={event => setMarkIn(Math.max(0, Number(event.target.value) || 0))} />
        <small>{formatTime(markIn, sampleRate)}</small></label>
      <label>out <input aria-label="Region end in frames" type="number" min={0} max={info?.frames ?? 0} value={markOut}
        onChange={event => setMarkOut(Math.max(0, Number(event.target.value) || 0))} />
        <small>{formatTime(markOut, sampleRate)}</small></label>
      <span>{formatTime(selectionFrames, sampleRate)} selected</span>
      <label className="project-toggle"><input type="checkbox" checked={snap} onChange={event => setSnap(event.target.checked)} /> snap marks to zero crossings</label>
    </div>

    <div className="audition-save">
      <input aria-label="Region name" type="text" value={name} placeholder="region name" onChange={event => setName(event.target.value)} />
      <button className="media-primary" disabled={selectionFrames < 1 || saving} onClick={() => void saveRegion()}>
        {saving ? 'saving…' : 'save region'}
      </button>
    </div>

    {regions.length > 0 && <ul className="audition-regions">
      {[...regions].sort((a, b) => a.start_frame - b.start_frame).map(region => <li key={region.id}>
        <input type="checkbox" aria-label={`Select ${region.name}`} checked={picked.has(region.id)}
          onChange={() => setPicked(current => {
            const next = new Set(current);
            if (next.has(region.id)) next.delete(region.id); else next.add(region.id);
            return next;
          })} />
        <button onClick={() => { setMarkIn(region.start_frame); setMarkOut(region.end_frame); setPlayhead(region.start_frame); }}>
          {region.name}
        </button>
        <code>{formatTime(region.start_frame, sampleRate)} → {formatTime(region.end_frame, sampleRate)}</code>
        <button onClick={() => void play(region.start_frame, region.end_frame - region.start_frame)}>play</button>
        <button onClick={() => void toDrumLab(handoffSource, region)}>to drum lab</button>
        <button onClick={() => void toSampleLab(handoffSource, region)}>to sample lab</button>
        <button onClick={() => void removeRegion(region)}>remove</button>
      </li>)}
    </ul>}

    {chosenRegions.length > 1 && <div className="audition-batch">
      {/* count-ok: the whole block is behind `> 1`, so this can never read "1 regions". */}
      <span>{chosenRegions.length} regions selected</span>
      <button className="media-primary" onClick={() => void sendMany(handoffSource, chosenRegions, 'drum')}>
        send {chosenRegions.length} to drum lab
      </button>
      <button onClick={() => void sendMany(handoffSource, chosenRegions, 'multisample')}>
        send {chosenRegions.length} to sample lab
      </button>
      <button onClick={() => setPicked(new Set())}>clear selection</button>
    </div>}
  </section>;
}
