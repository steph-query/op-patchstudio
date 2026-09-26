import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DevicePresetTable } from '../../components/device/DevicePresetTable';
import type { TauriDevicePreset } from '../../utils/tauriBridge';

const kit: TauriDevicePreset = {
  id: 'drum/big kit.preset',
  name: 'big kit',
  category: 'drum',
  preset_type: 'drum',
  folder_handle: 30,
  patch_json: { preset_type: 'drum', regions: [] },
  samples: [{ handle: 32, name: 'kick.wav', size: 2_000_000 }],
  total_size: 2_000_000,
};

describe('DevicePresetTable — nothing to show', () => {
  it('turns an empty device into a starting point rather than a dead end', () => {
    // A connected instrument with no presets is a new or wiped device, and both ways
    // of putting something on it are one tab away. It used to say only "no presets".
    render(<DevicePresetTable presets={[]} onSelectPreset={vi.fn()} selectedPresetId={null} />);
    expect(screen.getByText('No presets on this device yet.')).toBeInTheDocument();
    const next = screen.getByText(/Build a kit in the Drum lab/);
    expect(next).toHaveTextContent('Sample lab');
    expect(next).toHaveTextContent('Install samples');
  });

  it('does not offer that advice when the library is merely filtered down to nothing', () => {
    // The device is not empty here — the user narrowed it — so telling them to go
    // build something would be answering a question they did not ask.
    render(<DevicePresetTable presets={[kit]} onSelectPreset={vi.fn()} selectedPresetId={null} />);
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'nothing matches this' } });
    expect(screen.getByText(/no results for "nothing matches this"/)).toBeInTheDocument();
    expect(screen.queryByText('No presets on this device yet.')).toBeNull();
  });
});

describe('DevicePresetTable — a preset with no audio', () => {
  const empty: TauriDevicePreset = { ...kit, id: 'drum/empty.preset', name: 'empty', samples: [], total_size: 0 };

  /** Reachable on a real device: a preset folder holding a patch.json and no audio. */
  it('offers no play control for a preset with nothing to play', () => {
    render(<DevicePresetTable presets={[empty]} onSelectPreset={vi.fn()} selectedPresetId={null} />);
    fireEvent.click(screen.getByTitle('grid view'));
    expect(screen.getByText('empty')).toBeInTheDocument();
    // It used to render a play triangle with a pointer cursor whose click did nothing.
    expect(screen.queryByTitle('play first sample')).toBeNull();
  });

  it('still offers it when there is a sample', () => {
    render(<DevicePresetTable presets={[kit]} onSelectPreset={vi.fn()} selectedPresetId={null} />);
    fireEvent.click(screen.getByTitle('grid view'));
    expect(screen.getByTitle('play first sample')).toBeInTheDocument();
  });
});
