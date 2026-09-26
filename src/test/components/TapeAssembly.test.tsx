import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TapeAssembly } from '../../components/device/TapeAssembly';
import { pickFolder, saveFileToFolder } from '../../utils/tauriBridge';
import { readAudioMetadata } from '../../utils/audioFormats';
import { audioBufferToAiff } from '../../utils/aiffExport';

vi.mock('../../utils/tauriBridge', () => ({ pickFolder: vi.fn(), saveFileToFolder: vi.fn() }));
vi.mock('../../utils/audioFormats', () => ({ readAudioMetadata: vi.fn() }));
vi.mock('../../utils/aiffExport', () => ({ audioBufferToAiff: vi.fn() }));

function audioFile(name: string, bytes = 2048) {
  return new File([new Uint8Array(bytes)], name, { type: 'audio/wav' });
}

async function add(names: string[]) {
  const input = document.querySelector('input[type=file]') as HTMLInputElement;
  await userEvent.upload(input, names.map(name => audioFile(name)));
}

describe('TapeAssembly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readAudioMetadata).mockResolvedValue({
      format: 'wav', sampleRate: 48000, bitDepth: 24, channels: 1, duration: 95,
      audioBuffer: {} as AudioBuffer, fileSize: 2048, midiNote: 60, loopStart: 0, loopEnd: 0, hasLoopData: false,
    } as Awaited<ReturnType<typeof readAudioMetadata>>);
    vi.mocked(audioBufferToAiff).mockResolvedValue(new Blob([new Uint8Array(64)], { type: 'audio/aiff' }));
    vi.mocked(pickFolder).mockResolvedValue('/Users/nick/Music/tape');
    vi.mocked(saveFileToFolder).mockResolvedValue({ path: '/Users/nick/Music/tape/track_1.aif', files: 1 });
  });

  it('shows four track slots and invites a first file', () => {
    render(<TapeAssembly />);
    expect(screen.getByText('Add one to four audio files to build a tape.')).toBeInTheDocument();
    for (const track of [1, 2, 3, 4]) {
      expect(screen.getByText(`track_${track}.aif`)).toBeInTheDocument();
    }
    expect(screen.getAllByText(/empty — not written/)).toHaveLength(4);
    expect(screen.getByRole('button', { name: /export/i })).toBeDisabled();
  });

  it('assigns files to tracks in order and states each conversion', async () => {
    render(<TapeAssembly />);
    await add(['drums.wav', 'bass.wav']);

    await waitFor(() => expect(screen.getByText('drums.wav · 1:35')).toBeInTheDocument());
    expect(screen.getByText('bass.wav · 1:35')).toBeInTheDocument();
    expect(screen.getAllByText('44.1 khz · 16-bit · mono to stereo · converted to .aif')).toHaveLength(2);
    expect(screen.getByText('2 of 4 tracks · 1:35 · 44.1 khz · 16-bit · stereo')).toBeInTheDocument();
    expect(screen.getAllByText(/empty — not written/)).toHaveLength(2);
  });

  it('writes each used track to the chosen folder and tells the user to copy them in', async () => {
    render(<TapeAssembly />);
    await add(['drums.wav', 'bass.wav']);
    await waitFor(() => expect(screen.getByText(/2 of 4 tracks/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export 2 tracks/i }));
    await waitFor(() => expect(saveFileToFolder).toHaveBeenCalledTimes(2));
    expect(vi.mocked(saveFileToFolder).mock.calls.map(call => call[0])).toEqual(['track_1.aif', 'track_2.aif']);
    expect(vi.mocked(saveFileToFolder).mock.calls.every(call => call[2] === '/Users/nick/Music/tape')).toBe(true);
    expect(vi.mocked(audioBufferToAiff).mock.calls[0][1]).toEqual({ bitDepth: 16, sampleRate: 44100, channels: 2 });
    expect(await screen.findByText(/2 tracks written to ~\/Music\/tape/)).toBeInTheDocument();
    expect(screen.getByText(/copy them into its tape folder yourself/)).toBeInTheDocument();
  });

  it('writes nothing when the folder picker is cancelled', async () => {
    vi.mocked(pickFolder).mockResolvedValue(null);
    render(<TapeAssembly />);
    await add(['drums.wav']);
    await waitFor(() => expect(screen.getByText(/1 of 4 tracks/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export 1 track/i }));
    await waitFor(() => expect(pickFolder).toHaveBeenCalled());
    expect(saveFileToFolder).not.toHaveBeenCalled();
    // The standing note also says "written to a folder on your Mac", so match the result line itself.
    expect(screen.queryByText(/written to ~\//)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('stops at an unreadable file and says how many were already saved', async () => {
    vi.mocked(readAudioMetadata)
      .mockResolvedValueOnce({
        format: 'wav', sampleRate: 44100, bitDepth: 16, channels: 2, duration: 30,
        audioBuffer: {} as AudioBuffer, fileSize: 2048, midiNote: 60, loopStart: 0, loopEnd: 0, hasLoopData: false,
      } as Awaited<ReturnType<typeof readAudioMetadata>>)
      .mockRejectedValueOnce(new Error('unsupported'));
    render(<TapeAssembly />);
    await add(['good.wav', 'broken.wav']);
    await waitFor(() => expect(screen.getByText(/2 of 4 tracks/)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /export 2 tracks/i }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('broken.wav could not be read as audio on this Mac');
    expect(alert).toHaveTextContent('1 track was already saved; existing files were left alone');
    expect(saveFileToFolder).toHaveBeenCalledTimes(1);
  });

  it('refuses to fill a fifth track', async () => {
    render(<TapeAssembly />);
    await add(['a.wav', 'b.wav', 'c.wav', 'd.wav', 'e.wav']);
    await waitFor(() => expect(screen.getByText(/4 of 4 tracks/)).toBeInTheDocument());
    expect(screen.queryByText('e.wav · 1:35')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'all four tracks filled' })).toBeDisabled();
  });

  it('says plainly that it will not write to the device', async () => {
    render(<TapeAssembly />);
    await add(['drums.wav']);
    await waitFor(() => expect(screen.getByText(/1 of 4 tracks/)).toBeInTheDocument());
    expect(screen.getByText(/will not do it over USB/)).toBeInTheDocument();
    expect(screen.getByText(/Slice markers are not produced/)).toBeInTheDocument();
  });
});
