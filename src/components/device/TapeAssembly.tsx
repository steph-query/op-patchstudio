import { useCallback, useMemo, useRef, useState } from 'react';
import { describeTape, planTape, TAPE_BIT_DEPTH, TAPE_CHANNELS, TAPE_SAMPLE_RATE, TAPE_TRACKS } from '../../utils/op1Tape';
import type { TapeCandidate } from '../../utils/op1Tape';
import { readAudioMetadata } from '../../utils/audioFormats';
import { audioBufferToAiff } from '../../utils/aiffExport';
import { pickFolder, saveFileToFolder } from '../../utils/tauriBridge';
import { formatFileSize } from '../../utils/audio';
import { describeError, shortenHomePath } from '../../utils/describeError';

interface Loaded {
  file: File;
  candidate: TapeCandidate;
  audioBuffer: AudioBuffer | null;
}

/**
 * Build an OP-1 field tape from finished audio.
 *
 * Up to four files become `track_1.aif` … `track_4.aif` at the format the
 * field's tape tracks use, written to a folder on the Mac. There is no device
 * write on purpose: a tape is a recording the user made, replacing one is
 * destructive, and the format is not vendor-documented. Copying the folder in
 * is one drag, and it stays the user's decision.
 */
export function TapeAssembly() {
  const [loaded, setLoaded] = useState<Loaded[]>([]);
  const [reading, setReading] = useState(0);
  const [result, setResult] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);

  const addFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setResult(null);
    setProblem(null);
    setReading(count => count + files.length);
    for (const file of files) {
      let entry: Loaded = { file, candidate: { name: file.name }, audioBuffer: null };
      try {
        const metadata = await readAudioMetadata(file);
        entry = {
          file,
          audioBuffer: metadata.audioBuffer ?? null,
          candidate: {
            name: file.name,
            durationSeconds: metadata.duration > 0 ? metadata.duration : undefined,
            sampleRate: metadata.sampleRate || undefined,
            bitDepth: metadata.bitDepth || undefined,
            channels: metadata.channels || undefined,
          },
        };
      } catch {
        // Keep the file visible with unknown details; the plan will say so.
      }
      setLoaded(current => (current.length >= TAPE_TRACKS ? current : [...current, entry]));
      setReading(count => count - 1);
    }
  }, []);

  const plan = useMemo(() => planTape(loaded.map(item => item.candidate)), [loaded]);

  const write = useCallback(async () => {
    if (busy.current || !plan.used.length) return;
    busy.current = true;
    setWriting(true);
    setProblem(null);
    setResult(null);
    let written = 0;
    try {
      const destination = await pickFolder('Choose where to save the tape tracks');
      if (!destination) return;
      for (const track of plan.used) {
        const entry = loaded.find(item => item.candidate === track.source);
        if (!entry) continue;
        if (!entry.audioBuffer) {
          throw new Error(`${entry.file.name} could not be read as audio on this Mac, so track ${track.track} was not written.`);
        }
        const blob = await audioBufferToAiff(entry.audioBuffer, {
          bitDepth: TAPE_BIT_DEPTH,
          sampleRate: TAPE_SAMPLE_RATE,
          channels: TAPE_CHANNELS,
        });
        await saveFileToFolder(track.fileName, new Uint8Array(await blob.arrayBuffer()), destination);
        written++;
      }
      setResult(`${written} ${written === 1 ? 'track' : 'tracks'} written to ${shortenHomePath(destination)}. Put your OP-1 field in transfer mode and copy them into its tape folder yourself.`);
    } catch (error) {
      setProblem(`${describeError(error)}${written ? ` ${written} ${written === 1 ? 'track was' : 'tracks were'} already saved; existing files were left alone.` : ''}`);
    } finally {
      busy.current = false;
      setWriting(false);
    }
  }, [plan, loaded]);

  return <section className="tape-assembly" aria-label="Build a tape">
    <header className="device-media-hero">
      <div>
        <span>op-1 field tape</span>
        <h2>Build a tape</h2>
        <p>{describeTape(plan)}</p>
      </div>
      <button className="media-primary" disabled={!plan.used.length || writing || !!reading} onClick={() => void write()}>
        {writing ? 'writing…' : `export ${plan.used.length || ''} ${plan.used.length === 1 ? 'track' : 'tracks'}`}
      </button>
    </header>

    <div className="media-toolbar">
      <button disabled={loaded.length >= TAPE_TRACKS} onClick={() => fileInput.current?.click()}>
        {loaded.length >= TAPE_TRACKS ? 'all four tracks filled' : 'choose files…'}
      </button>
      <input ref={fileInput} type="file" multiple hidden accept=".wav,.aif,.aiff,audio/*"
        onChange={event => { void addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      {loaded.length > 0 && <button onClick={() => { setLoaded([]); setResult(null); setProblem(null); }}>clear</button>}
    </div>

    {reading > 0 && <p className="media-feedback" role="status">Reading {reading} {reading === 1 ? 'file' : 'files'}…</p>}
    {plan.notes.map(note => <p key={note} className="media-feedback">{note}</p>)}
    {result && <p className="media-feedback" role="status">{result}</p>}
    {problem && <p className="project-error" role="alert">{problem}</p>}

    <div className="install-rows">
      {plan.tracks.map(track => <div className={'media-row install-row' + (track.blocked ? ' status-blocked' : '')} key={track.track}>
        <div className="media-name">
          <strong>{track.fileName}</strong>
          {track.source ? <>
            <small>{track.source.name}{track.source.durationSeconds !== undefined ? ` · ${Math.floor(track.source.durationSeconds / 60)}:${String(Math.round(track.source.durationSeconds % 60)).padStart(2, '0')}` : ''}</small>
            {track.conversions.length > 0 && <small>{track.conversions.join(' · ')}</small>}
            {track.warnings.map(warning => <small key={warning} className="install-warning">{warning}</small>)}
            {track.blocked && <small className="install-blocked">{track.blocked}</small>}
          </> : <small className="project-muted">empty — not written, so anything in this slot on the device stays</small>}
        </div>
        <code>{track.source ? formatFileSize(loaded.find(item => item.candidate === track.source)?.file.size ?? 0) : '—'}</code>
      </div>)}
    </div>
  </section>;
}
