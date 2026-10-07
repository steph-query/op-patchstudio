import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type { CatalogAsset, CollectionMember, CollectionSummary } from '../../utils/tauriBridge';
import { takeName } from '../../utils/takeOrigins';
import { describeError } from '../../utils/describeError';
import { formatFileSize } from '../../utils/audio';
import { ConfirmationModal } from '../common/ConfirmationModal';
import './songs.css';

/**
 * The binder: albums, songs, and the parts a song is assembled from.
 *
 * Modelled on Scrivener, and for the same reason. A writer does not compose a manuscript
 * top to bottom; they accumulate fragments and then decide which belong together and in
 * what order. Songwriting off a field recorder is the same shape — a pass off the OP-1's
 * tape tracks here, a marked chorus there, a voice note with the words — and the library
 * held every fragment while having no way to say any of that.
 *
 * Three panes, left to right: the binder of songs, the parts of the selected song in
 * playing order, and the index card for whatever is selected. The middle pane is the
 * corkboard — reordering it *is* arranging the song, because position in the list is the
 * arrangement rather than a naming convention.
 *
 * Nothing here moves a byte. A song is metadata beside the audio, so a part can appear in
 * several songs at once, and deleting a song never touches a recording.
 */
export function SongsPage() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [assets, setAssets] = useState<CatalogAsset[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** Which part of the selected song is showing its card, by position. */
  const [selectedPart, setSelectedPart] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<{ parent: string | null; text: string } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CollectionSummary | null>(null);
  const [adding, setAdding] = useState(false);
  /** Position of the part being dragged, so a drop knows what to move. */
  const dragging = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [songs, takes] = await Promise.all([collectionsList(), catalogAssets()]);
      setCollections(songs);
      setAssets(takes);
      setProblem(null);
    } catch (error) {
      setProblem(describeError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const byId = useMemo(() => new Map(collections.map(item => [item.id, item])), [collections]);
  const assetsById = useMemo(() => new Map(assets.map(asset => [asset.id, asset])), [assets]);
  const albums = useMemo(() => collections.filter(item => !item.parent), [collections]);
  const song = selected ? byId.get(selected) ?? null : null;

  /** What a part is called, falling back through its own name, its region's, then the take's. */
  const partLabel = useCallback((member: CollectionMember): string => {
    if (member.name) return member.name;
    const asset = assetsById.get(member.asset_id);
    if (!asset) return 'missing take';
    const region = member.region_id ? asset.regions?.find(item => item.id === member.region_id) : null;
    return region ? region.name : takeName(asset);
  }, [assetsById]);

  async function run<T>(work: () => Promise<T>, after?: (result: T) => void) {
    try {
      const result = await work();
      setProblem(null);
      after?.(result);
      await refresh();
    } catch (error) {
      setProblem(describeError(error));
    }
  }

  const applySong = (updated: CollectionSummary) =>
    setCollections(current => current.map(item => (item.id === updated.id ? updated : item)));

  /** Takes not already in this song, so the picker cannot offer a duplicate. */
  const addable = useMemo(() => {
    if (!song) return [];
    const taken = new Set(song.members.map(member => member.asset_id + ':' + (member.region_id ?? '')));
    const rows: Array<{ asset: CatalogAsset; regionId: string | null; label: string }> = [];
    for (const asset of assets) {
      if (!taken.has(asset.id + ':')) rows.push({ asset, regionId: null, label: takeName(asset) });
      for (const region of asset.regions ?? []) {
        if (!taken.has(asset.id + ':' + region.id)) {
          rows.push({ asset, regionId: region.id, label: `${region.name} — ${takeName(asset)}` });
        }
      }
    }
    return rows;
  }, [song, assets]);

  function move(from: number, to: number) {
    if (!song || from === to) return;
    void run(() => collectionMoveMember(song.id, from, to), applySong);
    setSelectedPart(to);
  }

  if (loading) return <div className="songs-page"><p className="songs-empty">Reading your library…</p></div>;

  return <div className="songs-page">
    {problem && <p className="songs-problem" role="alert">{problem}</p>}

    <div className="songs-layout">
      {/* The binder. Albums hold songs; both are renamed in place, as everywhere else. */}
      <section className="songs-binder" aria-label="Songs">
        <header>
          <h2>Binder</h2>
          <button onClick={() => setCreating({ parent: null, text: '' })}>new song</button>
        </header>

        {creating?.parent === null && <NameField
          label="Name the song"
          value={creating.text}
          onChange={text => setCreating({ parent: null, text })}
          onCommit={() => { const name = creating.text.trim(); setCreating(null); if (name) void run(() => collectionCreate(name)); }}
          onCancel={() => setCreating(null)}
        />}

        {!collections.length && !creating && <p className="songs-empty">
          No songs yet. A song is a list of parts in order — takes, or regions you marked inside them.
          Start one and drop fragments into it.
        </p>}

        <ul className="binder-list" role="tree" aria-label="Songs and albums">
          {albums.map(album => <li key={album.id}>
            <BinderRow
              collection={album}
              isSelected={selected === album.id}
              isRenaming={renaming?.id === album.id}
              renameText={renaming?.text ?? ''}
              partLabel={partLabel}
              onSelect={() => { setSelected(album.id); setSelectedPart(null); }}
              onRenameStart={() => setRenaming({ id: album.id, text: album.name })}
              onRenameChange={text => setRenaming({ id: album.id, text })}
              onRenameCommit={() => {
                const name = renaming?.text.trim();
                setRenaming(null);
                if (name && name !== album.name) void run(() => collectionUpdate(album.id, { name }), applySong);
              }}
              onRenameCancel={() => setRenaming(null)}
              onDelete={() => setPendingDelete(album)}
            />
            {/* Songs filed under this album, one level down and no further. */}
            {album.child_ids.length > 0 && <ul className="binder-children">
              {album.child_ids.map(childId => {
                const child = byId.get(childId);
                return child ? <li key={child.id}>
                  <BinderRow
                    collection={child}
                    isSelected={selected === child.id}
                    isRenaming={renaming?.id === child.id}
                    renameText={renaming?.text ?? ''}
                    partLabel={partLabel}
                    onSelect={() => { setSelected(child.id); setSelectedPart(null); }}
                    onRenameStart={() => setRenaming({ id: child.id, text: child.name })}
                    onRenameChange={text => setRenaming({ id: child.id, text })}
                    onRenameCommit={() => {
                      const name = renaming?.text.trim();
                      setRenaming(null);
                      if (name && name !== child.name) void run(() => collectionUpdate(child.id, { name }), applySong);
                    }}
                    onRenameCancel={() => setRenaming(null)}
                    onDelete={() => setPendingDelete(child)}
                  />
                </li> : null;
              })}
            </ul>}
            {selected === album.id && <button className="binder-add-child" onClick={() => setCreating({ parent: album.id, text: '' })}>
              add a song to {album.name}
            </button>}
            {creating?.parent === album.id && <NameField
              label={'Name the song in ' + album.name}
              value={creating.text}
              onChange={text => setCreating({ parent: album.id, text })}
              onCommit={() => { const name = creating.text.trim(); setCreating(null); if (name) void run(() => collectionCreate(name, album.id)); }}
              onCancel={() => setCreating(null)}
            />}
          </li>)}
        </ul>
      </section>

      {/* The corkboard: the parts of this song, in the order they are meant to be heard. */}
      <section className="songs-parts" aria-label="Parts">
        {!song && <p className="songs-empty">Pick a song to see its parts.</p>}
        {song && <>
          <header>
            <h2>{song.name}</h2>
            <button disabled={adding} onClick={() => setAdding(true)}>add a part</button>
          </header>

          {song.missing_members > 0 && <p className="songs-warning">
            {song.missing_members === 1
              ? 'One part points at a take that has left the library.'
              : `${song.missing_members} parts point at takes that have left the library.`}
            {' '}The order is kept as you left it.{' '}
            <button className="link" onClick={() => void run(() => collectionPrune(song.id), applySong)}>remove them</button>
          </p>}

          {adding && <div className="part-picker">
            <label>
              Add a part
              <select
                autoFocus
                defaultValue=""
                onChange={event => {
                  const [assetId, regionId] = event.target.value.split('|');
                  setAdding(false);
                  if (assetId) void run(() => collectionAddMember(song.id, assetId, regionId || null), applySong);
                }}
              >
                <option value="" disabled>Choose a take or a marked region…</option>
                {addable.map(row => <option key={row.asset.id + (row.regionId ?? '')} value={row.asset.id + '|' + (row.regionId ?? '')}>
                  {row.label}
                </option>)}
              </select>
            </label>
            <button onClick={() => setAdding(false)}>cancel</button>
            {!addable.length && <p className="songs-empty">Every take in your library is already in this song.</p>}
          </div>}

          {!song.members.length && !adding && <p className="songs-empty">
            No parts yet. Add a take, or a region you marked inside one — a verse, a chorus, the good bit.
          </p>}

          <ol className="part-list" role="listbox" aria-label={"Parts of " + song.name}>
            {song.members.map((member, index) => {
              const asset = assetsById.get(member.asset_id);
              return <li
                key={member.asset_id + (member.region_id ?? '') + index}
                className={'part-card' + (selectedPart === index ? ' is-selected' : '') + (asset ? '' : ' is-missing')}
                role="option"
                aria-selected={selectedPart === index}
                aria-label={partLabel(member)}
                tabIndex={0}
                onKeyDown={event => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedPart(index); }
                  // ⌥↑/⌥↓ reorder without reaching for the buttons, which is how this pane
                  // is actually used once there are more than a few parts.
                  if (event.altKey && event.key === 'ArrowUp' && index > 0) { event.preventDefault(); move(index, index - 1); }
                  if (event.altKey && event.key === 'ArrowDown' && index < song.members.length - 1) { event.preventDefault(); move(index, index + 1); }
                }}
                draggable
                onDragStart={() => { dragging.current = index; }}
                onDragOver={event => event.preventDefault()}
                onDrop={event => { event.preventDefault(); if (dragging.current !== null) move(dragging.current, index); dragging.current = null; }}
                onClick={() => setSelectedPart(index)}
              >
                <span className="part-index" aria-hidden="true">{index + 1}</span>
                <div className="part-body">
                  <strong>{partLabel(member)}</strong>
                  <small>
                    {!asset ? 'this take is no longer in the library'
                      : member.region_id ? 'region of ' + takeName(asset)
                      : formatFileSize(asset.bytes)}
                  </small>
                </div>
                {/* Keyboard equivalents of the drag, because a drag is not reachable without
                    a pointer and reordering is the primary act on this pane. */}
                <span className="part-actions">
                  <button aria-label={'Move ' + partLabel(member) + ' earlier'} disabled={index === 0}
                    onClick={event => { event.stopPropagation(); move(index, index - 1); }}>↑</button>
                  <button aria-label={'Move ' + partLabel(member) + ' later'} disabled={index === song.members.length - 1}
                    onClick={event => { event.stopPropagation(); move(index, index + 1); }}>↓</button>
                  <button aria-label={'Remove ' + partLabel(member) + ' from this song'}
                    onClick={event => { event.stopPropagation(); setSelectedPart(null); void run(() => collectionRemoveMember(song.id, index), applySong); }}>×</button>
                </span>
              </li>;
            })}
          </ol>
        </>}
      </section>

      {/* The index card. In Scrivener this is the synopsis: what the thing is, in your words. */}
      <section className="songs-card" aria-label="Details">
        {song && selectedPart === null && <SongCard
          song={song}
          onNote={note => void run(() => collectionUpdate(song.id, { note }), applySong)}
          onTempo={tempo => void run(() => collectionUpdate(song.id, { tempo }), applySong)}
          onFile={parent => void run(() => collectionUpdate(song.id, { parent }), applySong)}
          albums={albums.filter(album => album.id !== song.id && !album.parent)}
        />}
        {song && selectedPart !== null && song.members[selectedPart] && <PartCard
          label={partLabel(song.members[selectedPart])}
          asset={assetsById.get(song.members[selectedPart].asset_id) ?? null}
          onName={name => void run(() => collectionNameMember(song.id, selectedPart, name), applySong)}
        />}
        {!song && <p className="songs-empty">Nothing selected.</p>}
      </section>
    </div>

    {pendingDelete && <ConfirmationModal
      isOpen
      // Worth being explicit: people expect deleting a container to delete its contents,
      // and here it emphatically does not.
      message={`Forget “${pendingDelete.name}”? Your takes and their audio stay exactly where they are — only this grouping goes.${
        pendingDelete.child_ids.length ? ` The ${pendingDelete.child_ids.length} songs filed under it move back to the top level.` : ''
      }`}
      confirmLabel="forget it"
      onConfirm={() => {
        const id = pendingDelete.id;
        setPendingDelete(null);
        if (selected === id) { setSelected(null); setSelectedPart(null); }
        void run(() => collectionDelete(id));
      }}
      onCancel={() => setPendingDelete(null)}
    />}
  </div>;
}

/** A row in the binder: click to select, click the name to rename, × to forget. */
function BinderRow({ collection, isSelected, isRenaming, renameText, partLabel, onSelect, onRenameStart, onRenameChange, onRenameCommit, onRenameCancel, onDelete }: {
  collection: CollectionSummary;
  isSelected: boolean;
  isRenaming: boolean;
  renameText: string;
  partLabel: (member: CollectionMember) => string;
  onSelect: () => void;
  onRenameStart: () => void;
  onRenameChange: (text: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDelete: () => void;
}) {
  const parts = collection.members.length;
  // A row is a treeitem rather than a div with a click handler: the binder is a tree, and
  // selecting a song has to be reachable from the keyboard like everything else here.
  return <div
    className={'binder-row' + (isSelected ? ' is-selected' : '')}
    role="treeitem"
    aria-selected={isSelected}
    aria-label={collection.name}
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(); }
    }}
  >
    {isRenaming
      ? <input
          className="binder-rename"
          aria-label={'Rename ' + collection.name}
          autoFocus
          value={renameText}
          onClick={event => event.stopPropagation()}
          onChange={event => onRenameChange(event.target.value)}
          onBlur={onRenameCommit}
          onKeyDown={event => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); onRenameCommit(); }
            if (event.key === 'Escape') { event.preventDefault(); onRenameCancel(); }
          }}
        />
      : <button className="binder-name" aria-label={'Rename ' + collection.name}
          onClick={event => { event.stopPropagation(); onSelect(); onRenameStart(); }}>
          <strong>{collection.name}</strong>
        </button>}
    <small>
      {collection.child_ids.length > 0
        ? `${collection.child_ids.length} ${collection.child_ids.length === 1 ? 'song' : 'songs'}`
        : parts === 0 ? 'no parts yet'
        : parts === 1 ? `1 part — ${partLabel(collection.members[0])}`
        : `${parts} parts`}
      {collection.tempo ? ` · ${Math.round(collection.tempo)} bpm` : ''}
    </small>
    <button className="binder-delete" aria-label={'Forget ' + collection.name}
      onClick={event => { event.stopPropagation(); onDelete(); }}>×</button>
  </div>;
}

/** The song's index card: a note, a tempo, and which album it is filed under. */
function SongCard({ song, albums, onNote, onTempo, onFile }: {
  song: CollectionSummary;
  albums: CollectionSummary[];
  onNote: (note: string) => void;
  onTempo: (tempo: number) => void;
  onFile: (parent: string) => void;
}) {
  const [note, setNote] = useState(song.note ?? '');
  useEffect(() => { setNote(song.note ?? ''); }, [song.id, song.note]);
  return <>
    <h2>{song.name}</h2>
    <label className="card-field">
      Notes
      {/* Where "second half is the good bit" lives — the thing a filename can never hold
          and the thing you want six weeks later. Saved on blur rather than per keystroke. */}
      <textarea
        aria-label={'Notes on ' + song.name}
        rows={6}
        placeholder="What this is. A lyric, a tuning, which bit is the good bit."
        value={note}
        onChange={event => setNote(event.target.value)}
        onBlur={() => { if (note !== (song.note ?? '')) onNote(note); }}
      />
    </label>
    <label className="card-field">
      Tempo
      <input
        type="number" min="1" max="400" step="1"
        aria-label={'Tempo of ' + song.name}
        defaultValue={song.tempo ? Math.round(song.tempo) : ''}
        placeholder="bpm"
        onBlur={event => { const value = Number(event.target.value); if (value > 0) onTempo(value); }}
      />
    </label>
    {!song.parent && albums.length > 0 && <label className="card-field">
      File under
      <select value="" onChange={event => { if (event.target.value) onFile(event.target.value); }}>
        <option value="">— top level —</option>
        {albums.map(album => <option key={album.id} value={album.id}>{album.name}</option>)}
      </select>
    </label>}
    {song.parent && <button className="link" onClick={() => onFile('')}>move back to the top level</button>}
  </>;
}

/** A part's card: what it is called here, and where its audio came from. */
function PartCard({ label, asset, onName }: { label: string; asset: CatalogAsset | null; onName: (name: string) => void }) {
  const [text, setText] = useState(label);
  useEffect(() => { setText(label); }, [label]);
  const origin = asset?.occurrences?.[0];
  return <>
    <h2>{label}</h2>
    <label className="card-field">
      Called here
      {/* A part's name is local to the song: the same take can be "verse" in one and
          "outro idea" in another, and renaming it here never touches the take. */}
      <input
        aria-label="Name this part"
        value={text}
        onChange={event => setText(event.target.value)}
        onBlur={() => { if (text.trim() !== label) onName(text.trim()); }}
        onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      />
    </label>
    {asset
      ? <dl className="card-facts">
          <dt>Take</dt><dd>{takeName(asset)}</dd>
          <dt>Size</dt><dd>{formatFileSize(asset.bytes)}</dd>
          {origin && <><dt>From</dt><dd>{origin.device_model ?? origin.source}</dd></>}
          {origin?.captured_at && <><dt>Recorded</dt><dd>{origin.captured_at.slice(0, 16).replace('T', ' ')}</dd></>}
        </dl>
      : <p className="songs-warning">This take is no longer in the library. The part is kept so the arrangement is not silently shortened.</p>}
  </>;
}

/** The one-field form for naming a new song, used in two places. */
function NameField({ label, value, onChange, onCommit, onCancel }: {
  label: string;
  value: string;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return <input
    className="binder-rename"
    aria-label={label}
    placeholder={label}
    autoFocus
    value={value}
    onChange={event => onChange(event.target.value)}
    onBlur={onCommit}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); onCommit(); }
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    }}
  />;
}
