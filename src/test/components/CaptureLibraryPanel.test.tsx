import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CaptureLibraryPanel } from '../../components/library/CaptureLibraryPanel';
import { catalogAssets, catalogChoose, catalogImportFromDevice, catalogImportLocal, catalogOpen, catalogTransfers, catalogLabelAsset } from '../../utils/tauriBridge';
import type { CatalogAsset } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({
  catalogImportLocal: vi.fn(),
  catalogOpen: vi.fn(),
  catalogChoose: vi.fn(),
  catalogAssets: vi.fn(),
  catalogImportFromDevice: vi.fn(),
  catalogTransfers: vi.fn(),
  catalogLabelAsset: vi.fn(),
}));
vi.mock('../../components/library/TakeAudition', () => ({ TakeAudition: () => null }));

const state: {
  tauriDevice: { model: string; kind: string; serial?: string } | null;
  tauriSamples: Array<{ handle: number; name: string; size: number; path?: string | null }>;
  tauriTreeEntries: Array<{ path: string; handle: number; parent_handle: number; is_directory: boolean; size: number; modified: string | null }>;
} = { tauriDevice: null, tauriSamples: [], tauriTreeEntries: [] };
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state }) }));

const asset: CatalogAsset = {
  id: 'abc123',
  stored_path: 'originals/2026-02-23_112713_000.wav',
  original_name: '2026-02-23_112713_000.wav',
  bytes: 48_000_000,
  first_imported_unix: 1_772_000_000,
  occurrences: [
    { source: 'device', device_model: 'TP-7', device_serial: 'F1RTL11C', source_path: 'recordings/2026-02-23_112713_000.wav', captured_at: '2026-02-23T11:27:13', imported_unix: 1_772_000_000 },
  ],
};

function tp7Entry(name: string, handle = 9, size = 1000) {
  return { path: `recordings/${name}`, handle, parent_handle: 1, is_directory: false, size, modified: '2026-02-24T09:00:00' };
}

describe('CaptureLibraryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tauriDevice = null;
    state.tauriSamples = [];
    state.tauriTreeEntries = [];
    vi.mocked(catalogOpen).mockResolvedValue({ path: '/Users/nick/Music/Fieldwork Library', assets: 1, bytes: 48_000_000, occurrences: 1 });
    vi.mocked(catalogAssets).mockResolvedValue([asset]);
    vi.mocked(catalogTransfers).mockResolvedValue([]);
  });

  it('opens the library at its default location with no dialog on first run', async () => {
    render(<CaptureLibraryPanel />);
    await waitFor(() => expect(catalogOpen).toHaveBeenCalledWith());
    expect(catalogChoose).not.toHaveBeenCalled();
    // Home folders are shown as ~/… rather than exposing a user name.
    expect(await screen.findByText('~/Music/Fieldwork Library')).toBeInTheDocument();
    expect(screen.getByText(/1 take · 45\.8 MB · 1 recorded source/i)).toBeInTheDocument();
  });

  it('lists a take with where it came from, and works with nothing connected', async () => {
    render(<CaptureLibraryPanel />);
    expect(await screen.findByText('2026-02-23_112713_000.wav')).toBeInTheDocument();
    expect(screen.getByText('originals/2026-02-23_112713_000.wav')).toBeInTheDocument();
    expect(screen.getByText(/from TP-7 · recordings\/2026-02-23_112713_000\.wav · recorded 2026-02-23 11:27/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /import/i })).not.toBeInTheDocument();
  });

  it('filters takes by name, device or source path', async () => {
    render(<CaptureLibraryPanel />);
    await screen.findByText('2026-02-23_112713_000.wav');
    fireEvent.change(screen.getByLabelText('Search takes'), { target: { value: 'tp-7' } });
    expect(screen.getByText('2026-02-23_112713_000.wav')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search takes'), { target: { value: 'nothing here' } });
    expect(screen.queryByText('2026-02-23_112713_000.wav')).not.toBeInTheDocument();
    expect(screen.getByText(/No takes match/)).toBeInTheDocument();
  });

  it('offers only the device takes that are not already in the library', async () => {
    state.tauriDevice = { model: 'TP-7 MTP Device', kind: 'tp-7' };
    state.tauriTreeEntries = [
      tp7Entry('2026-02-23_112713_000.wav', 7),        // already imported
      tp7Entry('2026-02-24_090000_000.wav', 8),        // new
      { ...tp7Entry('folder', 5), is_directory: true },
      tp7Entry('notes.txt', 6),                        // not audio
    ];
    render(<CaptureLibraryPanel />);
    const button = await screen.findByRole('button', { name: /import 1 new/i });
    expect(screen.getByText(/1 take on tp-7 mtp device is not in your library yet, matched by name/i)).toBeInTheDocument();

    vi.mocked(catalogImportFromDevice).mockResolvedValue([
      { source_path: 'recordings/2026-02-24_090000_000.wav', status: 'imported', asset_id: 'def456', error: null },
    ]);
    fireEvent.click(button);
    await waitFor(() => expect(catalogImportFromDevice).toHaveBeenCalledWith([
      { handle: 8, path: 'recordings/2026-02-24_090000_000.wav', size: 1000, captured_at: '2026-02-24T09:00:00' },
    ]));
    expect(await screen.findByText(/1 imported · 0 already in your library · 0 failed/)).toBeInTheDocument();
  });

  it('reports duplicates as a normal outcome and failures with their reason', async () => {
    state.tauriDevice = { model: 'TP-7 MTP Device', kind: 'tp-7' };
    state.tauriTreeEntries = [tp7Entry('new one.wav', 8), tp7Entry('another.wav', 9)];
    vi.mocked(catalogImportFromDevice).mockResolvedValue([
      { source_path: 'recordings/new one.wav', status: 'already in library', asset_id: 'abc123', error: null },
      { source_path: 'recordings/another.wav', status: 'failed', asset_id: null, error: 'USB disconnected' },
    ]);
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /import 2 new/i }));
    const status = await screen.findByText(/0 imported · 1 already in your library · 1 failed/);
    expect(status).toHaveTextContent('recordings/another.wav (USB disconnected)');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses the OP-XY sample library as its import source, at the path the device reported', async () => {
    state.tauriDevice = { model: 'OP-XY', kind: 'op-xy' };
    // The scan reports where the sample really is. A take's source path is kept
    // forever as its provenance, so it has to be the true one rather than a guess
    // at a folder layout.
    state.tauriSamples = [{ handle: 30, name: 'field kick.wav', size: 2048, path: 'samples/breaks/field kick.wav' }];
    vi.mocked(catalogImportFromDevice).mockResolvedValue([
      { source_path: 'samples/breaks/field kick.wav', status: 'imported', asset_id: 'ghi789', error: null },
    ]);
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /import 1 new/i }));
    await waitFor(() => expect(catalogImportFromDevice).toHaveBeenCalledWith([
      { handle: 30, path: 'samples/breaks/field kick.wav', size: 2048 },
    ]));
  });

  it('falls back to the samples folder itself rather than inventing a subfolder', async () => {
    state.tauriDevice = { model: 'OP-XY', kind: 'op-xy' };
    state.tauriSamples = [{ handle: 31, name: 'loop.wav', size: 512 }];
    vi.mocked(catalogImportFromDevice).mockResolvedValue([
      { source_path: 'samples/loop.wav', status: 'imported', asset_id: 'jkl012', error: null },
    ]);
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /import 1 new/i }));
    await waitFor(() => expect(catalogImportFromDevice).toHaveBeenCalledWith([
      { handle: 31, path: 'samples/loop.wav', size: 512 },
    ]));
  });

  it('says so when a library cannot be opened instead of showing an empty one', async () => {
    vi.mocked(catalogOpen).mockRejectedValue(new Error('This library was written by a newer version of Fieldwork'));
    render(<CaptureLibraryPanel />);
    expect(await screen.findByRole('alert')).toHaveTextContent('newer version of Fieldwork');
    expect(screen.queryByText(/No takes yet/)).not.toBeInTheDocument();

    // And it stops claiming to be opening one. The header said "opening your
    // library…" for ever, directly above the error explaining that it never would.
    expect(screen.queryByText(/opening your library/i)).toBeNull();
    expect(screen.getByText(/no library open/i)).toBeInTheDocument();
    expect(screen.getByText(/Choose a different folder/i)).toBeInTheDocument();
    // Adding files needs somewhere to add them to, so it is not offered.
    expect(screen.getByRole('button', { name: 'add files…' })).toBeDisabled();
  });

  it('keeps the current library when the folder picker is cancelled', async () => {
    vi.mocked(catalogChoose).mockResolvedValue(null);
    render(<CaptureLibraryPanel />);
    await screen.findByText('~/Music/Fieldwork Library');
    fireEvent.click(screen.getByRole('button', { name: 'Change location…' }));
    await waitFor(() => expect(catalogChoose).toHaveBeenCalled());
    expect(screen.getByText('~/Music/Fieldwork Library')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows what has been sent to which instrument, including a failure', async () => {
    vi.mocked(catalogTransfers).mockResolvedValue([
      { id: 't2', sent_unix: 1_772_100_000, device_model: 'OP-XY', device_serial: 'XY-1', destination: 'presets/drum', name: 'field kit', files: [{ path: 'patch.json', bytes: 512 }], outcome: 'verified', error: null, source_asset_id: 'abc123', source_region: 'kick 01' },
      { id: 't1', sent_unix: 1_772_000_000, device_model: 'OP-XY', device_serial: 'XY-1', destination: 'presets/keys', name: 'pad set', files: [], outcome: 'failed', error: 'A preset with this name already exists', source_asset_id: null, source_region: null },
    ]);
    render(<CaptureLibraryPanel />);
    const history = await screen.findByText(/Sent to devices \(2\)/);
    expect(history).toBeInTheDocument();
    expect(screen.getByText('field kit')).toBeInTheDocument();
    expect(screen.getByText(/verified on op-xy · XY-1/)).toBeInTheDocument();
    expect(screen.getByText(/failed writing to op-xy/)).toBeInTheDocument();
    expect(screen.getByText('A preset with this name already exists')).toBeInTheDocument();
  });

  it('keeps the library usable when history cannot be read', async () => {
    vi.mocked(catalogTransfers).mockRejectedValue(new Error('no history'));
    render(<CaptureLibraryPanel />);
    expect(await screen.findByText('2026-02-23_112713_000.wav')).toBeInTheDocument();
    expect(screen.queryByText(/Sent to devices/)).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('walks the list with the arrow keys and auditions with space', async () => {
    const second: CatalogAsset = { ...asset, id: 'def456', stored_path: 'originals/second.wav', original_name: 'second.wav' };
    vi.mocked(catalogAssets).mockResolvedValue([asset, second]);
    render(<CaptureLibraryPanel />);

    const options = await screen.findAllByRole('option');
    expect(options).toHaveLength(2);
    // One tab stop for the whole list, per the keyboard contract.
    expect(options[0]).toHaveAttribute('tabindex', '0');
    expect(options[1]).toHaveAttribute('tabindex', '-1');

    fireEvent.keyDown(options[0], { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('listbox', { name: 'Takes' })).toHaveAttribute('aria-activedescendant', 'take-def456');

    fireEvent.keyDown(screen.getAllByRole('option')[1], { key: ' ' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('auditioning')).toBeInTheDocument();

    // Space again closes it.
    fireEvent.keyDown(screen.getAllByRole('option')[1], { key: ' ' });
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('keeps arrow keys inside the list and supports home and end', async () => {
    const more = ['b', 'c'].map(suffix => ({ ...asset, id: suffix, original_name: `${suffix}.wav`, stored_path: `originals/${suffix}.wav` }));
    vi.mocked(catalogAssets).mockResolvedValue([asset, ...more]);
    render(<CaptureLibraryPanel />);
    const options = await screen.findAllByRole('option');

    fireEvent.keyDown(options[0], { key: 'ArrowUp' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(screen.getAllByRole('option')[0], { key: 'End' });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(screen.getAllByRole('option')[2], { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(screen.getAllByRole('option')[2], { key: 'Home' });
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('tabindex', '0');
  });

  it('clicking a row auditions it, and clicking again closes it', async () => {
    render(<CaptureLibraryPanel />);
    const option = (await screen.findAllByRole('option'))[0];
    fireEvent.click(option);
    expect(screen.getByRole('option', { name: '2026-02-23_112713_000.wav' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: '2026-02-23_112713_000.wav' }));
    expect(screen.getByRole('option', { name: '2026-02-23_112713_000.wav' })).toHaveAttribute('aria-selected', 'false');
  });
});

describe('CaptureLibraryPanel — what counts as a take', () => {
  function fieldEntry(path: string, handle: number) {
    return { path, handle, parent_handle: 1, is_directory: false, size: 2000, modified: '2026-03-01T10:00:00' };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    state.tauriSamples = [];
    vi.mocked(catalogOpen).mockResolvedValue({ path: '/Users/nick/Music/Fieldwork Library', assets: 0, bytes: 0, occurrences: 0 });
    vi.mocked(catalogAssets).mockResolvedValue([]);
    vi.mocked(catalogTransfers).mockResolvedValue([]);
  });

  it('offers a field\'s tape and album audio, and leaves its patch library alone', async () => {
    state.tauriDevice = { model: 'OP-1 Field', kind: 'op-1-field' };
    state.tauriTreeEntries = [
      fieldEntry('tape/side-1/track_1.aif', 11),
      fieldEntry('album/side-a.aif', 12),
      // A patch library is not a set of recordings. Sweeping these in would copy
      // someone's whole instrument collection into a library meant for takes.
      fieldEntry('drum/user/my kit.aif', 13),
      fieldEntry('synth/user/pad.aif', 14),
    ];
    render(<CaptureLibraryPanel />);
    expect(await screen.findByRole('button', { name: 'import 2 new' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'import 2 new' }));
    await waitFor(() => expect(catalogImportFromDevice).toHaveBeenCalled());
    const requested = vi.mocked(catalogImportFromDevice).mock.calls[0][0].map(request => request.path);
    expect(requested).toEqual(['tape/side-1/track_1.aif', 'album/side-a.aif']);
  });

  it('says where takes come from when there is nothing new, so the button is never a mystery', async () => {
    state.tauriDevice = { model: 'OP-1 Field', kind: 'op-1-field' };
    state.tauriTreeEntries = [fieldEntry('drum/user/my kit.aif', 13)];
    render(<CaptureLibraryPanel />);

    expect(await screen.findByRole('button', { name: 'nothing new to import' })).toBeInTheDocument();
    expect(screen.getByText(/Nothing new in tape\/ and album\/ on op-1 field/)).toBeInTheDocument();
    expect(screen.getByText(/not from your drum and synth patches/)).toBeInTheDocument();
  });

  it('takes everything a tp-7 holds, because all of it is a recording', async () => {
    state.tauriDevice = { model: 'TP-7 MTP Device', kind: 'tp-7' };
    state.tauriTreeEntries = [tp7Entry('a.wav', 21), { ...tp7Entry('b.wav', 22), path: 'memo/b.wav' }];
    render(<CaptureLibraryPanel />);
    expect(await screen.findByRole('button', { name: 'import 2 new' })).toBeInTheDocument();
  });
});

describe('CaptureLibraryPanel — a field with two tape sides', () => {
  it('offers both sides even though every track has the same name', async () => {
    state.tauriDevice = { model: 'OP-1 Field', kind: 'op-1-field', serial: 'OP1-1' };
    state.tauriTreeEntries = [
      { path: 'tape/side-1/track_1.aif', handle: 41, parent_handle: 1, is_directory: false, size: 100, modified: null },
      { path: 'tape/side-2/track_1.aif', handle: 42, parent_handle: 1, is_directory: false, size: 100, modified: null },
    ];
    vi.mocked(catalogAssets).mockResolvedValue([{
      id: 'a', stored_path: 'originals/a.aif', original_name: 'track_1.aif', bytes: 100, first_imported_unix: 1,
      occurrences: [{ source: 'device', device_model: 'OP-1 Field', device_serial: 'OP1-1', source_path: 'tape/side-1/track_1.aif', captured_at: null, imported_unix: 1 }],
    }]);
    render(<CaptureLibraryPanel />);

    // Side 1 is in the library; side 2 is a different recording with the same name.
    expect(await screen.findByRole('button', { name: 'import 1 new' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'import 1 new' }));
    await waitFor(() => expect(catalogImportFromDevice).toHaveBeenCalledWith([
      { handle: 42, path: 'tape/side-2/track_1.aif', size: 100, captured_at: null },
    ]));
  });
});

describe('CaptureLibraryPanel — recordings already on this Mac', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.tauriDevice = null;
    state.tauriSamples = [];
    state.tauriTreeEntries = [];
    vi.mocked(catalogOpen).mockResolvedValue({ path: '/Users/nick/Music/Fieldwork Library', assets: 0, bytes: 0, occurrences: 0 });
    vi.mocked(catalogAssets).mockResolvedValue([]);
    vi.mocked(catalogTransfers).mockResolvedValue([]);
  });

  it('adds files with nothing plugged in, which is the whole point', async () => {
    // Auditioning, marking regions and sending to a pad were reachable only through
    // a cable: a recording already on the Mac had to be put on an instrument first.
    vi.mocked(catalogImportLocal).mockResolvedValue([
      { source_path: '/Users/nick/Desktop/bounce.wav', status: 'imported', asset_id: 'x1', error: null },
    ]);
    render(<CaptureLibraryPanel />);
    const add = await screen.findByRole('button', { name: 'add files…' });
    // No device connected, and the button is still live.
    expect(screen.queryByRole('button', { name: /import \d+ new/ })).toBeNull();
    fireEvent.click(add);

    await waitFor(() => expect(catalogImportLocal).toHaveBeenCalled());
    expect(await screen.findByText(/1 imported · 0 already in your library · 0 failed/)).toBeInTheDocument();
    expect(catalogAssets).toHaveBeenCalledTimes(2);
  });

  it('says nothing at all when the chooser is cancelled', async () => {
    // An empty result is a cancelled dialog, not a transfer that moved no files.
    vi.mocked(catalogImportLocal).mockResolvedValue([]);
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'add files…' }));

    await waitFor(() => expect(catalogImportLocal).toHaveBeenCalled());
    expect(screen.queryByText(/imported ·/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports a failure without pretending the library changed', async () => {
    vi.mocked(catalogImportLocal).mockRejectedValue(new Error('Open your library before importing.'));
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'add files…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Open your library before importing');
  });

  it('offers both routes in the empty state', async () => {
    render(<CaptureLibraryPanel />);
    expect(await screen.findByText(/Add files from this Mac, or connect a recorder/)).toBeInTheDocument();
  });

  /**
   * Renaming from the list, which is where the user already is.
   *
   * A TP-7 names every file after its timestamp, so naming a take is the default act
   * rather than an occasional one. It used to require selecting the take and finding the
   * field inside the audition panel. The name itself is the control now.
   *
   * It writes a label: `catalog_label_asset` leaves the bytes, the file name and the
   * path alone, and nothing on the device is renamed.
   */
  it('renames a take by clicking its name in the list', async () => {
    vi.mocked(catalogAssets).mockResolvedValue([asset]);
    vi.mocked(catalogLabelAsset).mockResolvedValue({ ...asset, label: 'yard door slam' });
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rename 2026-02-23_112713_000/ }));
    const field = screen.getByRole('textbox', { name: /Rename 2026-02-23_112713_000/ });
    fireEvent.change(field, { target: { value: 'yard door slam' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(catalogLabelAsset).toHaveBeenCalledWith('abc123', 'yard door slam'));
    expect(await screen.findByText('yard door slam')).toBeInTheDocument();
    // The recorder's own name stays visible as provenance.
    expect(screen.getByText(/filed as 2026-02-23_112713_000\.wav/)).toBeInTheDocument();
  });

  it('does not write when the name is unchanged or the edit is abandoned', async () => {
    vi.mocked(catalogAssets).mockResolvedValue([asset]);
    render(<CaptureLibraryPanel />);
    fireEvent.click(await screen.findByRole('button', { name: /Rename / }));
    fireEvent.blur(screen.getByRole('textbox', { name: /Rename / }));
    fireEvent.click(await screen.findByRole('button', { name: /Rename / }));
    const field = screen.getByRole('textbox', { name: /Rename / });
    fireEvent.change(field, { target: { value: 'discarded' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Rename / })).toBeNull());
    expect(catalogLabelAsset).not.toHaveBeenCalled();
  });
});
