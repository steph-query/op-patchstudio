import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StoragePage } from '../../components/storage/StoragePage';
import { downloadBlob } from '../../utils/patchGeneration';
import type { TauriDevicePreset, TauriPresetSample } from '../../utils/tauriBridge';

vi.mock('../../utils/patchGeneration', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../components/projects/BackupPanel', () => ({ BackupPanel: () => null }));

const preset: TauriDevicePreset = {
  id: 'drum/big kit.preset',
  name: 'big kit',
  category: 'drum',
  preset_type: 'drum',
  folder_handle: 10,
  patch_json: { regions: [{ sample: 'kick.wav' }] },
  samples: [{ handle: 11, name: 'kick.wav', size: 2_000_000 }],
  total_size: 2_000_000,
};

// As the scan reports them: `name` is relative to samples/, and standalone samples
// carry the full path they were found at. The second has none, to exercise the
// fallback as well as the reported path.
const samples: TauriPresetSample[] = [
  { handle: 21, name: 'user/kick.wav', size: 2_000_000, path: 'samples/user/kick.wav' },
  { handle: 22, name: 'forgotten take.wav', size: 5_000_000 },
];

const state = {
  tauriDevice: { model: 'OP-XY', firmware: '1.1.33', kind: 'op-xy' },
  tauriPresets: [preset],
  tauriSamples: samples,
  tauriTreeEntries: [],
  tauriStorageInfo: { freeSpace: 4_000_000_000, capacity: 8_000_000_000 },
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));

describe('Storage space review', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports the duplicated bytes and the samples no preset names', () => {
    render(<StoragePage />);
    expect(screen.getByText(/1 file appears in more than one place/i)).toBeInTheDocument();
    expect(screen.getByText(/1\.9 mb beyond a single copy/i)).toBeInTheDocument();
    expect(screen.getByText(/1 library sample is not named by any preset this app can read/i)).toBeInTheDocument();
    expect(screen.getByText(/That is not the same as unused/i)).toBeInTheDocument();
  });

  it('shows both locations of a duplicated file only when asked', () => {
    render(<StoragePage />);
    expect(screen.queryByText('samples/user/kick.wav')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show copies' }));
    expect(screen.getByText(/samples\/user\/kick\.wav · sample library/)).toBeInTheDocument();
    expect(screen.getByText(/presets\/drum\/big kit\.preset\/kick\.wav · preset folder/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide copies' }));
    expect(screen.queryByText(/samples\/user\/kick\.wav · sample library/)).not.toBeInTheDocument();
  });

  it('states its limits next to the numbers and never says anything is safe to delete', () => {
    render(<StoragePage />);
    const caveats = screen.getAllByRole('listitem').map(item => item.textContent ?? '').join(' ');
    expect(caveats).toContain('not certainly');
    expect(caveats).toContain('Nothing here is a deletion recommendation');
    expect(caveats.toLowerCase()).not.toContain('safe to delete');
    expect(screen.queryByRole('button', { name: /delete|clean up|remove/i })).not.toBeInTheDocument();
  });

  it('exports a report carrying the device identity and the caveats', () => {
    render(<StoragePage />);
    fireEvent.click(screen.getByRole('button', { name: 'Export report' }));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    expect(filename).toBe('device-space-report.json');
    expect(blob.type).toBe('application/json');
  });
});
