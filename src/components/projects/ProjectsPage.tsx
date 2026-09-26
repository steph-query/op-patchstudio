import { useState, useMemo, useRef, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { deviceOperation } from '../../utils/deviceOperation';
import { mtpReadFile } from '../../utils/tauriBridge';
import type { TauriProject } from '../../utils/tauriBridge';
import { parseXyPaths, XY_MAGIC } from '../../utils/deviceXyParser';
import type { XyPathRecord } from '../../utils/deviceXyParser';
import { inspectProjectDependencies } from '../../utils/projectDependencies';
import { buildSampleUsage, usage, sharingWith, describeUsage } from '../../utils/sampleUsage';
import type { ScannedProject } from '../../utils/sampleUsage';
import { formatFileSize } from '../../utils/audio';
import { downloadBlob } from '../../utils/patchGeneration';
import './projects.css';
import { BackupPanel } from './BackupPanel';
import { describeError } from '../../utils/describeError';

interface InspectedProject { name: string; size: number; records: XyPathRecord[] }
const statusLabel = { found: 'On device', unresolved: 'Unresolved', 'built-in': 'Built-in', 'not-checked': 'Connect to check' };

export function ProjectsPage() {
  const { state, dispatch } = useAppContext();
  const [project, setProject] = useState<InspectedProject | null>(null);
  const [selectedHandle, setSelectedHandle] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [referenceQuery, setReferenceQuery] = useState('');
  const [unresolvedOnly, setUnresolvedOnly] = useState(false);
  const request = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [sweep, setSweep] = useState<{ done: number; total: number } | null>(null);
  const sweepRequest = useRef(0);

  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    request.current++;
    setLoading(false);
    setProject(null);
    setSelectedHandle(null);
    setError(null);
    // The index describes a particular device's projects. Keeping it across a
    // reconnect or a rescan would answer questions about files that are no longer
    // there, which is worse than having no answer.
    sweepRequest.current++;
    setSweep(null);
  }, [state.tauriDevice, state.tauriProjects]);

  /**
   * The sweep survives leaving this tab, but only for the instrument it was built on.
   *
   * `SET_TAURI_PROJECTS` already clears it on a rescan; this covers the case where a
   * different device is connected without one, so an index is never read against the
   * wrong library.
   */
  const serial = state.tauriDevice?.serial ?? null;
  const usageIndex = state.sampleUsage && state.sampleUsage.serial === serial ? state.sampleUsage : null;

  /**
   * Read every project and invert their references, so each row can say which
   * other projects depend on it.
   *
   * A project that cannot be read is recorded as unread rather than skipped:
   * `sampleUsage` refuses to call anything unused while any project is unaccounted
   * for, and that only works if the failures are passed along.
   */
  async function sweepAllProjects() {
    const id = ++sweepRequest.current;
    const all = state.tauriProjects;
    setSweep({ done: 0, total: all.length });
    const scanned: ScannedProject[] = [];
    // The workspace is inert during a device operation — the tab panel blocks pointer
    // events — so a stop button placed in this panel cannot be pressed. The busy
    // overlay is the one surface above it, and it renders the cancel itself.
    await deviceOperation(async () => {
    for (const item of all) {
      if (id !== sweepRequest.current) return;
      try {
        const data = await mtpReadFile(item.handle);
        if (!XY_MAGIC.every((byte, index) => data[index] === byte)) {
          throw new Error('no recognized OP-XY project header');
        }
        scanned.push({ name: item.name, records: parseXyPaths(data) });
      } catch (err) {
        scanned.push({ name: item.name, records: null, problem: describeError(err) });
      }
      if (id === sweepRequest.current) setSweep({ done: scanned.length, total: all.length });
    }
    if (id !== sweepRequest.current) return;
    dispatch({ type: 'SET_SAMPLE_USAGE', payload: { ...buildSampleUsage(scanned), serial } });
    setSweep(null);
    }, {
      message: `Reading ${all.length} ${all.length === 1 ? 'project' : 'projects'} to see which of them share your samples. Nothing is being written, and stopping is safe.`,
      cancel: async () => cancelSweep(),
      cancelLabel: 'Stop reading',
    });
  }

  /**
   * Stop reading. Forty projects is a minute of waiting, and an operation that long
   * with no way out is not one a person should have to sit through — especially as it
   * is optional information about files they were only considering tidying.
   *
   * Bumping the request id makes the loop abandon at its next check, and the partial
   * result is discarded rather than published: a half-read sweep would report samples
   * as unshared on the strength of projects nobody looked at.
   */
  function cancelSweep() {
    sweepRequest.current++;
    setSweep(null);
  }


  async function inspect(name: string, read: () => Promise<Uint8Array>, handle: number | null) {
    const id = ++request.current;
    setSelectedHandle(handle);
    setLoading(true);
    setError(null);
    setProject(null);
    setReferenceQuery('');
    setUnresolvedOnly(false);
    try {
      const data = await read();
      if (!XY_MAGIC.every((byte, index) => data[index] === byte)) {
        throw new Error('This file does not have a recognized OP-XY project header.');
      }
      const records = parseXyPaths(data);
      if (id === request.current) setProject({ name, size: data.length, records });
    } catch (err) {
      if (id === request.current) setError(describeError(err));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }

  const dependencies = useMemo(() => inspectProjectDependencies(
    project?.records ?? [], state.tauriPresets, state.tauriSamples, !!state.tauriDevice,
  ), [project, state.tauriPresets, state.tauriSamples, state.tauriDevice]);
  const unresolved = dependencies.filter(item => item.status === 'unresolved').length;
  const knownBytes = dependencies.reduce((sum, item) => sum + (item.size ?? 0), 0);
  const knownFiles = dependencies.filter(item => item.size !== null && item.size !== undefined).length;
  const filtered = dependencies.filter(item => (!unresolvedOnly || item.status === 'unresolved') && item.path.toLocaleLowerCase().includes(referenceQuery.toLocaleLowerCase()));
  const projects = state.tauriProjects.filter(item => item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()));

  function exportReport() {
    if (!project) return;
    downloadBlob(new Blob([JSON.stringify({
      project: project.name, inspectedAt: new Date().toISOString(), deviceFirmware: state.tauriDevice?.firmware ?? null,
      scope: 'Heuristic path inspection; not a complete project validation or backup. Unresolved references may be factory content or unsupported paths.',
      dependencies,
      // Without the sweep the report says nothing about sharing, and saying so is
      // the difference between "not used elsewhere" and "not checked".
      sharing: usageIndex
        ? {
            projectsRead: usageIndex.scanned,
            projectsUnread: usageIndex.unread,
            complete: usageIndex.unread.length === 0,
            usedBy: Object.fromEntries(dependencies
              .filter(item => item.type === 'preset-sample' || item.type === 'standalone-sample')
              .map(item => [item.path, describeUsage(usage(usageIndex, item.path), item.path.split('/').pop() ?? item.path)])),
          }
        : 'not checked — run "check all projects" in the inspector to include which projects share each sample',
    }, null, 2)], { type: 'application/json' }), `${project.name.split('/').pop()}.dependencies.json`);
  }

  function selectProject(item: TauriProject) {
    void inspect(item.name, () => mtpReadFile(item.handle), item.handle);
  }

  return (
    <>
    <BackupPanel />
    <div className="project-workspace">
      <aside className="project-sidebar" aria-label="Project browser">
        <div className="project-sidebar-heading"><span className="project-eyebrow">Your projects</span><span>{state.tauriProjects.length}</span></div>
        <button className="project-button project-primary" onClick={() => fileInput.current?.click()}>Open .xy from Mac</button>
        <input ref={fileInput} type="file" accept=".xy" hidden onChange={event => {
          const file = event.target.files?.[0];
          if (file) void inspect(file.name, async () => new Uint8Array(await file.arrayBuffer()), null);
          event.target.value = '';
        }} />
        <label className="project-search">Search projects<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or folder…" /></label>
        <div className="project-list">
          {projects.map(item => <button key={item.handle} className={`project-list-item ${selectedHandle === item.handle ? 'is-selected' : ''}`} aria-pressed={selectedHandle === item.handle} onClick={() => selectProject(item)}>
            <span>{item.name}</span><small>{formatFileSize(item.size)}</small>
          </button>)}
          {projects.length === 0 && <p className="project-muted">{query ? 'No matching projects.' : state.tauriDevice ? 'No projects found. Refresh the device to scan again.' : 'Connect your OP-XY to browse projects, or open a local file.'}</p>}
        </div>
        <p className="project-sidebar-note">Keep the music connected.<br />Inspect sample links before reorganizing your library.</p>
      </aside>
      <section className="project-inspector" aria-label="Project inspector" aria-busy={loading}>
        {loading && <div className="project-empty" role="status">Reading project…</div>}
        {error && <div className="project-error" role="alert"><strong>Could not inspect this project</strong><p>{error}</p><p>Try opening the file again or refreshing the device.</p></div>}
        {!project && !loading && !error && <div className="project-empty"><span className="project-eyebrow">Project inspector</span><h2>A clear view of your sounds.</h2><p>Open a project to see its sample and preset references.<br />Connect your device to check which files are present.</p></div>}
        {project && <>
          <header className="project-title"><div><span className="project-eyebrow">Project inspector</span><h2>{project.name}</h2><p>{formatFileSize(project.size)} · read-only inspection</p></div><button className="project-button" onClick={exportReport}>Export report</button></header>
          <div className="project-metrics">
            {/* Counts and their nouns have to agree; "1 unresolved references" reads as
                a bug in the reader rather than a fact about the project. */}
            <div><strong>{dependencies.length}</strong><span>unique {dependencies.length === 1 ? 'reference' : 'references'}</span></div>
            <div><strong>{state.tauriDevice ? unresolved : '—'}</strong><span>{state.tauriDevice ? `unresolved ${unresolved === 1 ? 'reference' : 'references'}` : 'device not connected'}</span></div>
            <div><strong>{formatFileSize(knownBytes)}</strong><span>matched sample {knownFiles === 1 ? 'file' : 'files'} on disk</span></div>
          </div>
          <p className="project-note">Path inspection is partial. Unresolved references may be factory content or paths this reader does not recognize. File size is not loaded sample memory.{!usageIndex && ' On its own this report does not establish that any file is unused — check every project for that.'}</p>
          <div className="project-usage-panel">
            {sweep
              ? <p role="status">Reading project {sweep.done + 1} of {sweep.total}… stop from the banner above if this is taking too long.</p>
              : usageIndex
                ? <>
                    <p>
                      {usageIndex.unread.length === 0
                        ? `All ${usageIndex.scanned.length} ${usageIndex.scanned.length === 1 ? 'project' : 'projects'} read. Each reference below says which other projects use it.`
                        : `${usageIndex.scanned.length} of ${usageIndex.scanned.length + usageIndex.unread.length} ${usageIndex.scanned.length + usageIndex.unread.length === 1 ? 'project' : 'projects'} read. Sharing is reported where it is known and marked unknown where it is not.`}
                    </p>
                    {usageIndex.unread.length > 0 && <p className="project-muted">
                      {/* `describeError` ends a message with a full stop, which is right on
                          its own and wrong inside brackets — "(no header.)" reads as a typo. */}
                      Could not read: {usageIndex.unread.map(item => `${item.name} (${item.problem.replace(/\.$/, '')})`).join('; ')}.
                      Until those are readable, a sample that looks unused may still be held by one of them.
                    </p>}
                    <button className="project-button" onClick={() => void sweepAllProjects()}>check again</button>
                  </>
                : <>
                    <p>Answering &ldquo;is anything else using this sample?&rdquo; means reading every project. Nothing is written and nothing on the device changes.</p>
                    <button
                      className="project-button"
                      disabled={!state.tauriDevice || state.tauriProjects.length === 0}
                      onClick={() => void sweepAllProjects()}
                    >
                      {state.tauriProjects.length === 1 ? 'check the only project' : state.tauriProjects.length ? `check all ${state.tauriProjects.length} projects` : 'check all projects'}
                    </button>
                    {!state.tauriDevice && <small className="project-muted">Connect the device to check.</small>}
                  </>}
          </div>
          <div className="project-filters"><label className="project-search">Search references<input type="search" value={referenceQuery} onChange={event => setReferenceQuery(event.target.value)} placeholder="Sample, preset or folder…" /></label><label className="project-toggle"><input type="checkbox" checked={unresolvedOnly} onChange={event => setUnresolvedOnly(event.target.checked)} />Unresolved only</label></div>
          <div className="project-reference-list">
            {filtered.map(item => {
              // Only a path that names a file on the device can be looked up; a
              // built-in or a preset shorthand has no file to be shared.
              const shareable = item.type === 'preset-sample' || item.type === 'standalone-sample';
              // `sharingWith` excludes the project on screen and keeps the
              // incomplete-sweep rule: with any project unread, "nothing else uses
              // it" is not a claim this can make.
              const verdict = usageIndex && shareable ? sharingWith(usageIndex, item.path, project?.name ?? '') : null;
              return <div className="project-reference" key={`${item.type}:${item.path}`}>
                <div>
                  <code>{item.path}</code>
                  <small>{item.occurrences} {item.occurrences === 1 ? 'reference' : 'references'}{item.size !== undefined ? ` · ${formatFileSize(item.size)}` : ''}</small>
                  {verdict && <small className="project-usage">{
                    verdict.state === 'referenced'
                      ? `also used by ${verdict.projects.length} other ${verdict.projects.length === 1 ? 'project' : 'projects'}: ${verdict.projects.join(', ')}`
                      : verdict.state === 'unreferenced'
                        ? 'used by this project only'
                        : `sharing unknown — ${verdict.unread.length} ${verdict.unread.length === 1 ? 'project' : 'projects'} could not be read`
                  }</small>}
                </div>
                <span className={`project-status status-${item.status}`}>{statusLabel[item.status]}</span>
              </div>;
            })}
            {filtered.length === 0 && <p className="project-muted">{dependencies.length ? 'No references match these filters.' : 'No recognized paths found. This can be a synth-only project or a format this reader does not support.'}</p>}
          </div>
          <details className="project-backup-help"><summary>What belongs in a complete backup?</summary><p>Keep the project file and its version folder together, plus the presets and samples it uses. Copying all three library folders preserves dependencies that this inspector may not recognize.</p><a href="https://teenage.engineering/guides/op-xy/how-to" target="_blank" rel="noreferrer">OP-XY backup guide ↗</a></details>
        </>}
      </section>
    </div>
    </>
  );
}
