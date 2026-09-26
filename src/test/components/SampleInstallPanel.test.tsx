import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SampleInstallPanel } from '../../components/device/SampleInstallPanel';
import { mtpScanTree, mtpUploadAtPath, mtpScanPresets } from '../../utils/tauriBridge';
import { renderSampleForTarget } from '../../utils/samplePreparation';
import type { ProbedSample } from '../../utils/samplePreparation';

vi.mock('../../utils/tauriBridge', () => ({
  mtpScanTree: vi.fn(),
  mtpUploadAtPath: vi.fn(),
  mtpScanPresets: vi.fn(),
}));

// Probing real audio is covered in samplePreparation.test.ts; here the metadata is fixed
// so the panel's planning, review and send behavior is what is under test.
vi.mock('../../utils/samplePreparation', () => ({
  probeSample: vi.fn(async (file: File) => ({
    file,
    audioBuffer: {} as AudioBuffer,
    candidate: {
      name: file.name,
      sizeBytes: file.size,
      durationSeconds: file.name.includes('long') ? 30 : 2,
      sampleRate: 44100,
      bitDepth: 16,
      channels: 1,
    },
  } satisfies ProbedSample)),
  renderSampleForTarget: vi.fn(async (_probe: ProbedSample, _profile: unknown, targetName: string) => ({
    name: targetName,
    bytes: new Uint8Array([1, 2, 3]),
    original: true,
  })),
  needsConversion: vi.fn(() => false),
}));

const state: {
  tauriDevice: { model: string; kind: string } | null;
  tauriStorageInfo: { freeSpace: number; capacity: number } | null;
} = { tauriDevice: { model: 'OP-XY', kind: 'op-xy' }, tauriStorageInfo: { freeSpace: 8_000_000_000, capacity: 8_000_000_000 } };
const dispatch = vi.fn();
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch }) }));

function audioFile(name: string) {
  return new File([new Uint8Array(2048)], name, { type: 'audio/wav' });
}

async function addFiles(names: string[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await userEvent.upload(input, names.map(audioFile));
}

beforeEach(() => {
  vi.clearAllMocks();
  state.tauriDevice = { model: 'OP-XY', kind: 'op-xy' };
  vi.mocked(mtpScanTree).mockResolvedValue({ entries: [], missing_roots: [], roots: [] });
  vi.mocked(mtpUploadAtPath).mockResolvedValue(42);
  vi.mocked(mtpScanPresets).mockResolvedValue({ presets: [], standalone_samples: [], projects: [] });
});

describe('SampleInstallPanel', () => {

  it('asks for a device instead of offering a write when nothing is connected', () => {
    state.tauriDevice = null;
    render(<SampleInstallPanel />);
    expect(screen.getByText(/connect a device to install samples/i)).toBeInTheDocument();
  });

  it('states the destination and what every file will become', async () => {
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalledWith(['samples']));
    expect(screen.getByText('samples')).toBeInTheDocument();
    expect(screen.getByText(/up to 20 s/)).toBeInTheDocument();
  });

  it('writes an accepted sample to the documented folder and reports it plainly', async () => {
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalled());
    await addFiles(['kick.wav']);

    const send = await screen.findByRole('button', { name: /send 1 sample/i });
    fireEvent.click(send);

    await waitFor(() => expect(mtpUploadAtPath).toHaveBeenCalledTimes(1));
    expect(mtpUploadAtPath).toHaveBeenCalledWith(['samples'], 'kick.wav', new Uint8Array([1, 2, 3]), false);
    expect(await screen.findByText(/1 sample written to samples and verified/i)).toBeInTheDocument();
    expect(mtpScanPresets).toHaveBeenCalled();
  });

  it('never sends a file the device would reject', async () => {
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalled());
    await addFiles(['long take.wav']);

    expect(await screen.findByText(/longer than the 20 second limit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send\s+samples/i })).toBeDisabled();
    expect(mtpUploadAtPath).not.toHaveBeenCalled();
  });

  it('renames rather than replacing a file already on the device', async () => {
    vi.mocked(mtpScanTree).mockResolvedValue({
      entries: [{ path: 'samples/kick.wav', handle: 1, parent_handle: 0, is_directory: false, size: 10, modified: null }],
      missing_roots: [],
      roots: [{ requested: 'samples', actual: 'samples', handle: 0 }],
    });
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalled());
    await addFiles(['kick.wav']);

    expect(await screen.findByText(/saves as kick 2\.wav/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /send 1 sample/i }));
    await waitFor(() => expect(mtpUploadAtPath).toHaveBeenCalledWith(['samples'], 'kick 2.wav', expect.anything(), false));
  });

  it('stops the batch on the first failure and says what was written', async () => {
    vi.mocked(mtpUploadAtPath)
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(new Error('USB disconnected'));
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalled());
    await addFiles(['one.wav', 'two.wav', 'three.wav']);

    fireEvent.click(await screen.findByRole('button', { name: /send 3 samples/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Stopped after 1 of 3');
    expect(alert).toHaveTextContent('USB disconnected');
    expect(alert).toHaveTextContent(/Nothing already on the device was changed/);
    expect(mtpUploadAtPath).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/verified on the device/i)).not.toBeInTheDocument();
  });

  it('keeps working when the device inventory cannot be listed', async () => {
    vi.mocked(mtpScanTree).mockRejectedValue(new Error('scan interrupted'));
    render(<SampleInstallPanel />);
    expect(await screen.findByText(/could not list samples on the device/i)).toBeInTheDocument();
    await addFiles(['kick.wav']);
    expect(await screen.findByRole('button', { name: /send 1 sample/i })).toBeEnabled();
  });

  it('offers both OP-1 field folders and converts for the selected one', async () => {
    state.tauriDevice = { model: 'OP-1 field', kind: 'op-1-field' };
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalledWith(['drum']));
    const select = screen.getByLabelText('Destination folder');
    expect(select).toHaveValue('op-1-field-drum');

    await addFiles(['snare.wav']);
    expect(await screen.findByText(/saves as snare\.aif/i)).toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'op-1-field-synth' } });
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalledWith(['synth']));
  });

  it('refuses a TP-7 subfolder its firmware cannot create', async () => {
    state.tauriDevice = { model: 'TP-7 MTP Device', kind: 'tp-7' };
    render(<SampleInstallPanel />);
    await waitFor(() => expect(mtpScanTree).toHaveBeenCalledWith(['recordings']));
    expect(screen.queryByLabelText('Subfolder name')).not.toBeInTheDocument();

    await addFiles(['take.wav']);
    fireEvent.click(await screen.findByRole('button', { name: /send 1 sample/i }));
    await waitFor(() => expect(mtpUploadAtPath).toHaveBeenCalledWith(['recordings'], 'take.wav', expect.anything(), false));
  });
});

describe('SampleInstallPanel conversion labels', () => {
  it('shows the field format line so the user knows what changes', async () => {
    state.tauriDevice = { model: 'OP-1 field', kind: 'op-1-field' };
    render(<SampleInstallPanel />);
    expect(await screen.findByText(/44\.1 khz · 16-bit · 12 s mono \/ 20 s stereo/)).toBeInTheDocument();
    expect(screen.getByText(/playability on your firmware is unverified/)).toBeInTheDocument();
    expect(renderSampleForTarget).not.toHaveBeenCalled();
  });
});
