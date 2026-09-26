import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DrumSampleSettingsModal } from '../../components/drum/DrumSampleSettingsModal';

const sample = {
  file: new File([new Uint8Array(8)], 'kick.wav', { type: 'audio/wav' }),
  audioBuffer: null,
  name: 'kick.wav',
  isLoaded: true,
  inPoint: 0,
  outPoint: 1,
  playmode: 'oneshot',
  reverse: false,
  transpose: 0,
  gain: 0,
  pan: 0,
  hasBeenEdited: false,
};
const state = { drumSamples: [sample], drumSettings: {}, midiNoteMapping: 'C3' };
// One dispatch, not a new one per render: React's real dispatch is stable, and the
// settings-sync effect lists it as a dependency.
const dispatch = vi.fn();
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch }) }));
vi.mock('../../hooks/useAudioPlayer', () => ({
  useAudioPlayer: () => ({ playWithADSR: vi.fn(), releaseNote: vi.fn(), play: vi.fn(), stop: vi.fn() }),
}));

describe('DrumSampleSettingsModal', () => {
  it('is a dialog with a name, like every other modal in the app', () => {
    render(<DrumSampleSettingsModal isOpen onClose={vi.fn()} sampleIndex={0} />);
    // It had no role at all: assistive technology met an unlabelled box of sliders.
    expect(screen.getByRole('dialog', { name: 'sample options' })).toBeInTheDocument();
  });

  it('names each slider, because "slider" alone does not say which one', () => {
    render(<DrumSampleSettingsModal isOpen onClose={vi.fn()} sampleIndex={0} />);
    expect(screen.getByLabelText('transpose in semitones')).toBeInTheDocument();
    expect(screen.getByLabelText('gain in decibels')).toBeInTheDocument();
    expect(screen.getByLabelText('pan')).toBeInTheDocument();
  });

  it('closes on escape, which the shortcut list already promised', () => {
    const onClose = vi.fn();
    render(<DrumSampleSettingsModal isOpen onClose={onClose} sampleIndex={0} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not listen when it is closed', () => {
    const onClose = vi.fn();
    render(<DrumSampleSettingsModal isOpen={false} onClose={onClose} sampleIndex={0} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
