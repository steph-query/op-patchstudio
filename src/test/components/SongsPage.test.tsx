import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SongsPage } from '../../components/songs/SongsPage';
import {
  catalogAssets,
  collectionAddMember,
  collectionCreate,
  collectionDelete,
  collectionMoveMember,
  collectionNameMember,
  collectionPrune,
  collectionRemoveMember,
  collectionUpdate,
  collectionsList,
} from '../../utils/tauriBridge';
import type { CatalogAsset, CollectionSummary } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({
  catalogAssets: vi.fn(),
  collectionsList: vi.fn(),
  collectionCreate: vi.fn(),
  collectionUpdate: vi.fn(),
  collectionDelete: vi.fn(),
  collectionAddMember: vi.fn(),
  collectionRemoveMember: vi.fn(),
  collectionMoveMember: vi.fn(),
  collectionNameMember: vi.fn(),
  collectionPrune: vi.fn(),
}));

const take = (id: string, label: string): CatalogAsset => ({
  id,
  stored_path: `originals/${id}.wav`,
  original_name: `${id}.wav`,
  label,
  bytes: 19_800_000,
  first_imported_unix: 1_772_000_000,
  occurrences: [{ source: 'device', device_model: 'OP-1 field', device_serial: 'F1', source_path: `tape/${id}.aif`, captured_at: '2026-09-27T11:27:13', imported_unix: 1_772_000_000 }],
  regions: [{ id: `${id}-r1`, name: 'chorus', start_frame: 0, end_frame: 48_000, created_unix: 0 }],
});

const song = (over: Partial<CollectionSummary> = {}): CollectionSummary => ({
  id: 'song-1',
  name: 'yard door song',
  parent: null,
  note: null,
  tempo: null,
  members: [],
  created_unix: 0,
  child_ids: [],
  missing_members: 0,
  ...over,
});

describe('the binder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(catalogAssets).mockResolvedValue([take('a', 'verse idea 3'), take('b', 'yard door slam')]);
    vi.mocked(collectionsList).mockResolvedValue([]);
  });

  it('explains what a song is rather than showing an empty list', async () => {
    render(<SongsPage />);
    // An empty binder is the first thing a new user sees, so it has to teach the model:
    // a song is parts in order, and a part can be a region inside a take.
    expect(await screen.findByText(/a list of parts in order/i)).toBeInTheDocument();
  });

  it('starts a song from a typed name', async () => {
    vi.mocked(collectionCreate).mockResolvedValue(song());
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'new song' }));
    const field = screen.getByRole('textbox', { name: /name the song/i });
    fireEvent.change(field, { target: { value: 'yard door song' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(collectionCreate).toHaveBeenCalledWith('yard door song'));
  });

  it('does not create a song from an abandoned or empty name', async () => {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'new song' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: /name the song/i }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /name the song/i })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'new song' }));
    fireEvent.blur(screen.getByRole('textbox', { name: /name the song/i }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /name the song/i })).toBeNull());
    expect(collectionCreate).not.toHaveBeenCalled();
  });
});

describe('arranging a song', () => {
  const arranged = song({
    members: [
      { asset_id: 'a', region_id: null, name: 'intro', added_unix: 0 },
      { asset_id: 'b', region_id: null, name: 'verse', added_unix: 0 },
      { asset_id: 'a', region_id: 'a-r1', name: 'chorus', added_unix: 0 },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(catalogAssets).mockResolvedValue([take('a', 'verse idea 3'), take('b', 'yard door slam')]);
    vi.mocked(collectionsList).mockResolvedValue([arranged]);
    vi.mocked(collectionMoveMember).mockResolvedValue(arranged);
  });

  async function openSong() {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('treeitem', { name: 'yard door song' }));
    return screen.findByRole('listbox', { name: /parts of/i });
  }

  /**
   * The order *is* the arrangement, so it must be visible as a position rather than
   * inferable from names. This is the thing a folder cannot express and the reason
   * people number their filenames.
   */
  it('shows the parts in playing order, numbered', async () => {
    const list = await openSong();
    const parts = within(list).getAllByRole('option');
    expect(parts.map(part => part.querySelector('strong')?.textContent)).toEqual(['intro', 'verse', 'chorus']);
    expect(parts[0]).toHaveTextContent('1');
    expect(parts[2]).toHaveTextContent('3');
  });

  it('moves a part with the arrows, which is what reordering means here', async () => {
    const list = await openSong();
    fireEvent.click(within(list).getByRole('button', { name: /Move verse earlier/ }));
    await waitFor(() => expect(collectionMoveMember).toHaveBeenCalledWith('song-1', 1, 0));
  });

  /** A drag is unreachable without a pointer, so the same move has a key. */
  it('reorders from the keyboard with option and an arrow', async () => {
    const list = await openSong();
    const verse = within(list).getByRole('option', { name: 'verse' });
    fireEvent.keyDown(verse, { key: 'ArrowDown', altKey: true });
    await waitFor(() => expect(collectionMoveMember).toHaveBeenCalledWith('song-1', 1, 2));
  });

  it('cannot move the first part earlier or the last part later', async () => {
    const list = await openSong();
    expect(within(list).getByRole('button', { name: /Move intro earlier/ })).toBeDisabled();
    expect(within(list).getByRole('button', { name: /Move chorus later/ })).toBeDisabled();
  });

  /**
   * The same take appears twice — once whole, once as a marked region — which is the
   * case that makes regions worth having and that folders cannot represent.
   */
  it('holds one take twice when the parts are different regions of it', async () => {
    const list = await openSong();
    const parts = within(list).getAllByRole('option');
    expect(parts[0]).toHaveTextContent('intro');
    expect(parts[2]).toHaveTextContent('chorus');
    expect(parts[2]).toHaveTextContent(/region of/);
  });

  it('removes a part without touching the take', async () => {
    vi.mocked(collectionRemoveMember).mockResolvedValue(arranged);
    const list = await openSong();
    fireEvent.click(within(list).getByRole('button', { name: /Remove verse from this song/ }));
    await waitFor(() => expect(collectionRemoveMember).toHaveBeenCalledWith('song-1', 1));
  });

  it('names a part locally, leaving the take alone', async () => {
    vi.mocked(collectionNameMember).mockResolvedValue(arranged);
    const list = await openSong();
    fireEvent.click(within(list).getByRole('option', { name: 'verse' }));
    const field = await screen.findByRole('textbox', { name: 'Name this part' });
    fireEvent.change(field, { target: { value: 'verse (quiet)' } });
    fireEvent.blur(field);
    await waitFor(() => expect(collectionNameMember).toHaveBeenCalledWith('song-1', 1, 'verse (quiet)'));
  });

  it('offers only takes and regions the song does not already hold', async () => {
    await openSong();
    fireEvent.click(screen.getByRole('button', { name: 'add a part' }));
    const picker = await screen.findByRole('combobox');
    const offered = within(picker).getAllByRole('option').map(option => option.textContent);
    // 'a' whole and 'a-r1' are already in the song; 'b' whole is too. What is left is b's region.
    expect(offered.some(label => label?.includes('chorus — yard door slam'))).toBe(true);
    expect(offered.some(label => label === 'verse idea 3')).toBe(false);
  });

  it('adds the chosen part', async () => {
    vi.mocked(collectionAddMember).mockResolvedValue(arranged);
    await openSong();
    fireEvent.click(screen.getByRole('button', { name: 'add a part' }));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'b|b-r1' } });
    await waitFor(() => expect(collectionAddMember).toHaveBeenCalledWith('song-1', 'b', 'b-r1'));
  });
});

describe('the index card', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(catalogAssets).mockResolvedValue([take('a', 'verse idea 3')]);
    vi.mocked(collectionsList).mockResolvedValue([song({ note: 'second half is the good bit' })]);
    vi.mocked(collectionUpdate).mockResolvedValue(song());
  });

  /** The synopsis: what a filename can never hold and what you want six weeks later. */
  it('keeps a note on the song and saves it when the field is left', async () => {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('treeitem', { name: 'yard door song' }));
    const note = await screen.findByRole('textbox', { name: /notes on yard door song/i });
    expect(note).toHaveValue('second half is the good bit');
    fireEvent.change(note, { target: { value: 'try it at 90bpm' } });
    fireEvent.blur(note);
    await waitFor(() => expect(collectionUpdate).toHaveBeenCalledWith('song-1', { note: 'try it at 90bpm' }));
  });

  it('does not write a note that was not changed', async () => {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('treeitem', { name: 'yard door song' }));
    fireEvent.blur(await screen.findByRole('textbox', { name: /notes on/i }));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(collectionUpdate).not.toHaveBeenCalled();
  });

  it('takes a tempo', async () => {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('treeitem', { name: 'yard door song' }));
    const tempo = await screen.findByRole('spinbutton', { name: /tempo of/i });
    fireEvent.change(tempo, { target: { value: '120' } });
    fireEvent.blur(tempo);
    await waitFor(() => expect(collectionUpdate).toHaveBeenCalledWith('song-1', { tempo: 120 }));
  });
});

describe('when a take leaves the library', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(catalogAssets).mockResolvedValue([]);
    vi.mocked(collectionsList).mockResolvedValue([song({
      members: [{ asset_id: 'gone', region_id: null, name: 'verse', added_unix: 0 }],
      missing_members: 1,
    })]);
  });

  /**
   * Silently dropping the part would shrink an arrangement the user built, with no notice
   * that it had happened. It is reported, kept in place, and removed only when asked.
   */
  it('says so and keeps the arrangement until told otherwise', async () => {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('treeitem', { name: 'yard door song' }));
    expect(await screen.findByText(/one part points at a take that has left the library/i)).toBeInTheDocument();
    expect(within(screen.getByRole('listbox', { name: /parts of/i })).getAllByRole('option')).toHaveLength(1);
    expect(collectionPrune).not.toHaveBeenCalled();
  });

  it('removes the dead parts only when asked', async () => {
    vi.mocked(collectionPrune).mockResolvedValue(song());
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('treeitem', { name: 'yard door song' }));
    fireEvent.click(await screen.findByRole('button', { name: 'remove them' }));
    await waitFor(() => expect(collectionPrune).toHaveBeenCalledWith('song-1'));
  });
});

describe('forgetting a song', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(catalogAssets).mockResolvedValue([]);
    vi.mocked(collectionsList).mockResolvedValue([song({ child_ids: ['song-2'] })]);
  });

  /**
   * People expect deleting a container to delete its contents. Here it emphatically does
   * not, so the confirmation says so rather than relying on the user knowing.
   */
  it('promises the audio is untouched, and says where the songs inside it go', async () => {
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Forget yard door song' }));
    const message = await screen.findByText(/only this grouping goes/i);
    expect(message).toHaveTextContent(/takes and their audio stay exactly where they are/i);
    expect(message).toHaveTextContent(/1 songs filed under it move back to the top level/i);
    expect(collectionDelete).not.toHaveBeenCalled();
  });

  it('forgets it on confirmation', async () => {
    vi.mocked(collectionDelete).mockResolvedValue([]);
    render(<SongsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Forget yard door song' }));
    fireEvent.click(await screen.findByRole('button', { name: 'forget it' }));
    await waitFor(() => expect(collectionDelete).toHaveBeenCalledWith('song-1'));
  });
});
