import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  TauriDevicePreset,
  TauriPresetSample,
  TauriPatchJsonRegion,
} from '../../utils/tauriBridge';
import { useDeviceSamplePreview } from '../../hooks/useDeviceSamplePreview';

type ViewMode = 'list' | 'grid';

interface DevicePresetTableProps {
  presets: TauriDevicePreset[];
  onSelectPreset: (preset: TauriDevicePreset) => void;
  selectedPresetId: string | null;
}

const mono: React.CSSProperties = { fontFamily: 'var(--font-mono)' };
const label: React.CSSProperties = { fontSize: '0.55rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600, ...mono };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} b`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kb`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} mb`;
}

function PresetSampleRow({
  sample,
  regionInfo,
  isPlaying,
  onPlay,
  onStop,
}: {
  sample: TauriPresetSample;
  regionInfo?: { playmode?: string; reverse?: boolean; transpose?: number };
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
}) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '28px minmax(120px, 1fr) 60px 60px 60px',
      alignItems: 'center',
      padding: '0.2rem 0.75rem',
      fontSize: '0.75rem',
      color: 'var(--color-text-tertiary)',
      borderBottom: '1px solid #e0e0e0',
      minHeight: '30px',
    }}>
      <button
        onClick={isPlaying ? onStop : onPlay}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: isPlaying ? '#24a148' : 'var(--color-text-tertiary)', fontSize: '0.65rem', padding: '2px' }}
        title={isPlaying ? 'stop' : 'play'}
      >
        {isPlaying ? '\u25A0' : '\u25B6'}
      </button>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...mono, fontSize: '0.7rem' }}>{sample.name}</span>
      <span style={{ textAlign: 'right', ...mono, fontSize: '0.7rem' }}>{formatSize(sample.size)}</span>
      <span style={{ textAlign: 'center', ...mono, fontSize: '0.7rem' }}>{regionInfo?.playmode || '-'}</span>
      <span style={{ textAlign: 'center', ...mono, fontSize: '0.7rem' }}>{regionInfo?.reverse ? 'rev' : '-'}</span>
    </div>
  );
}

function PresetCard({
  preset,
  isSelected,
  onClick,
  onPlayFirst,
  isPlaying,
}: {
  preset: TauriDevicePreset;
  isSelected: boolean;
  onClick: () => void;
  onPlayFirst: () => void;
  isPlaying: boolean;
}) {
  return (
    <div
      onClick={onClick}
      style={{
        border: `1px solid ${isSelected ? 'var(--color-text-primary)' : 'var(--color-border-subtle)'}`,
        borderRadius: '2px',
        padding: '0.75rem',
        cursor: 'pointer',
        background: isSelected ? 'var(--color-surface-secondary)' : 'var(--color-surface-primary)',
        transition: 'border-color 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.4rem',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontWeight: '500', fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>
          {preset.name}
        </span>
        {/* A preset folder can hold a patch.json and no audio. The triangle used to
            render anyway, with a pointer cursor, and clicking it did nothing. */}
        {preset.samples.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); onPlayFirst(); }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: isPlaying ? '#24a148' : 'var(--color-text-tertiary)', fontSize: '0.7rem', padding: '2px' }}
            title="play first sample"
          >
            {isPlaying ? '\u25A0' : '\u25B6'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <span style={{
          fontSize: '0.65rem',
          padding: '0.1rem 0.35rem',
          borderRadius: '2px',
          background: preset.preset_type === 'drum' ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.06)',
          color: 'var(--color-text-tertiary)',
          ...mono,
        }}>
          {preset.preset_type}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', ...mono }}>
          {preset.category}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', ...mono }}>
          {preset.samples.length} {preset.samples.length === 1 ? 'sample' : 'samples'}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', ...mono }}>
          {formatSize(preset.total_size)}
        </span>
      </div>
    </div>
  );
}

export function DevicePresetTable({ presets, onSelectPreset, selectedPresetId }: DevicePresetTableProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [expandedPresetId, setExpandedPresetId] = useState<string | null>(null);
  const [hoveredRow, setHoveredRow] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [userOnly, setUserOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const categories = ['all', ...Array.from(new Set(presets.map(p => p.category))).sort()];

  const filteredPresets = presets.filter(p => {
    if (userOnly && p.samples.length === 0) return false;
    if (filterCategory !== 'all' && p.category !== filterCategory) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q);
    }
    return true;
  });

  const toggleExpand = useCallback((presetId: string) => {
    setExpandedPresetId(prev => prev === presetId ? null : presetId);
  }, []);

  const { playingHandle, previewError, play: handlePlaySample, stop: handleStopSample } = useDeviceSamplePreview(presets);


  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture when typing in search
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === 'Escape') {
          (e.target as HTMLElement).blur();
          e.preventDefault();
        }
        return;
      }

      const len = filteredPresets.length;
      if (len === 0) return;

      switch (e.key) {
        case 'ArrowDown':
        case 'j': {
          e.preventDefault();
          const next = Math.min(focusedIndex + 1, len - 1);
          setFocusedIndex(next);
          // Scroll focused row into view
          const row = containerRef.current?.querySelector(`[data-preset-index="${next}"]`);
          row?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'ArrowUp':
        case 'k': {
          e.preventDefault();
          const prev = Math.max(focusedIndex - 1, 0);
          setFocusedIndex(prev);
          const row = containerRef.current?.querySelector(`[data-preset-index="${prev}"]`);
          row?.scrollIntoView({ block: 'nearest' });
          break;
        }
        case 'Enter':
        case 'ArrowRight': {
          e.preventDefault();
          const preset = filteredPresets[focusedIndex];
          if (preset) {
            onSelectPreset(preset);
            if (e.key === 'Enter') toggleExpand(preset.id);
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          setExpandedPresetId(null);
          break;
        }
        case ' ': {
          e.preventDefault();
          const preset = filteredPresets[focusedIndex];
          if (!preset) break;
          const firstSample = preset.samples[0];
          // Nothing to play: a preset with no audio has no play button either.
          if (!firstSample) break;
          if (playingHandle === firstSample.handle) {
            handleStopSample();
          } else {
            handlePlaySample(firstSample);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          if (playingHandle !== null) {
            handleStopSample();
          }
          break;
        }
        case '/': {
          e.preventDefault();
          searchInputRef.current?.focus();
          break;
        }
        case 'g': {
          setViewMode(prev => prev === 'list' ? 'grid' : 'list');
          break;
        }
        case 'u': {
          setUserOnly(prev => !prev);
          break;
        }
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [filteredPresets, focusedIndex, playingHandle, handlePlaySample, handleStopSample, onSelectPreset, toggleExpand]);

  // Reset focus when filter changes
  useEffect(() => {
    setFocusedIndex(0);
  }, [filterCategory, searchQuery, userOnly]);

  return (
    <div ref={containerRef} tabIndex={0} style={{ outline: 'none' }}>
      {previewError && <p role="alert">{previewError}</p>}
      {/* Toolbar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem 0.75rem',
        borderBottom: '1px solid #e0e0e0',
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: '0', flex: 1, flexWrap: 'wrap' }}>
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              style={{
                padding: '0.2rem 0.6rem',
                border: 'none',
                borderBottom: filterCategory === cat ? '2px solid #000' : '2px solid transparent',
                background: 'transparent',
                color: filterCategory === cat ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                ...mono,
                fontSize: '0.6rem',
                fontWeight: filterCategory === cat ? 600 : 400,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          onClick={() => setUserOnly(prev => !prev)}
          style={{
            padding: '0.2rem 0.5rem',
            border: userOnly ? '1px solid #000' : '1px solid #e0e0e0',
            background: userOnly ? 'var(--color-text-primary)' : 'transparent',
            color: userOnly ? 'var(--color-surface-primary)' : 'var(--color-text-tertiary)',
            ...mono,
            fontSize: '0.6rem',
            letterSpacing: '0.04em',
            cursor: 'pointer',
          }}
          title="show only user-created presets (with samples)"
        >
          user only
        </button>

        <input
          ref={searchInputRef}
          type="text"
          placeholder="search (/)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '120px',
            padding: '0.2rem 0.4rem',
            border: '1px solid #e0e0e0',
            background: 'transparent',
            color: 'var(--color-text-primary)',
            ...mono,
            fontSize: '0.65rem',
            outline: 'none',
          }}
        />

        <div style={{ display: 'flex', border: '1px solid #e0e0e0' }}>
          <button
            onClick={() => setViewMode('list')}
            style={{ background: viewMode === 'list' ? 'var(--color-text-primary)' : 'transparent', color: viewMode === 'list' ? 'var(--color-surface-primary)' : 'var(--color-text-tertiary)', border: 'none', padding: '2px 6px', ...mono, fontSize: '0.6rem', cursor: 'pointer' }}
            title="list view"
          >&#9776;</button>
          <button
            onClick={() => setViewMode('grid')}
            style={{ background: viewMode === 'grid' ? 'var(--color-text-primary)' : 'transparent', color: viewMode === 'grid' ? 'var(--color-surface-primary)' : 'var(--color-text-tertiary)', border: 'none', borderLeft: '1px solid #e0e0e0', padding: '2px 6px', ...mono, fontSize: '0.6rem', cursor: 'pointer' }}
            title="grid view"
          >&#9707;</button>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '0.5rem',
          padding: '0.75rem',
        }}>
          {filteredPresets.map(preset => {
            const firstSample = preset.samples[0];
            const isPlayingFirst = firstSample ? playingHandle === firstSample.handle : false;
            return (
              <PresetCard
                key={preset.id}
                preset={preset}
                isSelected={selectedPresetId === preset.id}
                onClick={() => onSelectPreset(preset)}
                onPlayFirst={() => {
                  if (isPlayingFirst) handleStopSample();
                  else if (firstSample) handlePlaySample(firstSample);
                }}
                isPlaying={isPlayingFirst}
              />
            );
          })}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <>
          {/* Table header */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '28px minmax(180px, 1fr) 60px 80px 60px 50px',
            padding: '0.4rem 0.75rem',
            borderBottom: '1px solid #e0e0e0',
            ...label,
          }}>
            <span></span>
            <span>name</span>
            <span style={{ textAlign: 'center' }}>type</span>
            <span style={{ textAlign: 'right' }}>samples</span>
            <span style={{ textAlign: 'right' }}>size</span>
            <span style={{ textAlign: 'center' }}>cat</span>
          </div>

          {filteredPresets.map((preset, index) => {
            const isExpanded = expandedPresetId === preset.id;
            const isSelected = selectedPresetId === preset.id;
            const isFocused = focusedIndex === index;
            const isHovered = hoveredRow === preset.id;
            const regionCount = preset.patch_json?.regions?.length ?? 0;

            const regionMap = new Map<string, TauriPatchJsonRegion>();
            if (preset.patch_json?.regions) {
              for (const region of preset.patch_json.regions) {
                if (region.sample) regionMap.set(region.sample, region);
              }
            }

            return (
              <div key={preset.id} data-preset-index={index}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '28px minmax(180px, 1fr) 60px 80px 60px 50px',
                    alignItems: 'center',
                    padding: '0.35rem 0.75rem',
                    fontSize: '0.8rem',
                    color: 'var(--color-text-primary)',
                    borderBottom: '1px solid #e0e0e0',
                    background: isSelected ? 'var(--color-surface-secondary)' : isFocused ? 'var(--color-surface-secondary)' : isHovered ? 'var(--color-surface-secondary)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.1s ease',
                    minHeight: '40px',
                    boxShadow: isFocused ? 'inset 2px 0 0 #000' : 'none',
                  }}
                  onClick={() => { setFocusedIndex(index); toggleExpand(preset.id); onSelectPreset(preset); }}
                  onMouseEnter={() => setHoveredRow(preset.id)}
                  onMouseLeave={() => setHoveredRow(null)}
                >
                  <span style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)' }}>
                    {isExpanded ? '\u25BC' : '\u25B6'}
                  </span>
                  <span style={{ fontWeight: '500' }}>{preset.name}</span>
                  <span style={{ textAlign: 'center', ...mono, fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>
                    {preset.preset_type}
                  </span>
                  <span style={{ textAlign: 'right', ...mono, fontSize: '0.7rem' }}>
                    {preset.samples.length} ({regionCount})
                  </span>
                  <span style={{ textAlign: 'right', ...mono, fontSize: '0.7rem' }}>
                    {formatSize(preset.total_size)}
                  </span>
                  <span style={{ textAlign: 'center', ...mono, fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>
                    {preset.category}
                  </span>
                </div>

                {isExpanded && (
                  <div style={{ background: 'var(--color-surface-secondary)', borderBottom: '1px solid #e0e0e0' }}>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: '28px minmax(120px, 1fr) 60px 60px 60px',
                      padding: '0.2rem 0.75rem',
                      fontSize: '0.55rem',
                      fontWeight: '600',
                      color: 'var(--color-text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: '1px solid #e0e0e0',
                    }}>
                      <span></span>
                      <span>sample</span>
                      <span style={{ textAlign: 'right' }}>size</span>
                      <span style={{ textAlign: 'center' }}>mode</span>
                      <span style={{ textAlign: 'center' }}>rev</span>
                    </div>
                    {preset.samples.map(sample => {
                      const region = regionMap.get(sample.name);
                      return (
                        <PresetSampleRow
                          key={sample.handle}
                          sample={sample}
                          regionInfo={region ? {
                            playmode: region.playmode ?? undefined,
                            reverse: region.reverse ?? undefined,
                            transpose: region.transpose ?? undefined,
                          } : undefined}
                          isPlaying={playingHandle === sample.handle}
                          onPlay={() => handlePlaySample(sample)}
                          onStop={handleStopSample}
                        />
                      );
                    })}
                    {preset.samples.length === 0 && (
                      <div style={{ padding: '0.5rem', fontSize: '0.7rem', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                        no samples
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {filteredPresets.length === 0 && (
        <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.85rem', lineHeight: 1.8 }}>
          {searchQuery ? (
            <>no results for "{searchQuery}"</>
          ) : filterCategory !== 'all' ? (
            <>no presets in {filterCategory}</>
          ) : (
            // An empty library on a connected instrument is a starting point, not a
            // dead end: both ways of putting something on it are one tab away.
            <>
              <p style={{ margin: 0 }}>No presets on this device yet.</p>
              <p style={{ margin: 0 }}>
                Build a kit in the Drum lab or a set in the Sample lab and send it, or use Install samples to put audio in <code>samples/</code>.
              </p>
            </>
          )}
        </div>
      )}

      {/* Keyboard shortcut hints */}
      {filteredPresets.length > 0 && (
        <div style={{
          padding: '0.5rem 0.75rem',
          borderTop: '1px solid #e0e0e0',
          display: 'flex',
          gap: '1rem',
          ...mono,
          fontSize: '0.55rem',
          color: 'var(--color-border-secondary)',
        }}>
          <span>↑↓ navigate</span>
          <span>⏎ expand</span>
          <span>→ select</span>
          <span>␣ play</span>
          <span>/ search</span>
          <span>g view</span>
          <span>u user only</span>
          <span>esc stop</span>
        </div>
      )}
    </div>
  );
}
