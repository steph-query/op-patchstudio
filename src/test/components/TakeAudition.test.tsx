import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TakeAudition } from '../../components/library/TakeAudition';
import {
  catalogDeleteRegion,
  catalogSaveRegion,
  localAudioInfo,
  localAudioPeaks,
  localAudioWindow,
} from '../../utils/tauriBridge';
import type { CatalogAsset } from '../../utils/tauriBridge';
import { encodeWav } from '../../utils/wavDecode';

// The handoff hook has its own tests; here only the wiring from the region list matters.
const toDrumLab = vi.fn();
const toSampleLab = vi.fn();
const sendMany = vi.fn();
vi.mock('../../hooks/useRegionHandoff', () => ({
  useRegionHandoff: () => ({ toDrumLab, toSampleLab, sendMany, freePads: 24, freeZones: 24 }),
}));

vi.mock('../../utils/tauriBridge', () => ({
  localAudioInfo: vi.fn(),
  localAudioPeaks: vi.fn(),
  localAudioWindow: vi.fn(),
  catalogSaveRegion: vi.fn(),
  catalogDeleteRegion: vi.fn(),
}));

const asset: CatalogAsset = {
  id: 'hash-a',
  stored_path: 'originals/long take.wav',
  original_name: 'long take.wav',
  bytes: 900_000_000,
  first_imported_unix: 1_772_000_000,
  occurrences: [],
  regions: [],
};

/** A 900 MB take: 2 channels, 24-bit, 96 kHz, nearly 26 minutes. */
const info = {
  asset_id: 'hash-a',
  sample_rate: 96_000,
  channels: 2,
  bits: 24,
  is_float: false,
  frames: 150_000_000,
  duration_seconds: 1562.5,
  audio_bytes: 900_000_000,
};

function peaks(buckets = 1200) {
  return {
    version: 1,
    asset_id: 'hash-a',
    buckets,
    channels: 2,
    frames: info.frames,
    sample_rate: info.sample_rate,
    min: Array.from({ length: buckets * 2 }, (_, index) => -((index % 10) / 10)),
    max: Array.from({ length: buckets * 2 }, (_, index) => (index % 10) / 10),
  };
}

function windowBytes(frames = 4800) {
  return encodeWav([new Float32Array(frames)], 96_000, { bitDepth: 16 });
}

/**
 * Wait for the header read to land.
 *
 * Not the canvas: it carries role="img" from the first paint, so awaiting it
 * proves nothing and lets a click race the read. The summary line is the only
 * thing on screen that cannot appear before `localAudioInfo` resolves.
 */
async function headerRead() {
  await screen.findByText(/96\.0 khz/);
}

describe('TakeAudition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localAudioInfo).mockResolvedValue(info);
    vi.mocked(localAudioPeaks).mockResolvedValue(peaks());
    vi.mocked(localAudioWindow).mockResolvedValue(windowBytes());
  });

  it('describes a long take from its header and draws it from cached peaks, never loading it', async () => {
    render(<TakeAudition asset={asset} />);
    await waitFor(() => expect(localAudioPeaks).toHaveBeenCalledWith('hash-a', 1200));
    expect(localAudioInfo).toHaveBeenCalledWith('hash-a');
    expect(await screen.findByText(/2 channels · 96\.0 khz · 24-bit · 26:02/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /waveform of long take\.wav/i })).toBeInTheDocument();
    expect(localAudioWindow).not.toHaveBeenCalled();
  });

  it('leaves the transport disabled until the header has been read', async () => {
    // Held open so the component sits in the state a big take on a slow disk puts it in.
    let landHeader = (_info: typeof info) => {};
    vi.mocked(localAudioInfo).mockReturnValue(new Promise(resolve => { landHeader = resolve; }));
    render(<TakeAudition asset={asset} />);

    // The canvas carries role="img" from the first paint, so its presence proves
    // nothing about the read — this is what the racing version of the next test
    // waited on. The header line is the honest signal.
    expect(screen.getByRole('button', { name: 'play from playhead' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'play region' })).toBeDisabled();
    expect(screen.getByText('reading this take…')).toBeInTheDocument();

    landHeader(info);
    await waitFor(() => expect(screen.getByRole('button', { name: 'play from playhead' })).toBeEnabled());
  });

  it('plays a bounded window from the playhead rather than the whole file', async () => {
    render(<TakeAudition asset={asset} />);
    // Waiting for the header line, not the canvas: the canvas is always mounted.
    await screen.findByText(/96\.0 khz/);
    fireEvent.click(screen.getByRole('button', { name: 'play from playhead' }));
    await waitFor(() => expect(localAudioWindow).toHaveBeenCalledTimes(1));
    const [assetId, startFrame, frames] = vi.mocked(localAudioWindow).mock.calls[0];
    expect(assetId).toBe('hash-a');
    expect(startFrame).toBe(0);
    expect(frames).toBe(96_000 * 30);
    expect(frames).toBeLessThan(info.frames);
  });

  it('marks in and out from the keyboard, snapping through a short read', async () => {
    render(<TakeAudition asset={asset} />);
    const panel = await screen.findByRole('region', { name: /audition long take\.wav/i });
    fireEvent.change(screen.getByLabelText('Region start in frames'), { target: { value: '48000' } });
    fireEvent.keyDown(panel, { key: 'o' });
    await waitFor(() => expect(localAudioWindow).toHaveBeenCalled());
    // Snapping reads a small neighbourhood, not the take.
    const [, start, frames] = vi.mocked(localAudioWindow).mock.calls[0];
    expect(frames).toBe(2048);
    expect(start).toBeGreaterThanOrEqual(0);
  });

  it('saves a named region as metadata and lists it', async () => {
    vi.mocked(catalogSaveRegion).mockResolvedValue({ id: 'r1', name: 'kick', start_frame: 1000, end_frame: 5000, created_unix: 1 });
    const onRegionsChanged = vi.fn();
    render(<TakeAudition asset={asset} onRegionsChanged={onRegionsChanged} />);
    await headerRead();

    fireEvent.change(screen.getByLabelText('Region start in frames'), { target: { value: '1000' } });
    fireEvent.change(screen.getByLabelText('Region end in frames'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Region name'), { target: { value: 'kick' } });
    fireEvent.click(screen.getByRole('button', { name: 'save region' }));

    await waitFor(() => expect(catalogSaveRegion).toHaveBeenCalledWith('hash-a', { name: 'kick', start_frame: 1000, end_frame: 5000 }));
    expect(await screen.findByRole('button', { name: 'kick' })).toBeInTheDocument();
    expect(onRegionsChanged).toHaveBeenCalledWith([{ id: 'r1', name: 'kick', start_frame: 1000, end_frame: 5000, created_unix: 1 }]);
  });

  it('suggests a name from the take rather than blocking on an empty field', async () => {
    vi.mocked(catalogSaveRegion).mockResolvedValue({ id: 'r1', name: 'long take 01', start_frame: 0, end_frame: 96_000, created_unix: 1 });
    render(<TakeAudition asset={asset} />);
    await headerRead();
    fireEvent.click(screen.getByRole('button', { name: 'save region' }));
    await waitFor(() => expect(catalogSaveRegion).toHaveBeenCalledWith('hash-a', expect.objectContaining({ name: 'long take 01' })));
  });

  it('will not save a region with no length', async () => {
    render(<TakeAudition asset={asset} />);
    await headerRead();
    fireEvent.change(screen.getByLabelText('Region end in frames'), { target: { value: '0' } });
    expect(screen.getByRole('button', { name: 'save region' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'play region' })).toBeDisabled();
  });

  it('shows saved regions, recalls one, and removes it', async () => {
    const withRegion: CatalogAsset = { ...asset, regions: [{ id: 'r1', name: 'snare hit', start_frame: 96_000, end_frame: 144_000, created_unix: 1 }] };
    vi.mocked(catalogDeleteRegion).mockResolvedValue([]);
    render(<TakeAudition asset={withRegion} />);
    await headerRead();

    expect(screen.getByText('0:01.00 → 0:01.50')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'snare hit' }));
    expect(screen.getByLabelText('Region start in frames')).toHaveValue(96_000);

    fireEvent.click(screen.getByRole('button', { name: 'to drum lab' }));
    expect(toDrumLab).toHaveBeenCalledWith(
      { assetId: 'hash-a', takeName: 'long take.wav', sampleRate: 96_000 },
      withRegion.regions![0],
    );
    fireEvent.click(screen.getByRole('button', { name: 'to sample lab' }));
    expect(toSampleLab).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    await waitFor(() => expect(catalogDeleteRegion).toHaveBeenCalledWith('hash-a', 'r1'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'snare hit' })).not.toBeInTheDocument());
  });

  it('surfaces a read failure instead of drawing nothing silently', async () => {
    vi.mocked(localAudioInfo).mockRejectedValue(new Error('That take is not a regular file.'));
    render(<TakeAudition asset={asset} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('not a regular file');
  });

  it('sends several selected regions to a builder in one action', async () => {
    const regions = [
      { id: 'r1', name: 'kick', start_frame: 0, end_frame: 48_000, created_unix: 1 },
      { id: 'r2', name: 'snare', start_frame: 96_000, end_frame: 144_000, created_unix: 2 },
      { id: 'r3', name: 'hat', start_frame: 192_000, end_frame: 200_000, created_unix: 3 },
    ];
    render(<TakeAudition asset={{ ...asset, regions }} />);
    await headerRead();

    // One selected is not a batch; the per-region buttons already cover that.
    fireEvent.click(screen.getByLabelText('Select kick'));
    expect(screen.queryByRole('button', { name: /send \d+ to drum lab/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select hat'));
    expect(screen.getByText('2 regions selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'send 2 to drum lab' }));
    expect(sendMany).toHaveBeenCalledWith(
      { assetId: 'hash-a', takeName: 'long take.wav', sampleRate: 96_000 },
      [regions[0], regions[2]],
      'drum',
    );

    fireEvent.click(screen.getByRole('button', { name: 'send 2 to sample lab' }));
    expect(sendMany).toHaveBeenLastCalledWith(expect.anything(), [regions[0], regions[2]], 'multisample');
  });

  it('clears the selection on demand', async () => {
    const regions = [
      { id: 'r1', name: 'kick', start_frame: 0, end_frame: 48_000, created_unix: 1 },
      { id: 'r2', name: 'snare', start_frame: 96_000, end_frame: 144_000, created_unix: 2 },
    ];
    render(<TakeAudition asset={{ ...asset, regions }} />);
    await headerRead();
    fireEvent.click(screen.getByLabelText('Select kick'));
    fireEvent.click(screen.getByLabelText('Select snare'));
    expect(screen.getByText('2 regions selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'clear selection' }));
    expect(screen.queryByText('2 regions selected')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select kick')).not.toBeChecked();
  });
});

describe('TakeAudition — the marks read in the panel\'s own units', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(localAudioInfo).mockResolvedValue(info);
    vi.mocked(localAudioPeaks).mockResolvedValue(peaks());
    vi.mocked(localAudioWindow).mockResolvedValue(windowBytes());
  });

  it('shows each mark as a time as well as a frame', async () => {
    // The fields take frames, because marking and zero-crossing snapping are
    // frame-exact. Everything else in the panel — the take's length, the selection,
    // the saved regions — is read in minutes and seconds, so the marks were the one
    // place asking the reader to convert 44100 in their head.
    render(<TakeAudition asset={asset} />);
    await waitFor(() => expect(localAudioInfo).toHaveBeenCalled());

    const start = screen.getByLabelText('Region start in frames');
    const end = screen.getByLabelText('Region end in frames');
    // Converted with the take's own sample rate — this fixture is 96 kHz, not the
    // 44.1 kHz it would be tempting to assume.
    expect(info.sample_rate).toBe(96_000);
    fireEvent.change(start, { target: { value: '1920000' } });
    fireEvent.change(end, { target: { value: '2880000' } });
    expect(start.closest('label')).toHaveTextContent('0:20.00');
    expect(end.closest('label')).toHaveTextContent('0:30.00');
  });
});
