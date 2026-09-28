import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceMediaPage } from '../../components/device/DeviceMediaPage';
import { exportDeviceStems } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({
  exportDeviceFiles: vi.fn(),
  exportDeviceStems: vi.fn(),
  mtpDelete: vi.fn(),
  mtpRename: vi.fn(),
  mtpScanTree: vi.fn(),
  catalogAssets: vi.fn(async () => []),
}));
vi.mock('../../utils/deviceAudio', () => ({ readDevicePreview: vi.fn() }));

const state = {
  tauriDevice: { model: 'TP-7 MTP Device', kind: 'tp-7' },
  tauriTreeEntries: [
    { path: 'recordings/2026-02-23_112713_000.wav', handle: 7, parent_handle: 1, is_directory: false, size: 900_000_000, modified: '2026-02-23T11:27:13' },
  ],
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));

describe('TP-7 stem export', () => {
  beforeEach(() => vi.clearAllMocks());

  it('streams a take far larger than the old in-memory limit and reports what was written', async () => {
    vi.mocked(exportDeviceStems).mockResolvedValue({
      path: '/Users/nick/Music/2026-02-23_112713_000 stems',
      stems: [
        { index: 1, channels: 2, bytes: 300_000_044 },
        { index: 2, channels: 2, bytes: 300_000_044 },
        { index: 3, channels: 1, bytes: 150_000_044 },
      ],
      frames: 50_000_000,
      source_channels: 5,
      sample_rate: 96000,
      bits: 24,
      is_float: false,
    });

    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('button', { name: /split into stems/i }));

    await waitFor(() => expect(exportDeviceStems).toHaveBeenCalledWith(7, '2026-02-23_112713_000', 900_000_000));
    const status = await screen.findByText(/3 stems written to/i);
    expect(status).toHaveTextContent('track-1, track-2, track-3 (mono)');
    expect(status).toHaveTextContent('5 source channels at 96.0 khz / 24-bit kept exactly');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says nothing when the folder picker is cancelled', async () => {
    vi.mocked(exportDeviceStems).mockResolvedValue(null);
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('button', { name: /split into stems/i }));
    await waitFor(() => expect(exportDeviceStems).toHaveBeenCalled());
    expect(screen.queryByText(/stems written/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces the device refusal for a take with nothing to separate', async () => {
    vi.mocked(exportDeviceStems).mockRejectedValue(
      new Error('This recording has 2 channel(s), so there is nothing to separate. Use Export to save the original file.'),
    );
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('button', { name: /split into stems/i }));
    expect(await screen.findByText(/nothing to separate/i)).toBeInTheDocument();
    expect(screen.queryByText(/stems written/i)).not.toBeInTheDocument();
  });
});
