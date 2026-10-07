//! A durable local catalog of imported recordings.
//!
//! Playbook phase 02: once a take is imported it must survive unplugging the
//! recorder and quitting the app, so the library lives on disk rather than in
//! device handles. Identity is the file's SHA-256, never its name or its MTP
//! handle — reimporting the same audio records another occurrence instead of a
//! second copy, and a renamed file is still recognised.
//!
//! Every write is atomic: the catalog is written to a temporary file and
//! renamed over the old one, so an interrupted import cannot leave a half-parsed
//! index. Originals are only ever added; nothing here overwrites or deletes a
//! file the user already has.

use crate::{backup, DeviceState};
use mtp_rs::ptp::ObjectHandle;
use serde::{Deserialize, Serialize};
use sha2::Digest;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;

const CATALOG_FILE: &str = "fieldwork-catalog.json";
const ORIGINALS_DIR: &str = "originals";
const STAGING_DIR: &str = "staging";
const FORMAT: &str = "fieldwork-capture-catalog";
const VERSION: u32 = 1;
/// A catalog larger than this is not something this app wrote.
const MAX_CATALOG_BYTES: u64 = 64 * 1024 * 1024;
/// Long enough for a sentence about a take, short enough to stay readable in a list.
const MAX_LABEL_CHARS: usize = 120;

/// One place a piece of audio came from. The same asset can have several.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Occurrence {
    /// "device" or "local".
    pub source: String,
    pub device_model: Option<String>,
    pub device_serial: Option<String>,
    /// Path on the device, or on this Mac for a local import.
    pub source_path: String,
    /// Capture time as the device reported it, when it did.
    pub captured_at: Option<String>,
    pub imported_unix: u64,
}

/// A named span of a take, kept as frame positions so the original is never altered.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Region {
    pub id: String,
    pub name: String,
    pub start_frame: u64,
    /// Exclusive, so `end - start` is the length in frames.
    pub end_frame: u64,
    pub created_unix: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Asset {
    /// SHA-256 of the file's bytes: this is the identity.
    pub id: String,
    /// Path inside the library root, always under `originals/`.
    pub stored_path: String,
    /// Name the file had when it was first imported. Never changed: it is provenance,
    /// and it is what the dedup index and every recorded occurrence refer to.
    pub original_name: String,
    /// What the owner calls this take, when they have said.
    ///
    /// A label rather than a rename, deliberately. The library is content-addressed and
    /// the bytes live at `stored_path`; renaming the file on disk would mean a
    /// filesystem operation that can fail halfway, a `stored_path` that no longer
    /// matches what was recorded, and the loss of the name the recorder gave it. A
    /// label costs none of that and is reversible by clearing it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub bytes: u64,
    pub first_imported_unix: u64,
    pub occurrences: Vec<Occurrence>,
    /// Marked spans of this take. Absent in libraries written before regions existed.
    #[serde(default)]
    pub regions: Vec<Region>,
}

impl Asset {
    /// A minimal asset for tests that only need its identity.
    #[cfg(test)]
    pub fn empty_for_test(id: &str) -> Self {
        Self {
            id: id.into(),
            stored_path: format!("originals/{id}.wav"),
            original_name: format!("{id}.wav"),
            label: None,
            bytes: 0,
            first_imported_unix: 0,
            occurrences: Vec::new(),
            regions: Vec::new(),
        }
    }
}

/// One file that was written to a device, with the bytes that were verified.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TransferFile {
    pub path: String,
    pub bytes: u64,
}

/// What was sent where, so a sound on an instrument can be traced back.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Transfer {
    pub id: String,
    pub sent_unix: u64,
    pub device_model: String,
    pub device_serial: Option<String>,
    /// Folder on the device the files went into.
    pub destination: String,
    pub name: String,
    pub files: Vec<TransferFile>,
    /// "verified" or "failed".
    pub outcome: String,
    pub error: Option<String>,
    /// Library take this came from, when it did.
    pub source_asset_id: Option<String>,
    pub source_region: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Catalog {
    pub format: String,
    pub version: u32,
    pub created_unix: u64,
    pub assets: Vec<Asset>,
    /// Device writes this app made, newest last. Absent in older libraries.
    #[serde(default)]
    pub transfers: Vec<Transfer>,
    /// Songs and the albums holding them. Absent in libraries written before the binder.
    #[serde(default)]
    pub collections: Vec<crate::collections::Collection>,
}

impl Catalog {
    fn new(now: u64) -> Self {
        Self { format: FORMAT.into(), version: VERSION, created_unix: now, assets: Vec::new(), transfers: Vec::new(), collections: Vec::new() }
    }

    /// An empty catalog for tests that only exercise in-memory shape.
    #[cfg(test)]
    pub fn empty_for_test() -> Self {
        Self::new(0)
    }
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn catalog_file(root: &Path) -> PathBuf {
    root.join(CATALOG_FILE)
}

/// Read the catalog, creating an empty one the first time. A newer or foreign
/// file is refused rather than replaced, so a future version's library is never
/// clobbered by this one.
pub fn load(root: &Path) -> Result<Catalog, String> {
    let path = catalog_file(root);
    match fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Catalog::new(now_unix())),
        Err(error) => Err(error.to_string()),
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("The library index is not a regular file.".into());
            }
            if metadata.len() > MAX_CATALOG_BYTES {
                return Err("The library index is larger than this app can read.".into());
            }
            let catalog: Catalog = serde_json::from_slice(&fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|_| "The library index could not be read. It may belong to another app.".to_string())?;
            if catalog.format != FORMAT {
                return Err("That folder holds a different app's library index.".into());
            }
            if catalog.version > VERSION {
                return Err(format!(
                    "This library was written by a newer version of Fieldwork (index version {}). Update the app rather than risk its contents.",
                    catalog.version
                ));
            }
            Ok(catalog)
        }
    }
}

/// Write the catalog atomically: a temporary file, flushed, then renamed into place.
pub fn commit(root: &Path, catalog: &Catalog) -> Result<(), String> {
    let target = catalog_file(root);
    let temporary = root.join(format!("{CATALOG_FILE}.writing"));
    {
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).open(&temporary).map_err(|e| e.to_string())?;
        serde_json::to_writer_pretty(&mut file, catalog).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, &target).map_err(|e| e.to_string())
}

/// Prepare `originals/` and `staging/` inside a chosen root and read its index.
pub fn open_root(root: &Path) -> Result<Catalog, String> {
    fs::create_dir_all(root.join(ORIGINALS_DIR)).map_err(|e| format!("{}: {e}", root.display()))?;
    fs::create_dir_all(root.join(STAGING_DIR)).map_err(|e| format!("{}: {e}", root.display()))?;
    let catalog = load(root)?;
    commit(root, &catalog)?;
    // Opening a library is the one moment no import can be in flight.
    sweep_staging(root);
    Ok(catalog)
}

/// The library location used when the user has not chosen one, so first run needs no dialog.
pub fn default_root() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "Could not find your home folder.".to_string())?;
    Ok(PathBuf::from(home).join("Music").join("Fieldwork Library"))
}

/// Where a download is written before it is verified and published.
///
/// Unique per object, not per second: an OP-1 field calls every tape track
/// `track_1.aif`, and the download refuses to write over an existing path.
fn staged_name(now: u64, handle: u32, name: &str) -> String {
    format!("{now}-{handle}-{name}")
}

/// Remove half-downloaded files left in `staging/` by an earlier failure or crash.
///
/// Only regular files directly inside our own staging folder, and only when no
/// import can be running — nothing here touches `originals/` or anything on a
/// device. A library that accumulates partial downloads forever is a leak the user
/// never sees until they look.
fn sweep_staging(root: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(root.join(STAGING_DIR)) else { return 0 };
    let mut removed = 0;
    for entry in entries.flatten() {
        let Ok(metadata) = entry.metadata() else { continue };
        if metadata.is_file() && fs::remove_file(entry.path()).is_ok() {
            removed += 1;
        }
    }
    removed
}

/// A single file name, never a path. Callers pass basenames; anything with a
/// separator is refused rather than silently flattened into a different file.
fn storable_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    let invalid = trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed.chars().any(char::is_control);
    if invalid {
        return Err(format!("{name} is not a name this library can store."));
    }
    Ok(trimmed.to_string())
}

/// A name that does not collide with anything already stored, never an overwrite.
fn available_name(directory: &Path, desired: &str) -> Result<String, String> {
    let (stem, extension) = match desired.rsplit_once('.') {
        Some((stem, extension)) if !stem.is_empty() => (stem.to_string(), format!(".{extension}")),
        _ => (desired.to_string(), String::new()),
    };
    for attempt in 1..10_000 {
        let candidate = if attempt == 1 { format!("{stem}{extension}") } else { format!("{stem} {attempt}{extension}") };
        if !directory.join(&candidate).exists() {
            return Ok(candidate);
        }
    }
    Err("Too many files with that name are already in the library.".into())
}

#[derive(Debug)]
pub struct Published {
    pub asset: Asset,
    /// False when this audio was already in the library and only gained an occurrence.
    pub is_new: bool,
}

/// Move a verified staged file into the library, or record another occurrence of
/// audio already held. The staged file is consumed either way.
pub fn publish(
    root: &Path,
    staged: &Path,
    hash: &str,
    bytes: u64,
    original_name: &str,
    occurrence: Occurrence,
) -> Result<Published, String> {
    let mut catalog = load(root)?;
    if let Some(existing) = catalog.assets.iter_mut().find(|asset| asset.id == hash) {
        let already_known = existing.occurrences.iter().any(|item| {
            item.source_path == occurrence.source_path && item.device_serial == occurrence.device_serial
        });
        if !already_known {
            existing.occurrences.push(occurrence);
        }
        let asset = existing.clone();
        let _ = fs::remove_file(staged);
        commit(root, &catalog)?;
        return Ok(Published { asset, is_new: false });
    }

    let originals = root.join(ORIGINALS_DIR);
    let name = available_name(&originals, &storable_name(original_name)?)?;
    let destination = originals.join(&name);
    fs::rename(staged, &destination).map_err(|e| format!("{}: {e}", destination.display()))?;

    let asset = Asset {
        id: hash.to_string(),
        stored_path: format!("{ORIGINALS_DIR}/{name}"),
        original_name: original_name.to_string(),
        bytes,
        first_imported_unix: occurrence.imported_unix,
        occurrences: vec![occurrence],
        regions: Vec::new(),
        label: None,
    };
    catalog.assets.push(asset.clone());
    if let Err(error) = commit(root, &catalog) {
        // Leave the audio in place; it is the user's file, and the index is rebuilt on the next import.
        return Err(format!("{} was saved but the library index could not be updated: {error}", destination.display()));
    }
    Ok(Published { asset, is_new: true })
}

// --- Commands ----------------------------------------------------------------

#[derive(Serialize)]
pub struct CatalogStatus {
    pub path: String,
    pub assets: usize,
    pub bytes: u64,
    pub occurrences: usize,
}

fn status_of(root: &Path, catalog: &Catalog) -> CatalogStatus {
    CatalogStatus {
        path: root.display().to_string(),
        assets: catalog.assets.len(),
        bytes: catalog.assets.iter().map(|asset| asset.bytes).sum(),
        occurrences: catalog.assets.iter().map(|asset| asset.occurrences.len()).sum(),
    }
}

/// Open the library at `path`, or at the default location when none is given.
#[tauri::command]
pub async fn catalog_open(state: State<'_, DeviceState>, path: Option<String>) -> Result<CatalogStatus, String> {
    let root = match path {
        Some(path) if !path.trim().is_empty() => PathBuf::from(path),
        _ => default_root()?,
    };
    let opened = root.clone();
    let catalog = tauri::async_runtime::spawn_blocking(move || open_root(&opened)).await.map_err(|e| e.to_string())??;
    let status = status_of(&root, &catalog);
    *state.library.lock().map_err(|_| "Library registry unavailable")? = Some(root);
    Ok(status)
}

/// Let the user pick a different folder for the library. Returns null if cancelled.
#[tauri::command]
pub async fn catalog_choose(state: State<'_, DeviceState>) -> Result<Option<CatalogStatus>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new().set_title("Choose a folder for your Fieldwork library").pick_folder().await else { return Ok(None); };
    let root = folder.path().to_path_buf();
    state.approved_folders.lock().map_err(|_| "Folder registry unavailable")?.insert(root.clone());
    let opened = root.clone();
    let catalog = tauri::async_runtime::spawn_blocking(move || open_root(&opened)).await.map_err(|e| e.to_string())??;
    let status = status_of(&root, &catalog);
    *state.library.lock().map_err(|_| "Library registry unavailable")? = Some(root);
    Ok(Some(status))
}

/// Copy files already on this Mac into the library.
///
/// The catalog has always described an occurrence's `source` as "device" or
/// "local", but nothing ever created a local one — so a recording you already had
/// could not be auditioned, marked into regions or sent to a pad without first
/// putting it on an instrument. The whole capture workflow was reachable only
/// through a cable.
///
/// Files are copied, never moved or altered: the original stays exactly where the
/// user put it. Identity is the same SHA-256 as everything else here, so a file
/// that is already in the library from a device gains a second occurrence rather
/// than a second copy.
#[tauri::command]
pub async fn catalog_import_local(state: State<'_, DeviceState>) -> Result<Vec<ImportOutcome>, String> {
    let Some(chosen) = rfd::AsyncFileDialog::new()
        .set_title("Choose recordings to add to your library")
        .add_filter("audio", &["wav", "aif", "aiff", "WAV", "AIF", "AIFF"])
        .pick_files()
        .await
    else {
        return Ok(Vec::new());
    };
    let root = current_root(&state)?;
    let paths: Vec<PathBuf> = chosen.into_iter().map(|file| file.path().to_path_buf()).collect();
    tauri::async_runtime::spawn_blocking(move || import_local_files(&root, paths))
        .await
        .map_err(|e| e.to_string())?
}

/// The copying itself, with no dialog and no device: testable on its own.
pub fn import_local_files(root: &Path, paths: Vec<PathBuf>) -> Result<Vec<ImportOutcome>, String> {
    if paths.is_empty() {
        return Ok(Vec::new());
    }
    let staging = root.join(STAGING_DIR);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let mut outcomes = Vec::new();
    for (index, path) in paths.into_iter().enumerate() {
        let shown = path.display().to_string();
        let name = path.file_name().and_then(|name| name.to_str()).unwrap_or("").to_string();
        let failure = |error: String| ImportOutcome {
            source_path: shown.clone(), status: "failed".into(), asset_id: None, error: Some(error),
        };
        if name.is_empty() {
            outcomes.push(failure("That file has no name this app can read.".into()));
            continue;
        }
        // Unique per file, as the device import learned: two files chosen in the same
        // second can share a name, and a partial copy must never block the next one.
        let staged = staging.join(staged_name(now_unix(), index as u32, &name));
        let copied = (|| -> Result<(u64, String), String> {
            let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("That is not a regular file.".into());
            }
            let bytes = fs::copy(&path, &staged).map_err(|e| e.to_string())?;
            let hash = format!("{:x}", sha2::Sha256::digest(fs::read(&staged).map_err(|e| e.to_string())?));
            Ok((bytes, hash))
        })();
        match copied {
            Err(error) => {
                let _ = fs::remove_file(&staged);
                outcomes.push(failure(error));
            }
            Ok((bytes, hash)) => {
                let occurrence = Occurrence {
                    source: "local".into(),
                    device_model: None,
                    device_serial: None,
                    source_path: shown.clone(),
                    captured_at: None,
                    imported_unix: now_unix(),
                };
                match publish(root, &staged, &hash, bytes, &name, occurrence) {
                    Ok(published) => outcomes.push(ImportOutcome {
                        source_path: shown,
                        status: if published.is_new { "imported".into() } else { "already in library".into() },
                        asset_id: Some(published.asset.id),
                        error: None,
                    }),
                    Err(error) => {
                        let _ = fs::remove_file(&staged);
                        outcomes.push(failure(error));
                    }
                }
            }
        }
    }
    Ok(outcomes)
}

pub fn current_root(state: &State<'_, DeviceState>) -> Result<PathBuf, String> {
    state
        .library
        .lock()
        .map_err(|_| "Library registry unavailable")?
        .clone()
        .ok_or_else(|| "Open your library before importing.".to_string())
}

#[tauri::command]
pub async fn catalog_status(state: State<'_, DeviceState>) -> Result<Option<CatalogStatus>, String> {
    let Some(root) = state.library.lock().map_err(|_| "Library registry unavailable")?.clone() else { return Ok(None); };
    let catalog = tauri::async_runtime::spawn_blocking({
        let root = root.clone();
        move || load(&root)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(Some(status_of(&root, &catalog)))
}

/// Everything the catalog knows, for the library view.
#[tauri::command]
pub async fn catalog_assets(state: State<'_, DeviceState>) -> Result<Vec<Asset>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || load(&root).map(|catalog| catalog.assets)).await.map_err(|e| e.to_string())?
}

#[derive(Deserialize)]
pub struct ImportRequest {
    pub handle: u32,
    /// Path on the device, used for provenance and for the stored name.
    pub path: String,
    pub size: u64,
    pub captured_at: Option<String>,
}

#[derive(Serialize)]
pub struct ImportOutcome {
    pub source_path: String,
    /// "imported", "already in library", or "failed".
    pub status: String,
    pub asset_id: Option<String>,
    pub error: Option<String>,
}

/// Stream the chosen device files into the library, verifying every one by hash
/// before it is published. Completed imports survive a later failure in the batch.
#[tauri::command]
pub async fn catalog_import_from_device(
    state: State<'_, DeviceState>,
    files: Vec<ImportRequest>,
) -> Result<Vec<ImportOutcome>, String> {
    if files.is_empty() {
        return Err("Nothing selected to import.".into());
    }
    let root = current_root(&state)?;
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let info = device.device_info();
    let model = Some(info.model.clone());
    let serial = Some(info.serial_number.clone());
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let staging = root.join(STAGING_DIR);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;

    let mut outcomes = Vec::new();
    for request in files {
        let name = request.path.rsplit('/').next().unwrap_or(&request.path).to_string();
        // The object handle is in the staged name because a second is not unique
        // enough: an OP-1 field calls every tape track `track_1.aif`, and the
        // download refuses to write over an existing path. Without this, one file
        // failing mid-transfer made every same-named file after it in the batch fail
        // too, with the operating system's words rather than ours.
        let staged = staging.join(staged_name(now_unix(), request.handle, &name));
        let outcome = match backup::stream_object_to_file(storage, ObjectHandle(request.handle), &staged, Some(request.size)).await {
            Err(error) => {
                // A half-downloaded file is ours, not the user's; leaving it behind
                // would litter the library and block the next attempt.
                let _ = fs::remove_file(&staged);
                ImportOutcome { source_path: request.path.clone(), status: "failed".into(), asset_id: None, error: Some(error) }
            }
            Ok((bytes, hash)) => {
                let occurrence = Occurrence {
                    source: "device".into(),
                    device_model: model.clone(),
                    device_serial: serial.clone(),
                    source_path: request.path.clone(),
                    captured_at: request.captured_at.clone(),
                    imported_unix: now_unix(),
                };
                match publish(&root, &staged, &hash, bytes, &name, occurrence) {
                    Ok(published) => ImportOutcome {
                        source_path: request.path.clone(),
                        status: if published.is_new { "imported".into() } else { "already in library".into() },
                        asset_id: Some(published.asset.id),
                        error: None,
                    },
                    Err(error) => {
                        let _ = fs::remove_file(&staged);
                        ImportOutcome { source_path: request.path.clone(), status: "failed".into(), asset_id: None, error: Some(error) }
                    }
                }
            }
        };
        outcomes.push(outcome);
    }
    Ok(outcomes)
}


#[derive(Deserialize)]
pub struct RegionInput {
    /// Omitted for a new region; supplied to update one in place.
    pub id: Option<String>,
    pub name: String,
    pub start_frame: u64,
    pub end_frame: u64,
}

fn valid_region(input: &RegionInput) -> Result<(), String> {
    if input.name.trim().is_empty() {
        return Err("Give the region a name.".into());
    }
    if input.end_frame <= input.start_frame {
        return Err("A region has to end after it starts.".into());
    }
    Ok(())
}

/// Save a marked span of a take. Regions are metadata: the audio is never rewritten.
#[tauri::command]
pub async fn catalog_save_region(
    state: State<'_, DeviceState>,
    asset_id: String,
    region: RegionInput,
) -> Result<Region, String> {
    valid_region(&region)?;
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let asset = catalog.assets.iter_mut().find(|asset| asset.id == asset_id).ok_or("That take is not in this library.")?;
        let saved = match region.id.as_deref().and_then(|id| asset.regions.iter_mut().find(|existing| existing.id == id)) {
            Some(existing) => {
                existing.name = region.name.trim().to_string();
                existing.start_frame = region.start_frame;
                existing.end_frame = region.end_frame;
                existing.clone()
            }
            None => {
                let created = Region {
                    id: format!("{}-{}", now_unix(), asset.regions.len() + 1),
                    name: region.name.trim().to_string(),
                    start_frame: region.start_frame,
                    end_frame: region.end_frame,
                    created_unix: now_unix(),
                };
                asset.regions.push(created.clone());
                created
            }
        };
        commit(&root, &catalog)?;
        Ok(saved)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Name a take in your own library.
///
/// This writes one field in the catalog. The file on disk is not renamed, not moved and
/// not rewritten — the library is content-addressed, so the bytes and their path are
/// identity, and `original_name` stays as the name the recorder gave it. Clearing the
/// label (an empty string) restores that name in the interface.
///
/// Nothing here touches a device. The instrument's own files are never renamed by this
/// app, and this command does not change that: it names your copy.
#[tauri::command]
pub async fn catalog_label_asset(
    state: State<'_, DeviceState>,
    asset_id: String,
    label: String,
) -> Result<Asset, String> {
    let trimmed = label.trim().to_string();
    if trimmed.chars().count() > MAX_LABEL_CHARS {
        return Err(format!("That name is {} characters; {MAX_LABEL_CHARS} is the most a take name can hold.", trimmed.chars().count()));
    }
    // A label is shown in a list and put into filenames downstream, so the characters
    // that break either are refused by name rather than silently stripped.
    if let Some(bad) = trimmed.chars().find(|c| c.is_control() || matches!(c, '/' | '\\' | ':')) {
        return Err(match bad {
            '/' | '\\' | ':' => format!("A take name cannot contain {bad:?} — it would break the file name when you send it somewhere."),
            _ => "A take name cannot contain control characters.".to_string(),
        });
    }
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let asset = catalog.assets.iter_mut().find(|asset| asset.id == asset_id).ok_or("That take is not in this library.")?;
        asset.label = if trimmed.is_empty() { None } else { Some(trimmed) };
        let updated = asset.clone();
        commit(&root, &catalog)?;
        Ok(updated)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forget a region. The take's audio is untouched.
#[tauri::command]
pub async fn catalog_delete_region(
    state: State<'_, DeviceState>,
    asset_id: String,
    region_id: String,
) -> Result<Vec<Region>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let asset = catalog.assets.iter_mut().find(|asset| asset.id == asset_id).ok_or("That take is not in this library.")?;
        let before = asset.regions.len();
        asset.regions.retain(|region| region.id != region_id);
        if asset.regions.len() == before {
            return Err("That region is already gone.".into());
        }
        let remaining = asset.regions.clone();
        commit(&root, &catalog)?;
        Ok(remaining)
    })
    .await
    .map_err(|e| e.to_string())?
}


#[derive(Deserialize)]
pub struct TransferInput {
    pub device_model: String,
    pub device_serial: Option<String>,
    pub destination: String,
    pub name: String,
    pub files: Vec<TransferFile>,
    pub outcome: String,
    pub error: Option<String>,
    pub source_asset_id: Option<String>,
    pub source_region: Option<String>,
}

/// Newest transfers first, for the history view.
#[tauri::command]
pub async fn catalog_transfers(state: State<'_, DeviceState>) -> Result<Vec<Transfer>, String> {
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        load(&root).map(|catalog| {
            let mut transfers = catalog.transfers;
            transfers.reverse();
            transfers
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Record a device write. Only called after the write itself reported its outcome,
/// so a failure is kept as a failure rather than quietly dropped.
#[tauri::command]
pub async fn catalog_record_transfer(state: State<'_, DeviceState>, transfer: TransferInput) -> Result<Transfer, String> {
    if transfer.outcome != "verified" && transfer.outcome != "failed" {
        return Err("A transfer is either verified or failed.".into());
    }
    let root = current_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let mut catalog = load(&root)?;
        let entry = Transfer {
            id: format!("{}-{}", now_unix(), catalog.transfers.len() + 1),
            sent_unix: now_unix(),
            device_model: transfer.device_model,
            device_serial: transfer.device_serial,
            destination: transfer.destination,
            name: transfer.name,
            files: transfer.files,
            outcome: transfer.outcome,
            error: transfer.error,
            source_asset_id: transfer.source_asset_id,
            source_region: transfer.source_region,
        };
        catalog.transfers.push(entry.clone());
        commit(&root, &catalog)?;
        Ok(entry)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Root(PathBuf);
    impl Root {
        fn new(label: &str) -> Self {
            let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/catalog-tests").join(format!("{label}-{id}"));
            fs::create_dir_all(&path).unwrap();
            open_root(&path).unwrap();
            Self(path)
        }
        fn staged(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.0.join(STAGING_DIR).join(name);
            fs::write(&path, contents).unwrap();
            path
        }
    }
    impl Drop for Root {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn occurrence(path: &str) -> Occurrence {
        Occurrence {
            source: "device".into(),
            device_model: Some("TP-7".into()),
            device_serial: Some("F1RTL11C".into()),
            source_path: path.into(),
            captured_at: Some("2026-02-23T11:27:13".into()),
            imported_unix: 1_700_000_000,
        }
    }

    #[test]
    fn opens_an_empty_library_and_reads_it_back() {
        let root = Root::new("open");
        assert!(root.0.join(ORIGINALS_DIR).is_dir());
        assert!(root.0.join(STAGING_DIR).is_dir());
        let catalog = load(&root.0).unwrap();
        assert_eq!(catalog.format, FORMAT);
        assert_eq!(catalog.version, VERSION);
        assert!(catalog.assets.is_empty());
    }

    #[test]
    fn publishes_a_take_and_survives_a_reload() {
        let root = Root::new("publish");
        let staged = root.staged("take.wav", b"audio bytes");
        let published = publish(&root.0, &staged, "hash-a", 11, "take.wav", occurrence("recordings/take.wav")).unwrap();
        assert!(published.is_new);
        assert_eq!(published.asset.stored_path, "originals/take.wav");
        assert!(!staged.exists(), "the staged copy is consumed");
        assert_eq!(fs::read(root.0.join("originals/take.wav")).unwrap(), b"audio bytes");

        let reloaded = load(&root.0).unwrap();
        assert_eq!(reloaded.assets.len(), 1);
        assert_eq!(reloaded.assets[0].id, "hash-a");
        assert_eq!(reloaded.assets[0].occurrences, vec![occurrence("recordings/take.wav")]);
    }


    #[test]
    fn stages_each_download_under_its_own_name() {
        // Same second, same name, different objects: an OP-1 field's tape tracks.
        let first = staged_name(1_758_800_000, 41, "track_1.aif");
        let second = staged_name(1_758_800_000, 42, "track_1.aif");
        assert_ne!(first, second);
        assert!(first.ends_with("track_1.aif"), "{first}");
        assert!(first.contains("41"));
    }

    #[test]
    fn clears_partial_downloads_when_a_library_is_opened() {
        let root = Root::new("sweep");
        // A failed or interrupted import leaves bytes in staging that are no use to
        // anyone, and would block the next download to the same path.
        let leftover = root.staged("1758800000-41-track_1.aif", b"half a file");
        let other = root.staged("1758800000-42-track_1.aif", b"half another");
        assert!(leftover.exists() && other.exists());

        let kept = root.0.join("originals/keep.wav");
        fs::write(&kept, b"a real take").unwrap();

        // The blast radius is the thing worth pinning. This is the only automatic deletion
        // in the app, and it runs inside the user's own recordings folder every time the
        // library is opened — so what it must *not* touch matters more than what it does.
        let catalog = root.0.join(CATALOG_FILE);
        assert!(catalog.exists(), "the catalog should exist before the sweep");
        let catalog_before = fs::read(&catalog).unwrap();
        // A stray file at the library root, which is where the catalog lives: if the staging
        // directory constant were ever empty, `root.join("")` is the root itself and this
        // sweep would take the catalog with it — losing every take's provenance and every
        // marked region, with no copy anywhere.
        let stray = root.0.join("notes.txt");
        fs::write(&stray, b"the owner put this here").unwrap();
        // And a folder inside staging, which is not a file and must survive.
        let nested = root.0.join(STAGING_DIR).join("subfolder");
        fs::create_dir_all(&nested).unwrap();

        assert_eq!(sweep_staging(&root.0), 2);
        assert!(!leftover.exists());
        assert!(!other.exists());
        // Never anything but loose files in our own staging folder.
        assert_eq!(fs::read(&kept).unwrap(), b"a real take");
        assert_eq!(fs::read(&catalog).unwrap(), catalog_before, "the sweep must never touch the catalog");
        assert_eq!(fs::read(&stray).unwrap(), b"the owner put this here", "the sweep must not touch files at the library root");
        assert!(nested.is_dir(), "the sweep removes files, not folders");

        // Opening the library does it, and an empty staging folder is not an error.
        open_root(&root.0).unwrap();
        assert_eq!(sweep_staging(&root.0), 0);
    }

    #[test]
    fn copies_local_files_into_the_library_without_touching_them() {
        let root = Root::new("local");
        open_root(&root.0).unwrap();
        let outside = root.0.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        let first = outside.join("bounce.wav");
        let second = outside.join("take.aif");
        fs::write(&first, b"first audio").unwrap();
        fs::write(&second, b"second audio").unwrap();

        let outcomes = import_local_files(&root.0, vec![first.clone(), second.clone()]).unwrap();
        assert_eq!(outcomes.iter().map(|o| o.status.as_str()).collect::<Vec<_>>(), ["imported", "imported"]);
        // The user's own files stay exactly where they were, untouched.
        assert_eq!(fs::read(&first).unwrap(), b"first audio");
        assert_eq!(fs::read(&second).unwrap(), b"second audio");

        let catalog = load(&root.0).unwrap();
        assert_eq!(catalog.assets.len(), 2);
        for asset in &catalog.assets {
            assert_eq!(asset.occurrences[0].source, "local");
            assert!(asset.occurrences[0].device_model.is_none());
            // Where it came from on this Mac, so a take can be traced back.
            assert!(asset.occurrences[0].source_path.contains("elsewhere"));
            assert!(root.0.join(&asset.stored_path).exists());
        }
        // Nothing is left in staging.
        assert_eq!(sweep_staging(&root.0), 0);
    }

    #[test]
    fn a_local_file_already_held_from_a_device_becomes_another_occurrence() {
        let root = Root::new("local-dupe");
        open_root(&root.0).unwrap();
        let staged = root.staged("take.wav", b"same audio");
        let hash = format!("{:x}", sha2::Sha256::digest(b"same audio"));
        publish(&root.0, &staged, &hash, 10, "take.wav", occurrence("recordings/take.wav")).unwrap();

        let outside = root.0.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        let local = outside.join("renamed.wav");
        fs::write(&local, b"same audio").unwrap();

        let outcomes = import_local_files(&root.0, vec![local]).unwrap();
        assert_eq!(outcomes[0].status, "already in library");
        let catalog = load(&root.0).unwrap();
        // One asset, two places it came from — the same rule the device import follows.
        assert_eq!(catalog.assets.len(), 1);
        assert_eq!(catalog.assets[0].occurrences.len(), 2);
        assert_eq!(catalog.assets[0].occurrences[1].source, "local");
    }

    #[test]
    fn reports_a_file_it_cannot_read_without_abandoning_the_rest() {
        let root = Root::new("local-partial");
        open_root(&root.0).unwrap();
        let outside = root.0.join("elsewhere");
        fs::create_dir_all(&outside).unwrap();
        let good = outside.join("good.wav");
        fs::write(&good, b"audio").unwrap();
        let missing = outside.join("gone.wav");

        let outcomes = import_local_files(&root.0, vec![missing, good]).unwrap();
        assert_eq!(outcomes[0].status, "failed");
        assert!(outcomes[0].error.is_some());
        // The one that could be read still arrives.
        assert_eq!(outcomes[1].status, "imported");
        assert_eq!(load(&root.0).unwrap().assets.len(), 1);
        assert_eq!(sweep_staging(&root.0), 0, "a failed copy leaves nothing behind");
    }

    #[test]
    fn an_empty_choice_does_nothing() {
        let root = Root::new("local-none");
        open_root(&root.0).unwrap();
        assert!(import_local_files(&root.0, vec![]).unwrap().is_empty());
        assert_eq!(load(&root.0).unwrap().assets.len(), 0);
    }

    #[test]
    fn different_audio_under_the_same_name_is_kept_separately() {
        // An OP-1 field calls every tape track `track_1.aif`. Four tracks a side, two
        // sides, plus the album: without a distinct stored name, importing the second
        // would overwrite the first and the library would quietly lose a recording.
        let root = Root::new("same-name");
        let sides = [
            ("hash-side1", b"side one audio".to_vec(), "tape/side-1/track_1.aif"),
            ("hash-side2", b"side two audio".to_vec(), "tape/side-2/track_1.aif"),
            ("hash-album", b"album audio!!!".to_vec(), "album/track_1.aif"),
        ];
        let mut stored = Vec::new();
        for (hash, bytes, source) in &sides {
            let staged = root.staged("track_1.aif", bytes);
            let published = publish(&root.0, &staged, hash, bytes.len() as u64, "track_1.aif", occurrence(source)).unwrap();
            assert!(published.is_new, "{source} is a different recording");
            stored.push(published.asset.stored_path);
        }

        assert_eq!(stored, vec!["originals/track_1.aif", "originals/track_1 2.aif", "originals/track_1 3.aif"]);
        // Every recording is still on disk, whole, and each one's own audio.
        for ((_, bytes, _), path) in sides.iter().zip(&stored) {
            assert_eq!(&fs::read(root.0.join(path)).unwrap(), bytes, "{path}");
        }
        let catalog = load(&root.0).unwrap();
        assert_eq!(catalog.assets.len(), 3);
        // The name the user knows them by is unchanged; only where they are stored differs.
        assert!(catalog.assets.iter().all(|asset| asset.original_name == "track_1.aif"));
    }

    #[test]
    fn identical_audio_becomes_another_occurrence_not_another_copy() {
        let root = Root::new("dedupe");
        let first = root.staged("take.wav", b"same bytes");
        publish(&root.0, &first, "hash-a", 10, "take.wav", occurrence("recordings/take.wav")).unwrap();

        // Same bytes, different name and different device path.
        let second = root.staged("renamed.wav", b"same bytes");
        let published = publish(&root.0, &second, "hash-a", 10, "renamed.wav", occurrence("memo/renamed.wav")).unwrap();
        assert!(!published.is_new);
        assert_eq!(published.asset.occurrences.len(), 2);
        assert!(!second.exists(), "no second copy of the audio is kept");
        assert!(!root.0.join("originals/renamed.wav").exists());

        let catalog = load(&root.0).unwrap();
        assert_eq!(catalog.assets.len(), 1);
        assert_eq!(catalog.assets[0].occurrences.len(), 2);
    }

    #[test]
    fn reimporting_the_same_file_twice_does_not_duplicate_its_occurrence() {
        let root = Root::new("reimport");
        let first = root.staged("take.wav", b"bytes");
        publish(&root.0, &first, "hash-a", 5, "take.wav", occurrence("recordings/take.wav")).unwrap();
        let again = root.staged("take.wav", b"bytes");
        let published = publish(&root.0, &again, "hash-a", 5, "take.wav", occurrence("recordings/take.wav")).unwrap();
        assert!(!published.is_new);
        assert_eq!(published.asset.occurrences.len(), 1);
    }

    #[test]
    fn different_audio_with_the_same_name_is_stored_beside_it() {
        let root = Root::new("collide");
        let first = root.staged("a.wav", b"one");
        publish(&root.0, &first, "hash-a", 3, "take.wav", occurrence("recordings/take.wav")).unwrap();
        let second = root.staged("b.wav", b"two");
        let published = publish(&root.0, &second, "hash-b", 3, "take.wav", occurrence("memo/take.wav")).unwrap();
        assert!(published.is_new);
        assert_eq!(published.asset.stored_path, "originals/take 2.wav");
        assert_eq!(fs::read(root.0.join("originals/take.wav")).unwrap(), b"one", "the first file is untouched");
        assert_eq!(fs::read(root.0.join("originals/take 2.wav")).unwrap(), b"two");
    }

    #[test]
    fn refuses_a_name_that_would_escape_the_library() {
        let root = Root::new("escape");
        for name in ["../outside.wav", "a/b.wav", "..", ""] {
            let staged = root.staged("staged.wav", b"bytes");
            let error = publish(&root.0, &staged, "hash-x", 5, name, occurrence("recordings/x.wav")).unwrap_err();
            assert!(error.contains("not a name this library can store"), "{name}: {error}");
            let _ = fs::remove_file(&staged);
        }
        assert!(load(&root.0).unwrap().assets.is_empty());
    }

    #[test]
    fn refuses_an_index_from_a_newer_version_rather_than_overwriting_it() {
        let root = Root::new("newer");
        let future = serde_json::json!({ "format": FORMAT, "version": VERSION + 1, "created_unix": 0, "assets": [] });
        fs::write(catalog_file(&root.0), serde_json::to_vec(&future).unwrap()).unwrap();
        let error = load(&root.0).unwrap_err();
        assert!(error.contains("newer version"), "{error}");
        // The file is still there, unmodified.
        let raw: serde_json::Value = serde_json::from_slice(&fs::read(catalog_file(&root.0)).unwrap()).unwrap();
        assert_eq!(raw["version"], VERSION + 1);
    }

    #[test]
    fn refuses_a_foreign_or_unreadable_index() {
        let root = Root::new("foreign");
        fs::write(catalog_file(&root.0), br#"{"format":"someone-elses-app","version":1,"created_unix":0,"assets":[]}"#).unwrap();
        assert!(load(&root.0).unwrap_err().contains("different app's library index"));
        fs::write(catalog_file(&root.0), b"not json at all").unwrap();
        assert!(load(&root.0).unwrap_err().contains("could not be read"));
    }

    /// A label is what the owner calls a take. It must not become a rename: the bytes and
    /// their path are the library's identity, and `original_name` is provenance.
    /// The sweep's bound is a string constant, so assert the string.
    ///
    /// `sweep_staging` reads `root.join(STAGING_DIR)`. If that constant were ever empty or
    /// `"."`, the join resolves to the library root and the only automatic deletion in the
    /// app would run over the owner's recordings and the catalog. Nothing else in the code
    /// would look wrong.
    #[test]
    fn the_staging_directory_can_never_resolve_to_the_library_root() {
        assert!(!STAGING_DIR.is_empty());
        assert_ne!(STAGING_DIR, ".");
        assert_ne!(STAGING_DIR, "..");
        assert!(!STAGING_DIR.contains('/') && !STAGING_DIR.contains('\\'));
        // The join must descend, not stay put.
        let root = Path::new("/tmp/library");
        assert_ne!(root.join(STAGING_DIR), root);
        assert!(root.join(STAGING_DIR).starts_with(root));
        // And it must not be where the takes or the catalog live.
        assert_ne!(STAGING_DIR, ORIGINALS_DIR);
        assert_ne!(STAGING_DIR, CATALOG_FILE);
    }

    #[test]
    fn labelling_a_take_leaves_its_bytes_name_and_path_alone() {
        let root = Root::new("label");
        let mut catalog = load(&root.0).unwrap();
        catalog.assets.push(Asset {
            id: "hash-a".into(),
            stored_path: "originals/2026-02-23_112713_000.wav".into(),
            original_name: "2026-02-23_112713_000.wav".into(),
            bytes: 10,
            first_imported_unix: 1,
            occurrences: vec![occurrence("recordings/2026-02-23_112713_000.wav")],
            regions: Vec::new(),
            label: None,
        });
        commit(&root.0, &catalog).unwrap();

        let mut catalog = load(&root.0).unwrap();
        catalog.assets[0].label = Some("yard door slam".into());
        commit(&root.0, &catalog).unwrap();

        let reloaded = load(&root.0).unwrap();
        let asset = &reloaded.assets[0];
        assert_eq!(asset.label.as_deref(), Some("yard door slam"));
        // Everything that identifies the take is untouched.
        assert_eq!(asset.id, "hash-a");
        assert_eq!(asset.stored_path, "originals/2026-02-23_112713_000.wav");
        assert_eq!(asset.original_name, "2026-02-23_112713_000.wav");
        assert_eq!(asset.bytes, 10);
        assert_eq!(asset.occurrences.len(), 1);
    }

    /// Libraries written before labels existed must load unchanged, and a take with no
    /// label must not gain an empty one in the file.
    #[test]
    fn a_library_without_labels_still_loads_and_stays_clean() {
        let root = Root::new("label-compat");
        let mut catalog = load(&root.0).unwrap();
        catalog.assets.push(Asset {
            id: "hash-b".into(),
            stored_path: "originals/take.wav".into(),
            original_name: "take.wav".into(),
            bytes: 4,
            first_imported_unix: 1,
            occurrences: vec![occurrence("recordings/take.wav")],
            regions: Vec::new(),
            label: None,
        });
        commit(&root.0, &catalog).unwrap();
        let written = fs::read_to_string(catalog_file(&root.0)).unwrap();
        // `skip_serializing_if` keeps the absent case absent rather than writing null.
        assert!(!written.contains("label"), "an unlabelled take should not write the field: {written}");
        assert_eq!(load(&root.0).unwrap().assets[0].label, None);
    }

    #[test]
    fn commits_atomically_and_leaves_no_temporary_file() {
        let root = Root::new("atomic");
        let mut catalog = load(&root.0).unwrap();
        catalog.assets.push(Asset {
            id: "hash-a".into(),
            stored_path: "originals/take.wav".into(),
            original_name: "take.wav".into(),
            bytes: 10,
            first_imported_unix: 1,
            occurrences: vec![occurrence("recordings/take.wav")],
            regions: Vec::new(),
            label: None,
        });
        commit(&root.0, &catalog).unwrap();
        assert!(!root.0.join(format!("{CATALOG_FILE}.writing")).exists());
        assert_eq!(load(&root.0).unwrap().assets.len(), 1);
    }


    #[test]
    fn a_library_written_before_regions_existed_still_loads() {
        let root = Root::new("legacy");
        let legacy = serde_json::json!({
            "format": FORMAT, "version": VERSION, "created_unix": 0,
            "assets": [{
                "id": "hash-a", "stored_path": "originals/take.wav", "original_name": "take.wav",
                "bytes": 10, "first_imported_unix": 1, "occurrences": []
            }]
        });
        fs::write(catalog_file(&root.0), serde_json::to_vec(&legacy).unwrap()).unwrap();
        let catalog = load(&root.0).unwrap();
        assert_eq!(catalog.assets[0].regions, Vec::new(), "missing regions read as none, not as an error");
    }

    #[test]
    fn regions_are_metadata_and_survive_a_reload() {
        let root = Root::new("regions");
        let staged = root.staged("take.wav", b"audio bytes");
        publish(&root.0, &staged, "hash-a", 11, "take.wav", occurrence("recordings/take.wav")).unwrap();
        let original = fs::read(root.0.join("originals/take.wav")).unwrap();

        let mut catalog = load(&root.0).unwrap();
        let asset = catalog.assets.iter_mut().find(|asset| asset.id == "hash-a").unwrap();
        asset.regions.push(Region { id: "r1".into(), name: "kick".into(), start_frame: 100, end_frame: 4_400, created_unix: 5 });
        commit(&root.0, &catalog).unwrap();

        let reloaded = load(&root.0).unwrap();
        assert_eq!(reloaded.assets[0].regions.len(), 1);
        assert_eq!(reloaded.assets[0].regions[0].name, "kick");
        assert_eq!(fs::read(root.0.join("originals/take.wav")).unwrap(), original, "the audio is untouched");
    }

    #[test]
    fn refuses_a_region_that_ends_before_it_starts_or_has_no_name() {
        assert!(valid_region(&RegionInput { id: None, name: "kick".into(), start_frame: 10, end_frame: 10 }).unwrap_err().contains("end after it starts"));
        assert!(valid_region(&RegionInput { id: None, name: "kick".into(), start_frame: 20, end_frame: 10 }).is_err());
        assert!(valid_region(&RegionInput { id: None, name: "   ".into(), start_frame: 0, end_frame: 10 }).unwrap_err().contains("name"));
        assert!(valid_region(&RegionInput { id: None, name: "kick".into(), start_frame: 0, end_frame: 1 }).is_ok());
    }


    #[test]
    fn records_transfers_newest_last_and_keeps_failures() {
        let root = Root::new("transfers");
        let mut catalog = load(&root.0).unwrap();
        for (index, outcome) in [("kit one", "verified"), ("kit two", "failed")].iter().enumerate() {
            catalog.transfers.push(Transfer {
                id: format!("t{index}"), sent_unix: 100 + index as u64,
                device_model: "OP-XY".into(), device_serial: Some("XY1".into()),
                destination: "presets/drum".into(), name: outcome.0.into(),
                files: vec![TransferFile { path: "patch.json".into(), bytes: 512 }],
                outcome: outcome.1.into(),
                error: if outcome.1 == "failed" { Some("USB disconnected".into()) } else { None },
                source_asset_id: Some("hash-a".into()), source_region: Some("kick 01".into()),
            });
        }
        commit(&root.0, &catalog).unwrap();

        let reloaded = load(&root.0).unwrap();
        assert_eq!(reloaded.transfers.len(), 2);
        assert_eq!(reloaded.transfers[1].outcome, "failed");
        assert_eq!(reloaded.transfers[1].error.as_deref(), Some("USB disconnected"));
        assert_eq!(reloaded.transfers[0].source_region.as_deref(), Some("kick 01"));
    }

    #[test]
    fn a_library_without_transfer_history_still_loads() {
        let root = Root::new("legacy-transfers");
        let legacy = serde_json::json!({ "format": FORMAT, "version": VERSION, "created_unix": 0, "assets": [] });
        fs::write(catalog_file(&root.0), serde_json::to_vec(&legacy).unwrap()).unwrap();
        assert_eq!(load(&root.0).unwrap().transfers, Vec::new());
    }

    #[test]
    fn default_root_sits_under_the_user_music_folder() {
        let root = default_root().unwrap();
        assert!(root.ends_with("Music/Fieldwork Library"), "{}", root.display());
    }
}
