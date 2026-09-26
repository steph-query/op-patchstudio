import { useState, useCallback, useEffect } from 'react';
import type { TauriDevicePreset, TauriPatchJsonRegion } from '../../utils/tauriBridge';
import { mtpReadFile, mtpScanTree } from '../../utils/tauriBridge';
import { deviceOperation } from '../../utils/deviceOperation';
import { useDeviceSamplePreview } from '../../hooks/useDeviceSamplePreview';
import JSZip from 'jszip';
import { downloadBlob } from '../../utils/patchGeneration';
import { describeError } from '../../utils/describeError';

interface DevicePresetDetailProps {
  preset: TauriDevicePreset;
  onClose: () => void;
  onCopy?: (preset: TauriDevicePreset, newName: string) => Promise<void>;
  onDelete?: (preset: TauriDevicePreset) => void;
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)', fontSize: '0.75rem' };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} mb`;
}

const INVALID_NAME_REGEX = /[/\\:*?"<>|]/u;

function validateName(name: string): string | null {
  if (!name.trim()) return 'name cannot be empty';
  if (name.includes('/') || name.includes('\\')) return 'no path separators';
  if (name === '.' || name === '..' || INVALID_NAME_REGEX.test(name) || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return 'avoid path separators and reserved filename characters';
  return null;
}

export function DevicePresetDetail({ preset, onClose, onCopy, onDelete }: DevicePresetDetailProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(preset.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isCopying, setIsCopying] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isEditing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, isEditing]);

  const { playingHandle, previewError, play: handlePlaySample, stop: handleStopSample } = useDeviceSamplePreview(preset);


  const handleCopySubmit = useCallback(async () => {
    if (isCopying) return;
    const name = editName.trim();
    const err = validateName(name);
    if (err) { setNameError(err); return; }
    setIsCopying(true);
    try {
      await onCopy?.(preset, name);
      setIsEditing(false);
    } catch (error) {
      setNameError(describeError(error));
    } finally { setIsCopying(false); }
  }, [editName, preset, onCopy, isCopying]);

  const handleExportZip = useCallback(async () => {
    setIsExporting(true);
    setOperationError(null);
    try {
      await deviceOperation(async () => {
      const zip = new JSZip();
      const tree = await mtpScanTree(['presets']);
      const folder = tree.entries.find(entry => entry.handle === preset.folder_handle && entry.is_directory);
      if (!folder) throw new Error('Preset changed. Refresh the device.');
      const entries = tree.entries.filter(entry => entry.path.startsWith(folder.path + '/') && !entry.is_directory);
      if (entries.reduce((sum, entry) => sum + entry.size, 0) > 128 * 1024 ** 2) throw new Error('This preset is too large for an in-memory ZIP. Use a device backup to export original files.');
      for (const entry of entries) {
        const data = await mtpReadFile(entry.handle);
        if (data.length !== entry.size) throw new Error('Truncated file: ' + entry.path);
        zip.file(entry.path.slice(folder.path.length + 1), data);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, `${preset.name}.preset.zip`);
      }, { message: `Reading every file in ${preset.name} from the device to build a ZIP. Nothing is being written.` });
    } catch (error) {
      setOperationError(describeError(error));
    } finally {
      setIsExporting(false);
    }
  }, [preset]);

  // Build region map
  const regionMap = new Map<string, TauriPatchJsonRegion>();
  if (preset.patch_json?.regions) {
    for (const region of preset.patch_json.regions) {
      if (region.sample) regionMap.set(region.sample, region);
    }
  }

  const regionCount = preset.patch_json?.regions?.length ?? 0;

  return (
    <div style={{ padding: '1.25rem', height: '100%', overflowY: 'auto' }}>
      {previewError && <p role="alert">{previewError}</p>}
      {operationError && <p role="alert">{operationError}</p>}
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div style={{ flex: 1 }}>
          {isEditing ? (
            <div>
              <input
                type="text"
                value={editName}
                onChange={(e) => { setEditName(e.target.value); setNameError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCopySubmit();
                  if (e.key === 'Escape') { setIsEditing(false); setEditName(preset.name); }
                }}
                disabled={isCopying}
                aria-label="New preset copy name"
                autoFocus
                style={{
                  fontSize: '1.1rem',
                  fontWeight: '500',
                  fontFamily: 'var(--font-ui)',
                  background: 'var(--color-surface-secondary)',
                  border: '1px solid #e0e0e0',
                  borderRadius: '2px',
                  color: 'var(--color-text-primary)',
                  padding: '0.25rem 0.5rem',
                  width: '100%',
                  outline: 'none',
                }}
              />
              <p style={{ fontSize: '0.7rem', marginTop: '8px' }}>Press Enter to create a verified copy. Original projects stay linked to the original preset.</p>
              <button disabled={isCopying} onClick={() => void handleCopySubmit()}>{isCopying ? 'Copying…' : 'Create copy'}</button>
              {nameError && <div role="alert" style={{ color: '#da1e28', fontSize: '0.7rem', marginTop: '0.25rem' }}>{nameError}</div>}
            </div>
          ) : (
            <h2
              style={{ margin: 0, fontSize: '1.1rem', fontWeight: '500', color: 'var(--color-text-primary)', cursor: 'default' }}
            >
              {preset.name}
            </h2>
          )}
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', fontSize: '1rem', padding: '4px' }}
        >
          &times;
        </button>
      </div>

      {/* Metadata */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>category</div>
          <div style={{ ...mono, color: 'var(--color-text-primary)' }}>{preset.category}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>type</div>
          <div style={{ ...mono, color: 'var(--color-text-primary)' }}>{preset.preset_type}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>regions</div>
          <div style={{ ...mono, color: 'var(--color-text-primary)' }}>{regionCount}</div>
        </div>
        <div>
          <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>size</div>
          <div style={{ ...mono, color: 'var(--color-text-primary)' }}>{formatSize(preset.total_size)}</div>
        </div>
      </div>

      {/* Samples table */}
      <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
        samples ({preset.samples.length})
      </div>
      <div style={{ border: `1px solid #e0e0e0`, borderRadius: '2px', marginBottom: '1.25rem' }}>
        {/* Header */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '28px minmax(120px, 1fr) 60px 60px 50px',
          padding: '0.3rem 0.5rem',
          fontSize: '0.6rem',
          fontWeight: '600',
          color: 'var(--color-text-tertiary)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          borderBottom: '1px solid #e0e0e0',
          background: 'var(--color-surface-secondary)',
        }}>
          <span></span>
          <span>file</span>
          <span style={{ textAlign: 'right' }}>size</span>
          <span style={{ textAlign: 'center' }}>mode</span>
          <span style={{ textAlign: 'center' }}>key</span>
        </div>
        {preset.samples.map(sample => {
          const region = regionMap.get(sample.name);
          const isPlaying = playingHandle === sample.handle;
          return (
            <div
              key={sample.handle}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px minmax(120px, 1fr) 60px 60px 50px',
                padding: '0.25rem 0.5rem',
                fontSize: '0.75rem',
                color: 'var(--color-text-tertiary)',
                borderBottom: '1px solid #e0e0e0',
                alignItems: 'center',
                minHeight: '30px',
              }}
            >
              <button
                onClick={() => isPlaying ? handleStopSample() : handlePlaySample(sample)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: isPlaying ? '#24a148' : 'var(--color-text-tertiary)', fontSize: '0.65rem', padding: '2px' }}
              >
                {isPlaying ? '\u25A0' : '\u25B6'}
              </button>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...mono }}>{sample.name}</span>
              <span style={{ textAlign: 'right', ...mono }}>{formatSize(sample.size)}</span>
              <span style={{ textAlign: 'center', ...mono }}>{region?.playmode || '-'}</span>
              <span style={{ textAlign: 'center', ...mono }}>{region?.pitch_keycenter !== undefined ? `${region.pitch_keycenter}` : '-'}</span>
            </div>
          );
        })}
        {preset.samples.length === 0 && (
          <div style={{ padding: '0.75rem', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
            no samples
          </div>
        )}
      </div>

      {/* Actions */}
      {onCopy && <button onClick={() => { setEditName(`${preset.name} copy`); setNameError(null); setIsEditing(true); }} disabled={isCopying} style={{ marginBottom: '12px' }}>Make a copy…</button>}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          onClick={handleExportZip}
          disabled={isExporting}
          style={{
            background: 'none',
            border: '1px solid #e0e0e0',
            borderRadius: '2px',
            color: 'var(--color-text-primary)',
            fontSize: '0.75rem',
            fontFamily: 'var(--font-ui)',
            padding: '0.35rem 0.75rem',
            cursor: 'pointer',
          }}
        >
          {isExporting ? 'exporting...' : 'download zip'}
        </button>
        {/* The reason there is no delete button, next to where one would be — it used
            to open the panel, so the first thing read about a preset was a sentence
            about a feature that is not here. */}
        {!onDelete && <p style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', lineHeight: 1.6, marginTop: '0.75rem' }}>
          Removing a preset from the device is disabled while project dependency coverage is incomplete. Making a copy preserves every existing link.
        </p>}
        {onDelete && (
          <>
            {showDeleteConfirm ? (
              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#da1e28' }}>delete {preset.name}?</span>
                <button
                  onClick={() => { onDelete(preset); setShowDeleteConfirm(false); }}
                  style={{ background: '#da1e28', border: 'none', borderRadius: '2px', color: 'var(--color-surface-primary)', fontSize: '0.7rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
                >
                  confirm
                </button>
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  style={{ background: 'none', border: '1px solid #e0e0e0', borderRadius: '2px', color: 'var(--color-text-tertiary)', fontSize: '0.7rem', padding: '0.25rem 0.5rem', cursor: 'pointer' }}
                >
                  cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                style={{
                  background: 'none',
                  border: '1px solid #e0e0e0',
                  borderRadius: '2px',
                  color: '#da1e28',
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-ui)',
                  padding: '0.35rem 0.75rem',
                  cursor: 'pointer',
                }}
              >
                delete from device
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
