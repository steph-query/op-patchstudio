import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceMediaPage } from '../../components/device/DeviceMediaPage';
import { readDevicePreview } from '../../utils/deviceAudio';

vi.mock('../../utils/tauriBridge', () => ({
  exportDeviceFiles: vi.fn(),
  exportDeviceStems: vi.fn(),
  mtpDelete: vi.fn(),
  mtpRename: vi.fn(),
  mtpScanTree: vi.fn(),
  catalogAssets: vi.fn(async () => []),
}));
vi.mock('../../utils/deviceAudio', async () => ({
  readDevicePreview: vi.fn(),
  PREVIEW_SECONDS: 30,
}));

/** Records what was scheduled and when, which is the whole claim under test. */
const started: Array<{ at: number; duration: number }> = [];
let now = 0;

function fakeContext() {
  return {
    get currentTime() { return now; },
    createBufferSource: () => {
      const source = {
        buffer: null as AudioBuffer | null,
        onended: null as (() => void) | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        stop: vi.fn(),
        start: (at: number) => started.push({ at, duration: source.buffer?.duration ?? 0 }),
      };
      return source;
    },
    createGain: () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }),
    destination: {},
    // Every window decodes to a buffer whose length matches the seconds requested, so the
    // scheduled times below can be checked against the audio they represent.
    decodeAudioData: vi.fn(async (bytes: ArrayBuffer) => ({ duration: new DataView(bytes).getFloat64(0) })),
  };
}
vi.mock('../../utils/audioContext', () => ({ audioContextManager: { getAudioContext: vi.fn(async () => fakeContext()) } }));

const state = {
  tauriDevice: { model: 'TP-7 MTP Device', kind: 'tp-7', serial: 'F1RYA129' },
  tauriTreeEntries: [
    { path: 'recordings/long take.wav', handle: 7, parent_handle: 1, is_directory: false, size: 20_000_000, modified: '2026-02-23T11:27:13' },
  ],
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch: vi.fn() }) }));

/** A window whose decoded duration is exactly the seconds asked for. */
function window(seconds: number): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, seconds);
  return bytes;
}

describe('playback starts before the whole window is fetched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    started.length = 0;
    now = 0;
    vi.mocked(readDevicePreview).mockImplementation(async (_handle, _size, _start, seconds = 30) => window(seconds));
  });

  /**
   * The point of the whole change.
   *
   * One press used to read a 1 MB header probe plus the full 30-second window — about
   * 9.7 MB off a TP-7 — before a single sample sounded. Audio now starts on a 2-second
   * opening read, roughly fifteen times less data.
   */
  it('asks for two seconds first, not thirty', async () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Preview / }));
    await waitFor(() => expect(started.length).toBeGreaterThan(0));
    // The read the user actually waits on.
    expect(vi.mocked(readDevicePreview).mock.calls[0]).toEqual([7, 20_000_000, 0, 2]);
    expect(started[0].duration).toBe(2);
  });

  /**
   * Chunks are cut on frame boundaries by `readDevicePreview`, so each one is scheduled
   * at the previous one's end time. Any drift here is an audible gap or overlap.
   */
  it('schedules each chunk exactly where the previous one ends', async () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Preview / }));
    // 2 s opening, then 6 s chunks to fill the 30 s window.
    await waitFor(() => expect(started.length).toBe(1 + Math.ceil(28 / 6)));

    let expected = started[0].at;
    for (const entry of started) {
      expect(entry.at).toBeCloseTo(expected, 6);
      expected += entry.duration;
    }
    // The whole window, and no more.
    expect(started.reduce((sum, entry) => sum + entry.duration, 0)).toBe(30);
  });

  it('reads the rest from where the audio already playing left off', async () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Preview / }));
    await waitFor(() => expect(vi.mocked(readDevicePreview).mock.calls.length).toBeGreaterThan(1));
    const offsets = vi.mocked(readDevicePreview).mock.calls.map(call => [call[2], call[3]]);
    expect(offsets.slice(0, 4)).toEqual([[0, 2], [2, 6], [8, 6], [14, 6]]);
  });

  /** Stopping must abandon the fetch loop, not keep pulling audio nobody will hear. */
  it('stops reading when playback is stopped', async () => {
    let release: (() => void) | null = null;
    vi.mocked(readDevicePreview).mockImplementation(async (_handle, _size, _start, seconds = 30) => {
      if (seconds === 2) return window(2);
      await new Promise<void>(resolve => { release = resolve; });
      return window(seconds);
    });
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Preview / }));
    await waitFor(() => expect(release).not.toBeNull());
    const reads = vi.mocked(readDevicePreview).mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /^Stop / }));
    release!();
    await waitFor(() => expect(screen.getByRole('button', { name: /^Preview / })).toBeInTheDocument());
    // The chunk in flight is discarded and no further one is requested.
    expect(vi.mocked(readDevicePreview).mock.calls.length).toBe(reads);
    expect(started.length).toBe(1);
  });

  /** A recording shorter than the opening request arrives whole; there is nothing to stream. */
  it('does not keep reading a file it has already read entirely', async () => {
    vi.mocked(readDevicePreview).mockResolvedValue(window(0.4));
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Preview / }));
    await waitFor(() => expect(started.length).toBe(1));
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(vi.mocked(readDevicePreview)).toHaveBeenCalledTimes(1);
  });

  /**
   * The list has to stay usable while a preview plays. Holding the device-operation lock
   * for the whole 30 seconds would make the panel inert behind audio that is sounding.
   */
  it('releases the controls once audio is playing, before the rest is fetched', async () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /^Preview / }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Stop / })).toBeEnabled());
    expect(screen.getByRole('button', { name: /^export$/ })).toBeEnabled();
  });
});
