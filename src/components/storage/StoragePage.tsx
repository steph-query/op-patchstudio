import { useMemo, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { BackupPanel } from '../projects/BackupPanel';
import { analyzeRedundancy, buildRedundancyReport } from '../../utils/deviceRedundancy';
import { downloadBlob } from '../../utils/patchGeneration';
import { formatBytes, formatGigabytes } from '../../utils/formatBytes';

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };

function StorageBar({ used, total, color = 'var(--color-text-primary)' }: { used: number; total: number; color?: string }) {
  const pct = total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
  return (
    <div style={{ width: '100%', height: '6px', background: 'var(--color-border-subtle)', borderRadius: '1px', overflow: 'hidden' }}>
      <div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? '#da1e28' : color, borderRadius: '1px', transition: 'width 0.3s ease' }} />
    </div>
  );
}

export function StoragePage() {
  const { state } = useAppContext();
  const { tauriPresets, tauriStorageInfo } = state;
  const [showCopies, setShowCopies] = useState(false);

  // Answers "what is redundant here, and what still points at it" without proposing a deletion.
  const redundancy = useMemo(
    () => analyzeRedundancy(tauriPresets, state.tauriSamples ?? [], []),
    [tauriPresets, state.tauriSamples],
  );

  function exportRedundancyReport() {
    const report = buildRedundancyReport(redundancy, state.tauriDevice);
    downloadBlob(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }), 'device-space-report.json');
  }

  const stats = useMemo(() => {
    const byCategory: Record<string, { count: number; size: number }> = {};
    let totalPresetSize = 0;

    for (const preset of tauriPresets) {
      totalPresetSize += preset.total_size;
      if (!byCategory[preset.category]) byCategory[preset.category] = { count: 0, size: 0 };
      byCategory[preset.category].count++;
      byCategory[preset.category].size += preset.total_size;
    }

    const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1].size - a[1].size);

    const largestPresets = [...tauriPresets]
      .sort((a, b) => b.total_size - a.total_size)
      .slice(0, 10);

    if (!tauriPresets.length) {
      for (const entry of state.tauriTreeEntries ?? []) {
        if (entry.is_directory) continue;
        const root = entry.path.split('/')[0]?.toLowerCase() || 'other';
        if (!byCategory[root]) byCategory[root] = { count: 0, size: 0 };
        byCategory[root].count++;
        byCategory[root].size += entry.size;
        totalPresetSize += entry.size;
      }
      sortedCategories.push(...Object.entries(byCategory).sort((a, b) => b[1].size - a[1].size));
    }
    return { totalPresetSize, sortedCategories, largestPresets, totalPresets: tauriPresets.length };
  }, [tauriPresets, state.tauriTreeEntries]);

  if (!tauriStorageInfo) {
    return (
      <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>
        connect a device to view storage information
      </div>
    );
  }

  const used = Math.max(0, tauriStorageInfo.capacity - tauriStorageInfo.freeSpace);
  const usedPct = tauriStorageInfo.capacity > 0 ? (used / tauriStorageInfo.capacity) * 100 : 0;

  return (
    <><BackupPanel /><div style={{ padding: '1.5rem', maxWidth: '700px' }}>
      {/* Main storage overview */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          device storage
        </div>
        <div style={{ marginBottom: '0.5rem' }}>
          <StorageBar used={used} total={tauriStorageInfo.capacity} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ ...mono, fontSize: '0.8rem', color: 'var(--color-text-primary)' }}>
            {formatGigabytes(used)} gb used
          </span>
          <span style={{ ...mono, fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
            {formatGigabytes(tauriStorageInfo.freeSpace)} gb free / {formatGigabytes(tauriStorageInfo.capacity)} gb
          </span>
        </div>
        <div style={{ ...mono, fontSize: '0.75rem', color: usedPct > 90 ? '#da1e28' : 'var(--color-text-tertiary)', marginTop: '0.25rem' }}>
          {usedPct.toFixed(0)}% used
        </div>
      </div>

      {/* Breakdown by category */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
          {stats.totalPresets ? `presets by category (${stats.totalPresets} total)` : 'library by folder'}
        </div>
        {stats.sortedCategories.map(([category, data]) => (
          <div key={category} style={{ marginBottom: '0.6rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.2rem' }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--color-text-primary)' }}>{category}</span>
              <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                {data.count} {stats.totalPresets ? 'presets' : 'files'} · {formatBytes(data.size)}
              </span>
            </div>
            <StorageBar used={data.size} total={stats.totalPresetSize} color="#999" />
          </div>
        ))}
      </div>

      {/* Largest presets */}
      {stats.largestPresets.length > 0 && <div>
        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
          largest presets
        </div>
        <div style={{ border: '1px solid #e0e0e0', borderRadius: '2px' }}>
          {stats.largestPresets.map((preset, i) => (
            <div
              key={preset.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '24px 1fr 60px 60px',
                padding: '0.35rem 0.5rem',
                fontSize: '0.75rem',
                borderBottom: i < stats.largestPresets.length - 1 ? '1px solid #e0e0e0' : 'none',
                alignItems: 'center',
              }}
            >
              <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>{i + 1}</span>
              <span style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {preset.name}
              </span>
              <span style={{ ...mono, fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                {preset.category}
              </span>
              <span style={{ ...mono, fontSize: '0.7rem', color: 'var(--color-text-primary)', textAlign: 'right' }}>
                {formatBytes(preset.total_size)}
              </span>
            </div>
          ))}
        </div>
      </div>}

      {(redundancy.totals.duplicateGroups > 0 || redundancy.totals.unreferencedCount > 0) && (
        <section aria-label="Space review" style={{ marginTop: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', marginBottom: '0.5rem' }}>
            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              where the space goes twice
            </div>
            <button className="project-button" onClick={exportRedundancyReport}>Export report</button>
          </div>

          {redundancy.totals.duplicateGroups > 0 && <p style={{ fontSize: '0.8rem', lineHeight: 1.7 }}>
            {redundancy.totals.duplicateGroups} {redundancy.totals.duplicateGroups === 1 ? 'file appears' : 'files appear'} in more than one place,
            using {formatBytes(redundancy.totals.reclaimableBytes)} beyond a single copy of each.{' '}
            <button className="project-button" aria-expanded={showCopies} onClick={() => setShowCopies(value => !value)}>
              {showCopies ? 'Hide copies' : 'Show copies'}
            </button>
          </p>}

          {showCopies && <div className="install-rows">
            {redundancy.duplicates.slice(0, 50).map(group => (
              <div className="media-row" key={group.name + group.size} style={{ alignItems: 'start' }}>
                <div className="media-name">
                  <strong>{group.name}</strong>
                  {group.copies.map(copy => <small key={copy.path}>{copy.path} · {copy.role}</small>)}
                </div>
                <code>{formatBytes(group.reclaimable)}</code>
              </div>
            ))}
          </div>}

          {redundancy.totals.unreferencedCount > 0 && <p style={{ fontSize: '0.8rem', lineHeight: 1.7 }}>
            {redundancy.totals.unreferencedCount} library {redundancy.totals.unreferencedCount === 1 ? 'sample is' : 'samples are'} not named by any preset this app can read
            ({formatBytes(redundancy.totals.unreferencedBytes)}). That is not the same as unused.
          </p>}

          <ul style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', lineHeight: 1.7, paddingLeft: '1.1rem' }}>
            {redundancy.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}
          </ul>
        </section>
      )}
    </div></>
  );
}
