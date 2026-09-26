import { useEffect, useState, useMemo } from 'react';
import { InlineLoading } from '@carbon/react';
import { useAppContext } from '../../context/AppContext';
import { calculatePatchSize, formatFileSize, getPatchSizeWarning } from '../../utils/audio';

interface PatchSizeIndicatorProps {
  type: 'drum' | 'multisample';
  className?: string;
}

export function PatchSizeIndicator({ type, className = '' }: PatchSizeIndicatorProps) {
  const { state } = useAppContext();
  const [patchSize, setPatchSize] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);


  // Get relevant audio buffers and settings based on type
  const audioBuffers = type === 'drum' 
    ? state.drumSamples.filter(s => s && s.audioBuffer).map(s => s!.audioBuffer!)
    : state.multisampleFiles.filter(f => f && f.audioBuffer).map(f => f!.audioBuffer!);

  const settings = type === 'drum' ? state.drumSettings : state.multisampleSettings;

  /**
   * What the reported size depends on, as a value that changes exactly when it should.
   *
   * The effect below was keyed on `audioBuffers.length`, so **swapping one sample for
   * another left the size stale** — the count had not changed. Replacing a 0.2 s hi-hat
   * with a 15 s pad reported the old figure, and since this indicator exists to warn about
   * the 8 MB preset limit, a kit could be pushed over that limit while still showing a
   * safe number and no warning.
   *
   * Keying on the array itself is not an option: it is rebuilt by `.filter().map()` on
   * every render, so the effect would re-run its async work every time. This is the
   * narrower thing — `calculatePatchSize` uses each buffer's duration, sample rate and
   * channel count, and nothing else.
   */
  const bufferSignature = useMemo(
    () => audioBuffers.map(buffer => `${buffer.duration}:${buffer.sampleRate}:${buffer.numberOfChannels}`).join('|'),
    [audioBuffers],
  );

  // Calculate preset size when samples or settings change
  useEffect(() => {
    const calculateSize = async () => {
      if (audioBuffers.length === 0) {
        setPatchSize(0);
        return;
      }

      setIsCalculating(true);
      try {
        const size = await calculatePatchSize(audioBuffers, {
          sampleRate: settings.sampleRate,
          bitDepth: settings.bitDepth,
          channels: settings.channels,
        });
        setPatchSize(size);
      } catch (error) {
        console.error('Failed to calculate preset size:', error);
        setPatchSize(0);
      } finally {
        setIsCalculating(false);
      }
    };

    calculateSize();
    // `bufferSignature` stands in for `audioBuffers`, whose identity changes on every
    // render; see the comment above it.
  }, [bufferSignature, settings.sampleRate, settings.bitDepth, settings.channels]);

  // Calculate percentage and get warning
  const maxSize = 8 * 1024 * 1024; // 8mb limit
  const percentage = Math.min(100, (patchSize / maxSize) * 100);
  const warning = getPatchSizeWarning(patchSize);



  // Always show the indicator, even with 0 samples

  return (
    <div className={`preset-size-indicator ${className}`} style={{ 
      marginBottom: '1rem',
      width: '100%' // Full width of its container (which is now 50%)
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: '0.5rem'
      }}>
        <span style={{ 
          fontSize: '0.9rem', 
          fontWeight: '500',
          color: 'var(--color-text-primary)'
        }}>
          preset size estimate
        </span>
        {/* The figure arrives after an async calculation and changes as samples change,
            with nothing to announce it and no association with the label beside it.
            `status` announces the update; the label names what the number is. */}
        <span
          role="status"
          aria-label="preset size estimate"
          style={{
            fontSize: '0.9rem',
            color: 'var(--color-text-secondary)'
          }}
        >
          {isCalculating ? (
            <InlineLoading description="Calculating..." />
          ) : (
            formatFileSize(patchSize)
          )}
        </span>
      </div>

      {/* Custom progress bar with fixed 8mb indicator */}
      <div style={{ 
        marginBottom: '0.5rem',
        position: 'relative'
      }}>
        {/* Background bar */}
        <div style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'var(--color-progress-track)',
          borderRadius: '4px',
          position: 'relative',
          overflow: 'hidden'
        }}>
          {/* Progress fill */}
          <div style={{
            width: `${Math.min(100, percentage)}%`,
            height: '100%',
            backgroundColor: 'var(--color-text-secondary)',
            borderRadius: '4px',
            transition: 'width 0.3s ease'
          }} />
          
          {/* 8mb limit indicator line */}
          <div style={{
            position: 'absolute',
            right: 0,
            top: 0,
            width: '2px',
            height: '100%',
            backgroundColor: 'var(--color-text-secondary)',
            zIndex: 1
          }} />
        </div>
        
        {/* Scale labels */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '0.25rem',
          fontSize: '0.7rem',
          color: 'var(--color-text-info)'
        }}>
          <span>0 mb</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <i 
              className="fas fa-info-circle" 
              style={{ 
                fontSize: '0.6rem', 
                color: 'var(--color-text-info)',
                cursor: 'help'
              }}
              title="the OP-XY has 64mb allocated to samples across all presets. the 8mb limit per preset is recommended to prevent memory issues and note dropping. 16-bit samples load faster than 24-bit and help stay within memory constraints."
            ></i>
            8.0 mb
          </span>
        </div>
      </div>

      {warning && (
        <div style={{
          fontSize: '0.8rem',
          color: 'var(--color-text-secondary)',
          fontStyle: 'italic',
          marginTop: '0.25rem'
        }}>
          {warning}
        </div>
      )}

      {/* Only show format details if any setting differs from original (0) */}
      {(settings.sampleRate !== 0 || settings.bitDepth !== 0 || settings.channels !== 0) && (
        <div style={{
          fontSize: '0.8rem',
          color: 'var(--color-text-secondary)',
          marginTop: '0.25rem'
        }}>
          {audioBuffers.length} sample{audioBuffers.length !== 1 ? 's' : ''}
          {settings.sampleRate !== 0 && (
            <> • {settings.sampleRate === 44100 ? '44.1 khz' : settings.sampleRate === 22050 ? '22.1 khz' : settings.sampleRate === 11025 ? '11 khz' : `${settings.sampleRate / 1000} khz`}</>
          )}
          {settings.bitDepth !== 0 && (
            <> • {settings.bitDepth}bit</>
          )}
          {settings.channels !== 0 && (
            <> • {settings.channels === 1 ? 'mono' : 'stereo'}</>
          )}
        </div>
      )}

      {/* Recommendations for optimization */}
      {percentage >= 85 && (
        <div style={{
          fontSize: '0.8rem',
          color: 'var(--color-text-secondary)',
          marginTop: '0.5rem',
          padding: '0.5rem',
          backgroundColor: 'var(--color-bg-secondary)',
          borderRadius: '3px',
          border: '1px solid var(--color-progress-track)'
        }}>
          <strong>optimization tips:</strong>
          <ul style={{ margin: '0.25rem 0 0 1rem', padding: 0 }}>
            {(settings.sampleRate === 0 || settings.sampleRate > 22050) && (
              <li>reduce sample rate to 22.1 khz for smaller size</li>
            )}
            {(settings.bitDepth === 0 || settings.bitDepth > 16) && (
              <li>use 16-bit instead of 24-bit</li>
            )}
            {(settings.channels === 0 || settings.channels === 2) && (
              <li>convert to mono if stereo imaging isn't needed</li>
            )}
            <li>trim unused portions of samples</li>
          </ul>
        </div>
      )}
    </div>
  );
}