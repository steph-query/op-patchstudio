//! Songs and albums: the binder.
//!
//! A songwriting workflow produces fragments — a pass off the OP-1 field's four tape tracks, a
//! marked region inside one, a voice note with the words in it — and the work is deciding which
//! fragments are the same song and what order they go in. The library already held every fragment
//! and had no way to say any of that.
//!
//! **Why not folders.** Two reasons, both of which the existing model already settles:
//!
//! 1. A file lives in one folder, but a fragment belongs to several songs — a found-sound hit gets
//!    reused across three ideas. Assets are content-addressed, so the library already models one
//!    thing in many places; folders would fight that.
//! 2. The useful unit is smaller than a file. A nine-minute take holds a verse at 1:12 and a chorus
//!    at 4:40, which `Region` already expresses. A folder cannot hold half a file.
//!
//! So a song is an **ordered list of members**, where a member is a whole take or one region of
//! one. Order is data rather than a naming convention, which is the thing folders cannot do and the
//! reason people end up typing `01 `, `02 ` into filenames.
//!
//! **Nothing here moves a byte.** A collection is metadata in the library index, exactly like a
//! take's name. Audio is never copied, moved or rewritten by anything in this module, and no device
//! is touched — the TP-7 refuses to create folders at all, and a field's layout is its own.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use tauri::State;

use crate::catalog::{commit, current_root, load, now_unix, Catalog};
use crate::DeviceState;

/// Long enough for "the one where the tape machine was dying", short enough for a sidebar.
const MAX_NAME_CHARS: usize = 120;
/// Room for what a title cannot hold: "second half is the good bit", a lyric, a tuning.
const MAX_NOTE_CHARS: usize = 2000;
/// Two levels — album, then song. Deeper is a filing system to maintain rather than a tool.
const MAX_DEPTH: usize = 2;

/// One fragment in a song, in the order it is meant to be heard.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Member {
    /// The take this part comes from.
    pub asset_id: String,
    /// A region of that take, or `None` to mean the whole thing.
    #[serde(default)]
    pub region_id: Option<String>,
    /// What this part is called here: "verse", "chorus (take 4)". The take keeps its own name.
    #[serde(default)]
    pub name: Option<String>,
    pub added_unix: u64,
}

impl Member {
    /// Whether two members point at the same audio. Identity is the pair, not the asset:
    /// the same take can legitimately appear twice as two different regions.
    fn same_audio_as(&self, other: &Member) -> bool {
        self.asset_id == other.asset_id && self.region_id == other.region_id
    }
}

/// A song, or an album holding songs.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Collection {
    pub id: String,
    pub name: String,
    /// The album this song belongs to, if any. One level of nesting, enforced on write.
    #[serde(default)]
    pub parent: Option<String>,
    /// The index card: what this is, in the writer's own words.
    #[serde(default)]
    pub note: Option<String>,
    /// Beats per minute, when known. Set directly or derived from a region's bar count.
    #[serde(default)]
    pub tempo: Option<f64>,
    /// The parts, in playing order. Position in this vector *is* the arrangement.
    #[serde(default)]
    pub members: Vec<Member>,
    pub created_unix: u64,
}

/// What `collections_list` returns: the collection plus what the sidebar needs to draw it.
#[derive(Serialize, Clone, Debug)]
pub struct CollectionSummary {
    #[serde(flatten)]
    pub collection: Collection,
    /// Songs filed under this album. Empty for a song.
    pub child_ids: Vec<String>,
    /// Members whose take is no longer in the library — see `prune_missing`.
    pub missing_members: usize,
}

fn valid_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Give it a name — even a bad one is easier to find than Untitled.".into());
    }
    if trimmed.chars().count() > MAX_NAME_CHARS {
        return Err(format!(
            "That name is {} characters; {MAX_NAME_CHARS} is the most a name can hold.",
            trimmed.chars().count()
        ));
    }
    // A song name becomes a folder when the song is compiled, so the characters that would
    // break that are refused here rather than mangled silently at export time.
    if let Some(bad) = trimmed.chars().find(|c| c.is_control() || matches!(c, '/' | '\\' | ':')) {
        return Err(match bad {
            '/' | '\\' | ':' => format!("A name cannot contain {bad:?} — it would break the folder name when you export."),
            _ => "A name cannot contain control characters.".to_string(),
        });
    }
    Ok(trimmed.to_string())
}

fn valid_note(note: &str) -> Result<Option<String>, String> {
    let trimmed = note.trim();
    if trimmed.chars().count() > MAX_NOTE_CHARS {
        return Err(format!(
            "That note is {} characters; {MAX_NOTE_CHARS} is the most one can hold.",
            trimmed.chars().count()
        ));
    }
    Ok(if trimmed.is_empty() { None } else { Some(trimmed.to_string()) })
}

/// How deep a collection sits, following parents. `None` when the chain is broken or cyclic.
fn depth_of(catalog: &Catalog, id: &str) -> Option<usize> {
    let mut depth = 1;
    let mut seen = HashSet::new();
    let mut current = id.to_string();
    loop {
        if !seen.insert(current.clone()) {
            // A cycle. Only reachable if the index was edited by hand, but it would hang the
            // walk below rather than fail, so it is reported as a broken chain.
            return None;
        }
        let collection = catalog.collections.iter().find(|item| item.id == current)?;
        match collection.parent.clone() {
            None => return Some(depth),
            Some(parent) => {
                depth += 1;
                if depth > MAX_DEPTH + 1 {
                    return None;
                }
                current = parent;
            }
        }
    }
}

/// Check a proposed parent: it must exist, be a top-level album, and not be the collection itself.
fn check_parent(catalog: &Catalog, id: &str, parent: Option<&str>) -> Result<(), String> {
    let Some(parent_id) = parent else { return Ok(()) };
    if parent_id == id {
        return Err("A song cannot be filed inside itself.".into());
    }
    let parent_collection = catalog
        .collections
        .iter()
        .find(|item| item.id == parent_id)
        .ok_or("That album is not in this library.")?;
    if parent_collection.parent.is_some() {
        return Err("Albums hold songs, and that is as deep as it goes. File this under the album instead.".into());
    }
    // Moving an album under another album would orphan its own children past the depth limit.
    let has_children = catalog.collections.iter().any(|item| item.parent.as_deref() == Some(id));
    if has_children {
        return Err("This album holds songs, so it cannot be filed inside another album.".into());
    }
    Ok(())
}

/// Count members whose take has left the library.
///
/// A take can be removed while a song still lists it. Rather than deleting the member — which
/// would quietly shrink an arrangement the user built — the count is reported so the interface
/// can say so, and `collection_prune` removes them only when asked.
fn missing_count(catalog: &Catalog, collection: &Collection) -> usize {
    collection
        .members
        .iter()
        .filter(|member| !catalog.assets.iter().any(|asset| asset.id == member.asset_id))
        .count()
}

fn find_mut<'a>(catalog: &'a mut Catalog, id: &str) -> Result<&'a mut Collection, String> {
    catalog
        .collections
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| "That song is not in this library.".to_string())
}

fn summarise(catalog: &Catalog, collection: &Collection) -> CollectionSummary {
    CollectionSummary {
        child_ids: catalog
            .collections
            .iter()
            .filter(|item| item.parent.as_deref() == Some(collection.id.as_str()))
            .map(|item| item.id.clone())
            .collect(),
        missing_members: missing_count(catalog, collection),
        collection: collection.clone(),
    }
}

fn load_and_summarise(root: &Path) -> Result<Vec<CollectionSummary>, String> {
    let catalog = load(root)?;
    Ok(catalog.collections.iter().map(|item| summarise(&catalog, item)).collect())
}

/// Every song and album, with the counts the binder needs to draw itself.
#[tauri::command]
pub async fn collections_list(state: State<'_, DeviceState>) -> Result<Vec<CollectionSummary>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || load_and_summarise(&root))
        .await
        .map_err(|e| e.to_string())?
}

/// Start a song, or an album to hold songs.
#[tauri::command]
pub async fn collection_create(
    state: State<'_, DeviceState>,
    name: String,
    parent: Option<String>,
) -> Result<Collection, String> {
    let name = valid_name(&name)?;
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let id = format!("{}-{}", now_unix(), catalog.collections.len() + 1);
        check_parent(&catalog, &id, parent.as_deref())?;
        let created = Collection {
            id,
            name,
            parent,
            note: None,
            tempo: None,
            members: Vec::new(),
            created_unix: now_unix(),
        };
        catalog.collections.push(created.clone());
        commit(&root, &catalog)?;
        Ok(created)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Rename, re-file, re-note or re-tempo a collection. Absent fields are left alone.
#[derive(Deserialize, Debug, Default)]
pub struct CollectionEdit {
    pub name: Option<String>,
    pub note: Option<String>,
    pub tempo: Option<f64>,
    /// Where to file it. `None` leaves it where it is; `Some("")` moves it back to the top
    /// level. A plain `Option<Option<String>>` would express that more directly but needs a
    /// `double_option` serde helper and a new dependency to tell "absent" from "null"; the
    /// empty string carries the same two cases and a name can never be empty anyway.
    #[serde(default)]
    pub parent: Option<String>,
}

#[tauri::command]
pub async fn collection_update(
    state: State<'_, DeviceState>,
    id: String,
    edit: CollectionEdit,
) -> Result<CollectionSummary, String> {
    let name = edit.name.as_deref().map(valid_name).transpose()?;
    let note = edit.note.as_deref().map(valid_note).transpose()?;
    if let Some(tempo) = edit.tempo {
        if !tempo.is_finite() || tempo <= 0.0 || tempo > 400.0 {
            return Err("A tempo is between 1 and 400 bpm.".into());
        }
    }
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        // "" means "move to the top level"; absent means "leave the filing alone".
        let reparent = edit.parent.as_deref().map(|value| if value.is_empty() { None } else { Some(value.to_string()) });
        if let Some(parent) = reparent.clone() {
            check_parent(&catalog, &id, parent.as_deref())?;
        }
        {
            let collection = find_mut(&mut catalog, &id)?;
            if let Some(name) = name {
                collection.name = name;
            }
            if let Some(note) = note {
                collection.note = note;
            }
            if let Some(tempo) = edit.tempo {
                collection.tempo = Some(tempo);
            }
            if let Some(parent) = reparent {
                collection.parent = parent;
            }
        }
        if depth_of(&catalog, &id).is_none() {
            return Err("That move would file a song inside itself.".into());
        }
        let updated = find_mut(&mut catalog, &id)?.clone();
        commit(&root, &catalog)?;
        Ok(summarise(&catalog, &updated))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forget a song. Its takes, regions and audio are untouched — only the grouping goes.
///
/// An album's songs are kept and moved back to the top level rather than deleted with it:
/// deleting a container should not silently destroy a season of work filed inside it.
#[tauri::command]
pub async fn collection_delete(state: State<'_, DeviceState>, id: String) -> Result<Vec<CollectionSummary>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        if !catalog.collections.iter().any(|item| item.id == id) {
            return Err("That song is already gone.".into());
        }
        for child in catalog.collections.iter_mut() {
            if child.parent.as_deref() == Some(id.as_str()) {
                child.parent = None;
            }
        }
        catalog.collections.retain(|item| item.id != id);
        commit(&root, &catalog)?;
        Ok(catalog.collections.iter().map(|item| summarise(&catalog, item)).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Put a take, or one region of it, into a song at the end.
#[tauri::command]
pub async fn collection_add_member(
    state: State<'_, DeviceState>,
    id: String,
    asset_id: String,
    region_id: Option<String>,
    name: Option<String>,
) -> Result<CollectionSummary, String> {
    let name = name.as_deref().map(valid_name).transpose()?;
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        // The take and, when given, the region must exist — a part pointing at nothing would
        // appear in the arrangement and fail only at export.
        let asset = catalog
            .assets
            .iter()
            .find(|asset| asset.id == asset_id)
            .ok_or("That take is not in this library.")?;
        if let Some(region) = region_id.as_deref() {
            if !asset.regions.iter().any(|existing| existing.id == region) {
                return Err("That part is not marked on this take any more.".into());
            }
        }
        let candidate = Member { asset_id, region_id, name, added_unix: now_unix() };
        let collection = find_mut(&mut catalog, &id)?;
        // The same audio twice in one song is almost always a double-click rather than an
        // intention, and the arrangement is ordered, so a silent duplicate is hard to spot.
        if collection.members.iter().any(|existing| existing.same_audio_as(&candidate)) {
            return Err("That part is already in this song.".into());
        }
        collection.members.push(candidate);
        let updated = collection.clone();
        commit(&root, &catalog)?;
        Ok(summarise(&catalog, &updated))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Take a part out of a song. The take and its audio stay in the library.
#[tauri::command]
pub async fn collection_remove_member(
    state: State<'_, DeviceState>,
    id: String,
    index: usize,
) -> Result<CollectionSummary, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let collection = find_mut(&mut catalog, &id)?;
        if index >= collection.members.len() {
            return Err("That part is already gone.".into());
        }
        collection.members.remove(index);
        let updated = collection.clone();
        commit(&root, &catalog)?;
        Ok(summarise(&catalog, &updated))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Move a part to a new position. This is the arrangement: order is the whole point.
#[tauri::command]
pub async fn collection_move_member(
    state: State<'_, DeviceState>,
    id: String,
    from: usize,
    to: usize,
) -> Result<CollectionSummary, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let collection = find_mut(&mut catalog, &id)?;
        let length = collection.members.len();
        if from >= length {
            return Err("That part is not in this song any more.".into());
        }
        // Clamped rather than refused: dragging past the end means "put it last", which is
        // what the gesture looks like, and refusing it would feel broken.
        let target = to.min(length.saturating_sub(1));
        let member = collection.members.remove(from);
        collection.members.insert(target, member);
        let updated = collection.clone();
        commit(&root, &catalog)?;
        Ok(summarise(&catalog, &updated))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Rename one part within a song, without touching what the take is called.
///
/// A take is "2026-09-27 yard session" and its parts are "verse", "chorus", "the good bit".
/// The same take can be two parts of one song under two names.
#[tauri::command]
pub async fn collection_name_member(
    state: State<'_, DeviceState>,
    id: String,
    index: usize,
    name: String,
) -> Result<CollectionSummary, String> {
    let trimmed = name.trim().to_string();
    let resolved = if trimmed.is_empty() { None } else { Some(valid_name(&trimmed)?) };
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let collection = find_mut(&mut catalog, &id)?;
        let member = collection.members.get_mut(index).ok_or("That part is not in this song any more.")?;
        member.name = resolved;
        let updated = collection.clone();
        commit(&root, &catalog)?;
        Ok(summarise(&catalog, &updated))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Drop the parts whose takes have left the library, once the user has seen that they are gone.
#[tauri::command]
pub async fn collection_prune(state: State<'_, DeviceState>, id: String) -> Result<CollectionSummary, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let present: HashSet<String> = catalog.assets.iter().map(|asset| asset.id.clone()).collect();
        let collection = find_mut(&mut catalog, &id)?;
        collection.members.retain(|member| present.contains(&member.asset_id));
        let updated = collection.clone();
        commit(&root, &catalog)?;
        Ok(summarise(&catalog, &updated))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Every song that uses a given take — the backlink the binder needs.
///
/// Reuse across songs is the normal case rather than the exception, which is the reason this
/// is a list rather than a single owner, and the reason folders were the wrong model.
#[tauri::command]
pub async fn collections_using_asset(
    state: State<'_, DeviceState>,
    asset_id: String,
) -> Result<Vec<CollectionSummary>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = load(&root)?;
        Ok(catalog
            .collections
            .iter()
            .filter(|item| item.members.iter().any(|member| member.asset_id == asset_id))
            .map(|item| summarise(&catalog, item))
            .collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Tempo from a bar count, which is the one number a writer already knows.
///
/// Deriving bpm from audio is a real signal-processing problem with real failure modes.
/// Deriving it from "that loop is 8 bars" is arithmetic, and it is exact. Assumes 4/4,
/// which is what the field's tape and the overwhelming majority of this material are in.
pub fn tempo_from_bars(duration_seconds: f64, bars: f64) -> Result<f64, String> {
    if !duration_seconds.is_finite() || duration_seconds <= 0.0 {
        return Err("That part has no length to measure.".into());
    }
    if !bars.is_finite() || bars <= 0.0 {
        return Err("Say how many bars it is — 4, 8, 16.".into());
    }
    let bpm = bars * 4.0 * 60.0 / duration_seconds;
    if !(1.0..=400.0).contains(&bpm) {
        return Err(format!("That works out to {bpm:.0} bpm, which is not a tempo. Check the bar count."));
    }
    Ok(bpm)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn collection(id: &str, parent: Option<&str>) -> Collection {
        Collection {
            id: id.into(),
            name: id.into(),
            parent: parent.map(String::from),
            note: None,
            tempo: None,
            members: Vec::new(),
            created_unix: 0,
        }
    }

    fn catalog_with(collections: Vec<Collection>) -> Catalog {
        let mut catalog = Catalog::empty_for_test();
        catalog.collections = collections;
        catalog
    }

    #[test]
    fn a_name_that_would_break_a_folder_is_refused_before_it_is_stored() {
        // A song name becomes a folder at export, so this is caught at the point the user
        // types it rather than at the point it would mangle a path.
        assert!(valid_name("yard/door").is_err());
        assert!(valid_name("take: two").is_err());
        assert!(valid_name("  ").is_err());
        assert_eq!(valid_name("  yard door song  ").unwrap(), "yard door song");
    }

    #[test]
    fn albums_hold_songs_and_that_is_as_deep_as_it_goes() {
        let catalog = catalog_with(vec![collection("album", None), collection("song", Some("album"))]);
        // A song under an album is fine.
        assert!(check_parent(&catalog, "song", Some("album")).is_ok());
        // A song under a song is not: that would be three levels.
        assert!(check_parent(&catalog, "other", Some("song")).is_err());
        // Nor is a collection inside itself.
        assert!(check_parent(&catalog, "album", Some("album")).is_err());
        // Nor an album that already holds songs being filed under another album.
        assert!(check_parent(&catalog, "album", Some("second")).is_err());
    }

    #[test]
    fn depth_reports_a_broken_chain_rather_than_walking_it_forever() {
        // Only reachable by editing the index by hand, but the walk must terminate.
        let cyclic = catalog_with(vec![collection("a", Some("b")), collection("b", Some("a"))]);
        assert_eq!(depth_of(&cyclic, "a"), None);

        let sound = catalog_with(vec![collection("album", None), collection("song", Some("album"))]);
        assert_eq!(depth_of(&sound, "album"), Some(1));
        assert_eq!(depth_of(&sound, "song"), Some(2));
    }

    #[test]
    fn the_same_take_can_be_two_parts_when_they_are_different_regions() {
        let whole = Member { asset_id: "a".into(), region_id: None, name: None, added_unix: 0 };
        let verse = Member { asset_id: "a".into(), region_id: Some("r1".into()), name: None, added_unix: 0 };
        let chorus = Member { asset_id: "a".into(), region_id: Some("r2".into()), name: None, added_unix: 0 };
        // Two regions of one take are two different parts of a song — the common case.
        assert!(!verse.same_audio_as(&chorus));
        assert!(!verse.same_audio_as(&whole));
        // The identical pair is a double-click.
        assert!(verse.same_audio_as(&verse.clone()));
    }

    #[test]
    fn a_part_whose_take_is_gone_is_counted_rather_than_dropped() {
        // Removing it silently would shrink an arrangement the user built, with no notice.
        let mut song = collection("song", None);
        song.members = vec![
            Member { asset_id: "present".into(), region_id: None, name: None, added_unix: 0 },
            Member { asset_id: "deleted".into(), region_id: None, name: None, added_unix: 0 },
        ];
        let mut catalog = catalog_with(vec![song.clone()]);
        catalog.assets = vec![crate::catalog::Asset::empty_for_test("present")];
        assert_eq!(missing_count(&catalog, &song), 1);
    }

    #[test]
    fn tempo_comes_out_of_a_bar_count_exactly() {
        // 8 bars of 4/4 in 16 seconds is 120 bpm, and the arithmetic should say so exactly.
        assert_eq!(tempo_from_bars(16.0, 8.0).unwrap(), 120.0);
        // 4 bars in 8 seconds is the same tempo.
        assert_eq!(tempo_from_bars(8.0, 4.0).unwrap(), 120.0);
        // A plausible-looking mistake is caught rather than stored: 1 bar across nine minutes.
        assert!(tempo_from_bars(540.0, 1.0).is_err());
        assert!(tempo_from_bars(0.0, 8.0).is_err());
        assert!(tempo_from_bars(16.0, 0.0).is_err());
    }
}
