import { render, fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WaveformZoomModal } from '../../components/common/WaveformZoomModal';

vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({ playWithADSR: vi.fn(), releaseNote: vi.fn() }),
}));
vi.mock('../../App', () => ({ triggerRotateOverlay: vi.fn() }));

/** Enough of an AudioBuffer for the editor to lay itself out. */
function buffer(frames = 44_100, rate = 44_100): AudioBuffer {
  const data = new Float32Array(frames);
  return {
    length: frames,
    sampleRate: rate,
    duration: frames / rate,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

function open(onClose: () => void, isOpen = true, audioBuffer: AudioBuffer | null = null) {
  return render(<WaveformZoomModal
    isOpen={isOpen}
    onClose={onClose}
    audioBuffer={audioBuffer}
    initialInPoint={0}
    initialOutPoint={0}
    onSave={vi.fn()}
    onSaveForAll={vi.fn()}
  />);
}

describe('WaveformZoomModal keyboard', () => {
  it('closes on escape, like every other layer in the app', () => {
    const onClose = vi.fn();
    open(onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores escape when it is not open, so it cannot close something else', () => {
    const onClose = vi.fn();
    open(onClose, false);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

/**
 * Two of the three call sites pass `sample?.audioBuffer || null`, so opening with
 * nothing to draw is reachable — a restored session whose audio failed to decode
 * keeps its row and its zoom button. This used to render the whole editor around an
 * empty canvas, transport and all, and every control was inert.
 */
describe('WaveformZoomModal with no audio', () => {
  it('says what happened rather than showing an editor that cannot act', () => {
    open(vi.fn(), true, null);
    expect(screen.getByRole('dialog', { name: /audio not loaded/i })).toBeInTheDocument();
    expect(screen.getByText(/audio is not loaded/i)).toBeInTheDocument();
    // The transport of the real editor must not be present to be pressed.
    expect(screen.queryByRole('button', { name: /play/i })).not.toBeInTheDocument();
  });

  it('still closes from its own button', () => {
    const onClose = vi.fn();
    open(onClose, true, null);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not stand in for the editor when there is audio', () => {
    open(vi.fn(), true, buffer());
    expect(screen.queryByText(/audio is not loaded/i)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-labelledby');
  });
});
