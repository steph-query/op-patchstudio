import { useEffect, useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { createDeviceBackup, verifyDeviceBackup, isTauriAvailable, previewDeviceRestore, restoreDeviceBackup } from '../../utils/tauriBridge';
import type { RestorePreview } from '../../utils/tauriBridge';
import type { BackupResult } from '../../utils/tauriBridge';
import { formatFileSize } from '../../utils/audio';
import { detectDeviceKind, getDeviceProfile } from '../../utils/teDevices';
import { deviceOperation } from '../../utils/deviceOperation';
import { cancelRestorePreview } from '../../utils/tauriBridge';
import { describeError } from '../../utils/describeError';

export function BackupPanel() {
  const { state } = useAppContext();
  const [busy, setBusy] = useState<'create' | 'verify' | null>(null);
  const [result, setResult] = useState<BackupResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  useEffect(() => { setPreview(null); setResult(null); setRestoreResult(null); }, [state.tauriDevice]);
  const running = useRef(false);
  const profile = state.tauriDevice ? getDeviceProfile(state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model)) : null;
  if (!isTauriAvailable()) return null;

  async function run(action: 'create' | 'verify') {
    if (running.current) return;
    running.current = true;
    setBusy(action);
    setError(null);
    setResult(null);
    setPreview(null);
    setRestoreResult(null);
    try {
      setResult(await (action === 'create' ? createDeviceBackup() : verifyDeviceBackup()));
    } catch (err) {
      setError(describeError(err));
    } finally {
      running.current = false;
      setBusy(null);
    }
  }

  async function restore(confirm: boolean) {
    if (running.current) return;
    running.current = true; setBusy('verify'); setError(null); setRestoreResult(null);
    try {
      if (!confirm) setPreview(await deviceOperation(() => previewDeviceRestore(), { message: 'Comparing backup and device checksums. Large libraries can take a long time; no files are being written.', cancel: cancelRestorePreview, cancelLabel: 'Cancel preview' }));
      else if (preview) {
        const result = await restoreDeviceBackup(preview.token);
        setPreview(null);
        setRestoreResult(`${result.copied} files restored and verified · ${result.skipped} identical files preserved. Refresh the device to see the recovered library.`);
      }
    } catch (error) { setError(describeError(error)); setPreview(null); }
    finally { running.current = false; setBusy(null); }
  }

  return <section className="backup-panel" aria-label="Device backups" aria-busy={!!busy}>
    <div><h2>Back up your {profile?.label ?? 'device'} library</h2><p>Preserve the complete device library together. Each backup is saved in a new folder and checked against file checksums.</p></div>
    <div className="backup-actions">
      <button className="project-button project-primary" disabled={!!busy || !state.tauriDevice} onClick={() => void run('create')}>Create backup…</button>
      <button className="project-button" disabled={!!busy} onClick={() => void run('verify')}>Verify backup…</button>
      <button className="project-button" disabled={!!busy || !state.tauriDevice} onClick={() => void restore(false)}>Preview restore…</button>
    </div>
    {!state.tauriDevice && <p className="project-muted">Connect a device to create a backup. Existing backups can be verified offline.</p>}
    {busy && <p role="status">{busy === 'create' ? `Copying and verifying your library. Keep your ${profile?.label ?? 'device'} connected; large libraries can take several minutes.` : 'Checking every file in the backup…'}</p>}
    {error && <p className="project-error" role="alert">{error}</p>}
    {restoreResult && <p role="status">{restoreResult}</p>}
    {preview && <div className="restore-preview">
      <h3>Restore missing files</h3><p>Backup: {preview.model} · serial {preview.serial || 'unknown'}<br />Destination: {state.tauriDevice?.model} · serial {state.tauriDevice?.serial || 'unknown'}</p>
      <p>Existing identical files are skipped. Conflicting files block the entire restore; nothing is overwritten. The backup and destination are checked again before writing.</p>
      <p>{preview.entries.filter(entry => entry.status === 'missing').length} missing · {preview.entries.filter(entry => entry.status === 'identical').length} identical · {preview.entries.filter(entry => entry.status === 'conflict').length} conflicts · {formatFileSize(preview.required_bytes)} required</p>
      <div style={{ maxHeight: 220, overflow: 'auto' }}>{preview.entries.map(entry => <p key={entry.path}><code>{entry.path}</code> — {entry.status}</p>)}</div>
      {preview.required_bytes > preview.free_bytes && <p role="alert">Not enough free device storage.</p>}
      <button className="project-button project-primary" disabled={!!busy || preview.entries.some(entry => entry.status === 'conflict') || preview.required_bytes > preview.free_bytes || !preview.entries.some(entry => entry.status === 'missing')} onClick={() => void restore(true)}>Restore missing files and verify</button>
      <button className="project-button" disabled={!!busy} onClick={() => setPreview(null)}>Cancel</button>
    </div>}
    {result && <div role="status"><strong>Backup verified</strong><p>{result.files} files · {formatFileSize(result.bytes)} · recorded firmware {result.firmware || 'unknown'}</p><p className="backup-path">{result.path}</p></div>}
  </section>;
}
