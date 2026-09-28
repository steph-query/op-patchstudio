import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceMediaPage } from '../../components/device/DeviceMediaPage';

vi.mock('../../utils/tauriBridge', () => ({
  exportDeviceFiles: vi.fn(),
  exportDeviceStems: vi.fn(),
  mtpDelete: vi.fn(),
  mtpRename: vi.fn(),
  mtpScanTree: vi.fn(),
  catalogAssets: vi.fn(async () => []),
}));
vi.mock('../../utils/deviceAudio', () => ({ readDevicePreview: vi.fn() }));

/**
 * Deliberately out of order on every axis, and deliberately not in agreement:
 * the largest file is the oldest, so a list ordered by size cannot be mistaken
 * for one ordered by date.
 */
const state = {
  tauriDevice: { model: 'TP-7 MTP Device', kind: 'tp-7' },
  tauriTreeEntries: [
    { path: 'recordings/2026-02-20_090000_000.wav', handle: 1, parent_handle: 1, is_directory: false, size: 900_000, modified: '2026-02-20T09:00:00' },
    { path: 'recordings/2026-02-23_112713_000.wav', handle: 2, parent_handle: 1, is_directory: false, size: 100_000, modified: '2026-02-23T11:27:13' },
    { path: 'recordings/2026-02-21_180000_000.wav', handle: 3, parent_handle: 1, is_directory: false, size: 500_000, modified: '2026-02-21T18:00:00' },
  ],
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));

/** The take names in the order they are rendered. */
function order(): string[] {
  return screen.getAllByRole('listitem').map(row => row.querySelector('strong')?.textContent ?? '');
}

const NEWEST = '2026-02-23_112713_000';
const MIDDLE = '2026-02-21_180000_000';
const OLDEST = '2026-02-20_090000_000';

describe('sorting the device file list', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The default is the part that matters most.
   *
   * A recorder's most recent take is the one being looked for, and it was arriving
   * wherever the device scan happened to put it. This is also why sorting is worth
   * less on a TP-7 than it looks: every file is `YYYY-MM-DD_HHMMSS_NNN` in one folder
   * at one format, so name order *is* date order and only size says anything new.
   */
  it('shows the newest recording first without being asked', () => {
    render(<DeviceMediaPage mode="recordings" />);
    expect(order()).toEqual([NEWEST, MIDDLE, OLDEST]);
    expect(screen.getByRole('columnheader', { name: /recorded/i })).toHaveAttribute('aria-sort', 'descending');
  });

  it('reverses the column already sorted, and announces which way', () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('columnheader', { name: /recorded/i }));
    expect(order()).toEqual([OLDEST, MIDDLE, NEWEST]);
    expect(screen.getByRole('columnheader', { name: /recorded/i })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('sorts by size largest first, which is a different order from the dates', () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('columnheader', { name: /size/i }));
    // The largest file is the oldest, so this cannot pass by accidentally date-sorting.
    expect(order()).toEqual([OLDEST, MIDDLE, NEWEST]);
    fireEvent.click(screen.getByRole('columnheader', { name: /size/i }));
    expect(order()).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it('starts a new column the way that column is most useful', () => {
    render(<DeviceMediaPage mode="recordings" />);
    // Dates and sizes want the biggest first; names want A first, because "sort by name"
    // meaning Z→A is a surprise every time.
    fireEvent.click(screen.getByRole('columnheader', { name: /name/i }));
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'ascending');
    expect(order()).toEqual([OLDEST, MIDDLE, NEWEST]);

    fireEvent.click(screen.getByRole('columnheader', { name: /size/i }));
    expect(screen.getByRole('columnheader', { name: /size/i })).toHaveAttribute('aria-sort', 'descending');
  });

  it('only one column is sorted at a time', () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('columnheader', { name: /size/i }));
    expect(screen.getByRole('columnheader', { name: /recorded/i })).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: /name/i })).toHaveAttribute('aria-sort', 'none');
  });

  /**
   * `localeCompare` with `numeric`, not a plain string comparison, which would put
   * `take 10` before `take 2`. TP-7 names are zero-padded so it does not bite there —
   * it bites on the OP-1's patch names and on anything a person has renamed.
   */
  it('orders numbers in names the way a person reads them', () => {
    const original = state.tauriTreeEntries;
    state.tauriTreeEntries = [
      { path: 'recordings/take 10.wav', handle: 1, parent_handle: 1, is_directory: false, size: 1, modified: '2026-02-20T09:00:00' },
      { path: 'recordings/take 2.wav', handle: 2, parent_handle: 1, is_directory: false, size: 1, modified: '2026-02-20T09:00:00' },
    ];
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(screen.getByRole('columnheader', { name: /name/i }));
    expect(order()).toEqual(['take 2', 'take 10']);
    state.tauriTreeEntries = original;
  });
});
