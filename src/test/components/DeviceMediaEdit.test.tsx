import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceMediaPage, describeDeletion } from '../../components/device/DeviceMediaPage';
import { mtpDelete, mtpRename, mtpScanTree } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({
  exportDeviceFiles: vi.fn(),
  exportDeviceStems: vi.fn(),
  mtpDelete: vi.fn(),
  mtpRename: vi.fn(),
  mtpScanTree: vi.fn(async () => ({ entries: [], missing_roots: [], roots: [] })),
  catalogAssets: vi.fn(async () => []),
}));
vi.mock('../../utils/deviceAudio', () => ({ readDevicePreview: vi.fn() }));
vi.mock('../../utils/deviceOperation', () => ({ deviceOperation: (run: () => Promise<void>) => run() }));

const dispatch = vi.fn();
const state = {
  tauriDevice: { model: 'TP-7 MTP Device', kind: 'tp-7', serial: 'F1RYA129' },
  tauriTreeEntries: [
    { path: 'recordings/2026-02-23_112713_000.wav', handle: 7, parent_handle: 1, is_directory: false, size: 19_800_000, modified: '2026-02-23T11:27:13' },
  ],
};
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch }) }));

describe('renaming a file on the device', () => {
  beforeEach(() => vi.clearAllMocks());

  /**
   * The recorder names every file after the moment it was made, so renaming is the
   * default act on this list rather than an occasional one — which is why the name
   * itself is the control.
   */
  it('renames from the list and keeps the extension the user never typed', async () => {
    vi.mocked(mtpRename).mockResolvedValue('yard door slam.wav');
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /Rename 2026-02-23_112713_000/ }));
    const field = screen.getByRole('textbox', { name: /Rename 2026-02-23_112713_000/ });
    fireEvent.change(field, { target: { value: 'yard door slam' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    // The extension is carried over rather than retyped; the native layer refuses a
    // change of ending anyway, so asking for it would only produce refusals.
    await waitFor(() => expect(mtpRename).toHaveBeenCalledWith(7, 'yard door slam.wav'));
    // Re-read rather than patched locally: if the device kept the old name, the list
    // must not be the only thing claiming otherwise.
    expect(mtpScanTree).toHaveBeenCalled();
  });

  it('writes nothing when the name is unchanged or the edit is abandoned', async () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /Rename / }));
    fireEvent.blur(screen.getByRole('textbox', { name: /Rename / }));
    fireEvent.click(await screen.findByRole('button', { name: /Rename / }));
    const field = screen.getByRole('textbox', { name: /Rename / });
    fireEvent.change(field, { target: { value: 'discarded' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Rename / })).toBeNull());
    expect(mtpRename).not.toHaveBeenCalled();
  });

  it('keeps the field open with the text intact when the device refuses', async () => {
    vi.mocked(mtpRename).mockRejectedValue(new Error('slam.wav is already in that folder. Choose another name.'));
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('button', { name: /Rename / }));
    const field = screen.getByRole('textbox', { name: /Rename / });
    fireEvent.change(field, { target: { value: 'slam' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent(/already in that folder/);
    expect(screen.getByRole('textbox', { name: /Rename / })).toHaveValue('slam');
  });
});

describe('deleting files from the device', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks before deleting, and does nothing if the answer is no', async () => {
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Select / }));
    fireEvent.click(screen.getByRole('button', { name: /^delete/ }));
    expect(await screen.findByText(/cannot be undone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    await waitFor(() => expect(screen.queryByText(/cannot be undone/)).toBeNull());
    expect(mtpDelete).not.toHaveBeenCalled();
  });

  it('deletes on confirmation and reports what actually went', async () => {
    vi.mocked(mtpDelete).mockResolvedValue({ deleted: ['2026-02-23_112713_000.wav'], deleted_bytes: 19_800_000, already_gone: 0, failed: [] });
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Select / }));
    fireEvent.click(screen.getByRole('button', { name: /^delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: /delete it/ }));
    await waitFor(() => expect(mtpDelete).toHaveBeenCalledWith([7]));
    expect(mtpScanTree).toHaveBeenCalled();
  });

  /**
   * A partial failure must name the file that is still there. "3 of 4 deleted" is the
   * one phrasing that tells the user nothing they can act on.
   */
  it('names the file that survived rather than giving a count', async () => {
    vi.mocked(mtpDelete).mockResolvedValue({
      deleted: [], deleted_bytes: 0, already_gone: 0,
      failed: [{ name: '2026-02-23_112713_000.wav', error: 'The device still reports this file. Nothing was removed.' }],
    });
    render(<DeviceMediaPage mode="recordings" />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /Select / }));
    fireEvent.click(screen.getByRole('button', { name: /^delete/ }));
    fireEvent.click(await screen.findByRole('button', { name: /delete it/ }));
    expect(await screen.findByText(/2026-02-23_112713_000\.wav: The device still reports this file/)).toBeInTheDocument();
  });
});

/**
 * The sentence shown at the irreversible moment.
 *
 * MTP has no trash, so the one fact worth putting in front of someone is whether a copy
 * survives on this Mac — which the catalog already knows, for free, because it records
 * where every take came from.
 */
describe('the deletion warning', () => {
  const row = (name: string, path: string, size = 1_000_000) => ({ name, size, files: [{ relative_path: path }] });
  const inLibrary = (...paths: string[]) => new Map(paths.map(path => [path.toLowerCase(), new Set([''])]));

  it('says a copy survives when every file is already in the library', () => {
    const message = describeDeletion([row('a', 'recordings/a.wav')], inLibrary('recordings/a.wav'), 'F1RYA129');
    expect(message).toContain('already in your takes library');
    expect(message).toContain('cannot be undone');
  });

  it('is blunt when nothing selected has been imported', () => {
    const message = describeDeletion([row('a', 'recordings/a.wav')], new Map(), 'F1RYA129');
    expect(message).toContain('gone for good');
  });

  /** The mixed case is the dangerous one, so it names the files at risk. */
  it('names exactly the files that exist nowhere else', () => {
    const message = describeDeletion(
      [row('a', 'recordings/a.wav'), row('b', 'recordings/b.wav'), row('c', 'recordings/c.wav')],
      inLibrary('recordings/a.wav', 'recordings/c.wav'),
      'F1RYA129',
    );
    expect(message).toContain('1 of these is not in your takes library');
    expect(message).toContain('b');
    expect(message).not.toContain('a, b, c');
  });

  it('reports the space it frees', () => {
    expect(describeDeletion([row('a', 'recordings/a.wav', 19_800_000)], new Map(), null)).toMatch(/18\.9 mb|19\.8 mb/i);
  });
});
