import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DeviceMediaPage } from '../../components/device/DeviceMediaPage';

vi.mock('../../utils/tauriBridge', () => ({
  exportDeviceFiles: vi.fn(),
  exportDeviceStems: vi.fn(),
  mtpDelete: vi.fn(),
  mtpRename: vi.fn(),
  mtpScanTree: vi.fn(),
  catalogAssets: vi.fn(async () => []),
}));
vi.mock('../../hooks/useDeviceSamplePreview', () => ({
  useDeviceSamplePreview: () => ({ play: vi.fn(), stop: vi.fn(), playing: null, levels: [], nodes: { current: [] } }),
}));

const state: {
  tauriDevice: { model: string; kind: string } | null;
  tauriTreeEntries: unknown[];
  tauriMissingRoots: string[];
} = { tauriDevice: { model: 'OP-1 field', kind: 'op-1-field' }, tauriTreeEntries: [], tauriMissingRoots: [] };
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch: vi.fn() }) }));

describe('DeviceMediaPage — a folder that is not there', () => {
  it('explains an empty tape view when the folders are missing, not just that it is empty', () => {
    // Owners hit exactly this: a field exposes no tape or album folder over one
    // transfer mode, and this view showed "0 items" with the explanation on a
    // different screen.
    state.tauriMissingRoots = ['tape', 'album'];
    render(<DeviceMediaPage mode="tapes" />);
    expect(screen.getByText('There are no tape or album folders on this device.')).toBeInTheDocument();
    expect(screen.getByText(/reconnect in the other transfer mode/)).toBeInTheDocument();
  });

  it('reads as a singular when only one folder is missing', () => {
    state.tauriMissingRoots = ['memo'];
    render(<DeviceMediaPage mode="recordings" />);
    expect(screen.getByText('There is no memo folder on this device.')).toBeInTheDocument();
    expect(screen.getByText(/do not expose it\./)).toBeInTheDocument();
  });

  it('says only that it is empty when the folder is present and holds nothing', () => {
    state.tauriMissingRoots = [];
    render(<DeviceMediaPage mode="tapes" />);
    expect(screen.getByText(/no tapes \+ album found on this device/)).toBeInTheDocument();
    expect(screen.queryByText(/reconnect in the other transfer mode/)).toBeNull();
  });

  it('ignores a missing folder that this view does not read', () => {
    // A missing drum folder is not the recordings view's business.
    state.tauriMissingRoots = ['drum'];
    render(<DeviceMediaPage mode="recordings" />);
    expect(screen.queryByText(/reconnect in the other transfer mode/)).toBeNull();
  });
});
