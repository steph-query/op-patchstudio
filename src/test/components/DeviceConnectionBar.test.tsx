import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceConnectionBar } from '../../components/common/DeviceConnectionBar';
import { mtpConnect, mtpDisconnect, mtpScanPresets, mtpListStorages, mtpListAvailable, mtpScanTree } from '../../utils/tauriBridge';
vi.mock('../../utils/tauriBridge', () => ({ isTauriAvailable: () => true, mtpConnect: vi.fn(), mtpDisconnect: vi.fn(), mtpScanPresets: vi.fn(), mtpListStorages: vi.fn(), mtpListAvailable: vi.fn(), mtpScanTree: vi.fn(), tp7SwitchToMtp: vi.fn() }));
const dispatch = vi.fn();
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state: { currentTab: 'drum', tauriDevice: null, tauriConnecting: false, tauriStorageInfo: null }, dispatch }) }));
const device = { location_id: '123', vendor_id: 0x2367, product_id: 1, manufacturer: 'teenage engineering', product: 'OP-XY', serial: 'test', kind: 'op-xy' as const, mode: 'mtp' as const };
async function discover() {
  fireEvent.click(screen.getByRole('button', { name: 'find devices' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'connect device' })).toBeEnabled());
}
describe('DeviceConnectionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mtpListAvailable).mockResolvedValue([device]);
    vi.mocked(mtpConnect).mockResolvedValue({ manufacturer: 'teenage engineering', model: 'OP-XY', serial: 'test', connected: true });
    vi.mocked(mtpDisconnect).mockResolvedValue();
    vi.mocked(mtpListStorages).mockResolvedValue([]);
  });
  it('does not publish an incomplete inventory after a failed scan', async () => {
    vi.mocked(mtpScanPresets).mockRejectedValue(new Error('scan interrupted'));
    render(<DeviceConnectionBar />); await discover();
    fireEvent.click(screen.getByRole('button', { name: 'connect device' }));
    await waitFor(() => expect(mtpDisconnect).toHaveBeenCalled());
    expect(dispatch.mock.calls.some(([action]) => action.type === 'SET_TAURI_DEVICE')).toBe(false);
    expect(mtpConnect).toHaveBeenCalledWith('123');
  });
  /**
   * A real USB location id, handed back to `mtp_connect` unrounded.
   *
   * `location_id` is a Rust `u64` built from USB topology. This is the value a TP-7
   * actually reported: 12657954965147713707, roughly 1405x past `Number.MAX_SAFE_INTEGER`.
   * While it crossed the IPC boundary as a JSON number it was silently rounded to
   * ...713536, and mtp-rs matches the device with `d.location_id == location_id`, so the
   * lookup failed and every connection to real hardware died with "No MTP device found" —
   * while the device sat there openable. It is a string end to end now.
   *
   * The fixtures here used to say 7, which survives float64 exactly. That is the whole
   * reason a full green suite shipped a build that could not connect to anything.
   */
  it('connects to a device whose location id exceeds the safe integer range', async () => {
    const realistic = '12657954965147713707';
    expect(Number(realistic)).toBeGreaterThan(Number.MAX_SAFE_INTEGER);
    expect(String(Number(realistic))).not.toBe(realistic);
    vi.mocked(mtpListAvailable).mockResolvedValue([{ ...device, location_id: realistic, product: 'TP-7 MTP Device', kind: 'tp-7' as const }]);
    vi.mocked(mtpConnect).mockResolvedValue({ manufacturer: 'teenage engineering', model: 'TP-7 MTP Device', serial: 'test', connected: true });
    vi.mocked(mtpScanTree).mockResolvedValue({ entries: [], missing_roots: [], roots: [] });
    render(<DeviceConnectionBar />); await discover();
    fireEvent.click(screen.getByRole('button', { name: 'connect device' }));
    await waitFor(() => expect(mtpConnect).toHaveBeenCalledWith(realistic));
  });

  it('ignores repeated connection requests while scanning', async () => {
    let finish!: (value: Awaited<ReturnType<typeof mtpScanPresets>>) => void;
    vi.mocked(mtpScanPresets).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<DeviceConnectionBar />); await discover();
    fireEvent.click(screen.getByRole('button', { name: 'connect device' }));
    fireEvent.click(screen.getByRole('button', { name: 'connect device' }));
    await waitFor(() => expect(mtpScanPresets).toHaveBeenCalledOnce());
    expect(mtpConnect).toHaveBeenCalledOnce();
    await act(async () => finish({ presets: [], projects: [], standalone_samples: [] }));
    expect(dispatch.mock.calls.some(([action]) => action.type === 'SET_TAURI_DEVICE')).toBe(true);
  });
  it('requires an explicit choice when multiple devices are present', async () => {
    vi.mocked(mtpListAvailable).mockResolvedValue([device, { ...device, location_id: '456', serial: 'second' }]);
    render(<DeviceConnectionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'find devices' }));
    await screen.findByText('OP-XY · second');
    expect(screen.getByRole('button', { name: 'connect device' })).toBeDisabled();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '456' } });
    vi.mocked(mtpConnect).mockResolvedValue({ manufacturer: 'TE', model: 'OP-XY', serial: 'second', connected: true });
    vi.mocked(mtpScanPresets).mockResolvedValue({ presets: [], projects: [], standalone_samples: [] });
    fireEvent.click(screen.getByRole('button', { name: 'connect device' }));
    await waitFor(() => expect(mtpConnect).toHaveBeenCalledWith('456'));
  });
  it('scans OP-1 roots without invoking the OP-XY parser', async () => {
    vi.mocked(mtpListAvailable).mockResolvedValue([{ ...device, product: 'OP-1 field', kind: 'op-1-field' }]);
    vi.mocked(mtpConnect).mockResolvedValue({ manufacturer: 'TE', model: 'OP-1 field', serial: 'test', connected: true, kind: 'op-1-field' });
    vi.mocked(mtpScanTree).mockResolvedValue({ entries: [], missing_roots: [], roots: [] });
    render(<DeviceConnectionBar />); await discover();
    fireEvent.click(screen.getByRole('button', { name: 'connect device' }));
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalledWith(['drum', 'synth', 'tape', 'album']));
    expect(mtpScanPresets).not.toHaveBeenCalled();
  });
});

describe('DeviceConnectionBar transfer instructions', () => {
  it('lists every supported device from its profile, including the OP-XY label ambiguity', () => {
    render(<DeviceConnectionBar />);
    const items = screen.getAllByRole('listitem').map(item => item.textContent ?? '');
    expect(items.some(text => /op-xy: com › m4 \(labelled t4 on some firmware\)/i.test(text))).toBe(true);
    expect(items.some(text => /op-1 field: shift \+ com › t4/i.test(text))).toBe(true);
    expect(items.some(text => /tp-7: stop recording/i.test(text))).toBe(true);
  });
});

describe('DeviceConnectionBar — what it says after looking', () => {
  const tp7Waiting = { location_id: null, vendor_id: 0x2367, product_id: 0x19, manufacturer: 'teenage engineering', product: 'TP-7', serial: 'F1RTL11C', kind: 'tp-7' as const, mode: 'usb' as const };
  const opxy = { location_id: '123', vendor_id: 0x2367, product_id: 1, manufacturer: 'teenage engineering', product: 'OP-XY', serial: 'xy', kind: 'op-xy' as const, mode: 'mtp' as const };
  const field = { location_id: '456', vendor_id: 0x2367, product_id: 2, manufacturer: 'teenage engineering', product: 'OP-1 field', serial: 'f1', kind: 'op-1-field' as const, mode: 'mtp' as const };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mtpListStorages).mockResolvedValue([]);
  });

  async function look() {
    render(<DeviceConnectionBar />);
    fireEvent.click(screen.getByRole('button', { name: 'find devices' }));
  }

  it('names the device it just selected for you rather than asking you to select one', async () => {
    // One ready device is chosen automatically, so "Select a device in file-transfer
    // mode" was telling the user to do something already done.
    vi.mocked(mtpListAvailable).mockResolvedValue([opxy]);
    await look();
    expect(await screen.findByText('OP-XY is in file-transfer mode. Connect device to open it.')).toBeInTheDocument();
  });

  it('asks for a choice only when there is a choice to make', async () => {
    vi.mocked(mtpListAvailable).mockResolvedValue([opxy, field]);
    await look();
    expect(await screen.findByText('2 devices are in file-transfer mode. Choose which one to open.')).toBeInTheDocument();
  });

  it('points a waiting TP-7 owner at the button that helps them', async () => {
    // A TP-7 on the bus in audio mode is the first thing its owner meets, and it
    // cannot be opened until it re-enumerates. The app has a button for exactly that.
    vi.mocked(mtpListAvailable).mockResolvedValue([tp7Waiting]);
    await look();
    expect(await screen.findByText(/A TP-7 is attached but still in audio mode.*use prepare tp-7/)).toBeInTheDocument();
    // And the button it names is right there.
    expect(screen.getByRole('button', { name: 'prepare tp-7' })).toBeInTheDocument();
  });

  it('says what to do when something is attached but not in transfer mode', async () => {
    vi.mocked(mtpListAvailable).mockResolvedValue([{ ...field, mode: 'usb' as const, location_id: null }]);
    await look();
    expect(await screen.findByText(/not in file-transfer mode yet/)).toBeInTheDocument();
  });

  it('still says plainly when there is nothing at all', async () => {
    vi.mocked(mtpListAvailable).mockResolvedValue([]);
    await look();
    expect(await screen.findByText(/No supported devices found/)).toBeInTheDocument();
  });
});
