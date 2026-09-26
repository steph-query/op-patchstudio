use crate::{find_child_folder_ci, te, walk_directory, DeviceState};
use mtp_rs::mtp::Storage;
use mtp_rs::ptp::ObjectHandle;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::State;

const MANIFEST: &str = "doxy-backup.json";
/// Roots assumed for manifests written before the device kind was recorded (OP-XY only).
const DEFAULT_ROOTS: [&str; 3] = ["projects", "presets", "samples"];

#[derive(Serialize, Deserialize)]
struct BackupFile {
    path: String,
    size: u64,
    sha256: String,
}

#[derive(Serialize, Deserialize)]
struct Manifest {
    format: String,
    version: u32,
    created_unix: u64,
    model: String,
    serial: String,
    firmware: String,
    #[serde(default)]
    kind: String,
    directories: Vec<String>,
    files: Vec<BackupFile>,
}

#[derive(Debug, Serialize)]
pub struct BackupResult {
    path: String,
    files: usize,
    bytes: u64,
    firmware: String,
    kind: String,
}

fn manifest_roots(manifest: &Manifest) -> Result<Vec<&'static str>, String> {
    if manifest.kind.is_empty() {
        return Ok(DEFAULT_ROOTS.to_vec());
    }
    let roots = te::backup_roots(&manifest.kind);
    if roots.is_empty() {
        return Err(format!("Unrecognized device kind in backup: {}", manifest.kind));
    }
    Ok(roots.to_vec())
}

fn valid_segment(part: &str) -> bool {
    !part.is_empty() && part != "." && part != ".."
        && !part.contains('\\') && !part.contains(':')
        && !part.chars().any(char::is_control)
}

fn valid_path(path: &str, roots: &[&str]) -> bool {
    let parts: Vec<_> = path.split('/').collect();
    roots.contains(&parts[0]) && parts.iter().all(|part| valid_segment(part))
}

/// Join a relative path onto a folder the user chose, refusing traversal, absolute paths and odd characters.
pub(crate) fn safe_join(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let parts: Vec<&str> = relative.split('/').collect();
    if parts.is_empty() || !parts.iter().all(|part| valid_segment(part)) {
        return Err(format!("Invalid destination path: {relative}"));
    }
    let mut path = root.to_path_buf();
    for part in parts {
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(metadata) if metadata.file_type().is_symlink() => return Err(format!("Destination contains a symbolic link: {}", path.display())),
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => return Err(error.to_string()),
            _ => {}
        }
    }
    Ok(path)
}

/// Write a new file, creating parent folders; refuses to overwrite.
pub(crate) fn write_new_file(target: &Path, data: &[u8]) -> Result<String, String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut output = OpenOptions::new().write(true).create_new(true).open(target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists { format!("{} already exists", target.display()) } else { e.to_string() }
    })?;
    output.write_all(data).map_err(|e| e.to_string())?;
    output.sync_all().map_err(|e| e.to_string())?;
    Ok(target.display().to_string())
}

/// Stream one device object to disk, returning its size and SHA-256. A failed transfer removes the partial file.
pub(crate) async fn stream_object_to_file(storage: &Storage, handle: ObjectHandle, target: &Path, expected_size: Option<u64>) -> Result<(u64, String), String> {
    let mut output = OpenOptions::new().write(true).create_new(true).open(target).map_err(|e| e.to_string())?;
    let result: Result<(u64, String), String> = async {
        let mut download = storage.download_stream(handle).await.map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        while let Some(chunk) = download.next_chunk().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = download.cancel(std::time::Duration::from_secs(2)).await;
                    return Err(error.to_string());
                }
            };
            if let Err(error) = output.write_all(&chunk) {
                let _ = download.cancel(std::time::Duration::from_secs(2)).await;
                return Err(error.to_string());
            }
            hasher.update(&chunk);
            size += chunk.len() as u64;
        }
        if let Some(expected) = expected_size {
            if size != expected { return Err("Device file changed or transfer was truncated".into()); }
        }
        output.sync_all().map_err(|e| e.to_string())?;
        Ok((size, format!("{:x}", hasher.finalize())))
    }.await;
    if result.is_err() {
        drop(output);
        let _ = fs::remove_file(target);
    }
    result
}

fn checked_path(root: &Path, relative: &str, roots: &[&str]) -> Result<PathBuf, String> {
    if !valid_path(relative, roots) { return Err(format!("Invalid backup path: {relative}")); }
    let mut path = root.to_path_buf();
    for part in relative.split('/') {
        path.push(part);
        let metadata = fs::symlink_metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        if metadata.file_type().is_symlink() { return Err(format!("Backup contains a symbolic link: {relative}")); }
    }
    Ok(path)
}

fn verify_folder(root: &Path) -> Result<BackupResult, String> {
    verify_folder_cancellable(root, None)
}

fn check_cancel(cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<(), String> {
    if cancel.is_some_and(|flag| flag.load(std::sync::atomic::Ordering::Relaxed)) { return Err("Restore preview cancelled. No files were written.".into()); }
    Ok(())
}

fn verify_folder_cancellable(root: &Path, cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<BackupResult, String> {
    check_cancel(cancel)?;
    let manifest_path = root.join(MANIFEST);
    let metadata = fs::symlink_metadata(&manifest_path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 32 * 1024 * 1024 {
        return Err("Invalid or oversized backup manifest".into());
    }
    let manifest: Manifest = serde_json::from_reader(File::open(manifest_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if manifest.format != "doxy-device-backup" || manifest.version != 1 {
        return Err("Unrecognized backup format".into());
    }
    let roots = manifest_roots(&manifest)?;
    let mut names = HashSet::new();
    for directory in &manifest.directories {
        if !names.insert(directory.clone()) || !checked_path(root, directory, &roots)?.is_dir() {
            return Err(format!("Invalid backup directory: {directory}"));
        }
    }
    if !roots.iter().all(|name| names.contains(*name)) { return Err("Backup is missing a library root".into()); }
    for path in manifest.directories.iter().chain(manifest.files.iter().map(|file| &file.path)) {
        if let Some((parent, _)) = path.rsplit_once('/') {
            if !manifest.directories.iter().any(|directory| directory == parent) { return Err(format!("Backup parent directory is untracked: {parent}")); }
        }
    }
    let mut bytes = 0u64;
    for entry in &manifest.files {
        check_cancel(cancel)?;
        if !names.insert(entry.path.clone()) { return Err(format!("Duplicate backup path: {}", entry.path)); }
        let path = checked_path(root, &entry.path, &roots)?;
        let mut file = File::open(path).map_err(|e| e.to_string())?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() { return Err(format!("Not a file: {}", entry.path)); }
        let mut hasher = Sha256::new();
        let mut size = 0u64;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            check_cancel(cancel)?;
            let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 { break; }
            size += count as u64;
            hasher.update(&buffer[..count]);
        }
        if size != entry.size || format!("{:x}", hasher.finalize()) != entry.sha256 {
            return Err(format!("Backup verification failed: {}", entry.path));
        }
        bytes = bytes.checked_add(size).ok_or("Backup size overflow")?;
    }
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        for item in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let path = item.path();
            let relative = path.strip_prefix(root).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            if relative == MANIFEST { continue; }
            if !names.contains(&relative) { return Err(format!("Untracked file or folder in backup: {relative}")); }
            if item.file_type().map_err(|e| e.to_string())?.is_dir() { pending.push(path); }
        }
    }
    let kind = if manifest.kind.is_empty() { "op-xy".to_string() } else { manifest.kind.clone() };
    Ok(BackupResult { path: root.display().to_string(), files: manifest.files.len(), bytes, firmware: manifest.firmware, kind })
}

#[tauri::command]
pub async fn verify_backup() -> Result<Option<BackupResult>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new().set_title("Fieldwork — choose a backup to verify (legacy doxy backups supported)").pick_folder().await else { return Ok(None); };
    let path = folder.path().to_path_buf();
    tauri::async_runtime::spawn_blocking(move || verify_folder(&path)).await.map_err(|e| e.to_string())?.map(Some)
}

fn backup_label(kind: &str) -> &'static str {
    match kind {
        "op-xy" => "OP-XY",
        "op-1-field" => "OP-1-field",
        "tp-7" => "TP-7",
        _ => "device",
    }
}

#[tauri::command]
pub async fn create_backup(state: State<'_, DeviceState>) -> Result<Option<BackupResult>, String> {
    let guard = state.device.lock().await;
    let Some(folder) = rfd::AsyncFileDialog::new().set_title("Choose where to save your backup").pick_folder().await else { return Ok(None); };
    let device = guard.as_ref().ok_or("Connect your device before creating a backup")?;
    let info = device.device_info();
    let kind = te::classify(&info.model, None);
    let roots = te::backup_roots(kind);
    if roots.is_empty() {
        return Err(format!("Backups are not supported for {} yet", info.model));
    }
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("Device has no storage")?;
    let mut entries = Vec::new();
    for root in roots {
        let folder = find_child_folder_ci(storage, None, root).await?.ok_or_else(|| format!("Missing {root} folder; backup cannot be complete"))?;
        for (relative, entry) in walk_directory(storage, folder.handle).await? {
            let path = format!("{root}/{relative}");
            if !valid_path(&path, roots) { return Err(format!("Unsupported device path: {path}")); }
            entries.push((path, entry));
        }
    }
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    let destination = folder.path().join(format!("{}-backup-{}", backup_label(kind), now.as_nanos()));
    fs::create_dir(&destination).map_err(|e| e.to_string())?;
    let mut manifest = Manifest {
        format: "doxy-device-backup".into(), version: 1, created_unix: now.as_secs(),
        model: info.model.clone(), serial: info.serial_number.clone(), firmware: info.device_version.clone(),
        kind: kind.to_string(),
        directories: roots.iter().map(|root| root.to_string()).collect(), files: Vec::new(),
    };
    // Keep the device mutex throughout the snapshot, preventing interleaved writes/disconnects.
    let result: Result<(), String> = async {
        for root in roots { fs::create_dir(destination.join(root)).map_err(|e| e.to_string())?; }
        for (path, entry) in entries {
            let target = destination.join(&path);
            if entry.is_directory {
                fs::create_dir(&target).map_err(|e| e.to_string())?;
                manifest.directories.push(path);
                continue;
            }
            let (size, sha256) = stream_object_to_file(storage, ObjectHandle(entry.handle), &target, Some(entry.size))
                .await
                .map_err(|e| format!("{path}: {e}"))?;
            manifest.files.push(BackupFile { path, size, sha256 });
        }
        let mut output = OpenOptions::new().write(true).create_new(true).open(destination.join(MANIFEST)).map_err(|e| e.to_string())?;
        serde_json::to_writer_pretty(&mut output, &manifest).map_err(|e| e.to_string())?;
        output.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    }.await;
    result.map_err(|e| format!("Backup incomplete at {}: {e}", destination.display()))?;
    drop(guard);
    tauri::async_runtime::spawn_blocking(move || verify_folder(&destination)).await.map_err(|e| e.to_string())?.map(Some)
}

pub(crate) struct PreparedRestore {
    token: String,
    folder: PathBuf,
    generation: u64,
    manifest_hash: String,
}

#[derive(Serialize)]
pub struct RestoreEntry { path: String, status: String, size: u64 }

#[derive(Serialize)]
pub struct RestorePreview {
    token: String,
    path: String,
    model: String,
    serial: String,
    entries: Vec<RestoreEntry>,
    required_bytes: u64,
    free_bytes: u64,
}

#[derive(Serialize)]
pub struct RestoreResult { copied: usize, skipped: usize, bytes: u64 }

fn load_manifest(folder: &Path) -> Result<Manifest, String> {
    serde_json::from_reader(File::open(folder.join(MANIFEST)).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

async fn device_hash(storage: &Storage, handle: ObjectHandle, cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<String, String> {
    check_cancel(cancel)?;
    let mut stream = storage.download_stream(handle).await.map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    while let Some(chunk) = stream.next_chunk().await {
        if let Err(error) = check_cancel(cancel) { let _ = stream.cancel(std::time::Duration::from_secs(2)).await; return Err(error); }
        match chunk {
            Ok(bytes) => hash.update(bytes),
            Err(error) => { let _ = stream.cancel(std::time::Duration::from_secs(2)).await; return Err(error.to_string()); }
        }
    }
    Ok(format!("{:x}", hash.finalize()))
}

async fn restore_inventory(storage: &Storage, roots: &[&str]) -> Result<std::collections::HashMap<String, mtp_rs::ptp::ObjectInfo>, String> {
    let mut entries = std::collections::HashMap::new();
    for object in storage.list_objects(None).await.map_err(|e| e.to_string())? {
        if !roots.iter().any(|root| object.filename.eq_ignore_ascii_case(root)) { continue; }
        let root_name = object.filename.to_lowercase();
        if object.is_folder() {
            for (path, child) in crate::walk_objects(storage, object.handle).await? {
                if entries.insert(format!("{root_name}/{}", path.to_lowercase()), child).is_some() { return Err("Ambiguous case-colliding device paths".into()); }
            }
        }
        if entries.insert(root_name, object).is_some() { return Err("Ambiguous device root folders".into()); }
    }
    Ok(entries)
}

async fn restore_entries(storage: &Storage, manifest: &Manifest, cancel: Option<&std::sync::atomic::AtomicBool>) -> Result<(Vec<RestoreEntry>, u64), String> {
    let roots = manifest_roots(manifest)?;
    let inventory = restore_inventory(storage, &roots).await?;
    let mut entries = Vec::new();
    let mut required = 0u64;
    let mut seen = HashSet::new();
    for path in &manifest.directories {
        if !seen.insert(path.to_lowercase()) { return Err("Backup has case-colliding paths".into()); }
        if let Some(existing) = inventory.get(&path.to_lowercase()) {
            if !existing.is_folder() { entries.push(RestoreEntry { path: path.clone(), status: "conflict".into(), size: 0 }); }
        }
    }
    for file in &manifest.files {
        check_cancel(cancel)?;
        if !seen.insert(file.path.to_lowercase()) { return Err("Backup has case-colliding paths".into()); }
        let status = match inventory.get(&file.path.to_lowercase()) {
            None => { required = required.checked_add(file.size).ok_or("Backup too large")?; "missing" }
            Some(object) if !object.is_folder() && object.size == file.size && device_hash(storage, object.handle, cancel).await? == file.sha256 => "identical",
            Some(_) => "conflict",
        };
        entries.push(RestoreEntry { path: file.path.clone(), status: status.into(), size: file.size });
    }
    Ok((entries, required))
}

#[tauri::command]
pub fn cancel_restore_preview(state: State<'_, DeviceState>) {
    state.restore_cancel.store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
pub async fn preview_restore(state: State<'_, DeviceState>) -> Result<Option<RestorePreview>, String> {
    let guard = state.device.lock().await;
    state.restore_cancel.store(false, std::sync::atomic::Ordering::Relaxed);
    *state.restore_plan.lock().await = None;
    let device = guard.as_ref().ok_or("Connect the destination device first")?;
    let Some(chosen) = rfd::AsyncFileDialog::new().set_title("Fieldwork — choose a verified backup to restore").pick_folder().await else { return Ok(None); };
    let folder = chosen.path().to_path_buf();
    let check = folder.clone();
    let cancel = state.restore_cancel.clone();
    let report = tauri::async_runtime::spawn_blocking(move || verify_folder_cancellable(&check, Some(&cancel))).await.map_err(|e| e.to_string())??;
    if report.kind != te::classify(&device.device_info().model, None) { return Err("Backup belongs to a different device family".into()); }
    let manifest = load_manifest(&folder)?;
    let storage_list = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storage_list.first().ok_or("No device storage")?;
    let (entries, required_bytes) = restore_entries(storage, &manifest, Some(&state.restore_cancel)).await?;
    check_cancel(Some(&state.restore_cancel))?;
    let token = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos().to_string();
    let prepared = PreparedRestore { token: token.clone(), folder: folder.clone(), generation: state.generation.load(std::sync::atomic::Ordering::SeqCst), manifest_hash: format!("{:x}", Sha256::digest(fs::read(folder.join(MANIFEST)).map_err(|e| e.to_string())?)) };
    *state.restore_plan.lock().await = Some(prepared);
    Ok(Some(RestorePreview { token, path: folder.display().to_string(), model: manifest.model, serial: manifest.serial, entries, required_bytes, free_bytes: storage.info().free_space_bytes }))
}

/// Additive recovery: conflicting content is never overwritten, and the full plan is rechecked before writes.
#[tauri::command]
pub async fn restore_backup(state: State<'_, DeviceState>, token: String) -> Result<RestoreResult, String> {
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("Connect the destination device first")?;
    let prepared = state.restore_plan.lock().await.take().ok_or("Preview the backup first")?;
    if token != prepared.token || state.generation.load(std::sync::atomic::Ordering::SeqCst) != prepared.generation { return Err("Device session changed. Preview the backup again.".into()); }
    let folder = prepared.folder;
    let check = folder.clone();
    tauri::async_runtime::spawn_blocking(move || verify_folder(&check)).await.map_err(|e| e.to_string())??;
    if format!("{:x}", Sha256::digest(fs::read(folder.join(MANIFEST)).map_err(|e| e.to_string())?)) != prepared.manifest_hash { return Err("Backup changed. Preview again.".into()); }
    let manifest = load_manifest(&folder)?;
    let storage_list = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storage_list.first().ok_or("No device storage")?;
    restore_to_storage(storage, &folder, &manifest).await
}

async fn restore_to_storage(storage: &Storage, folder: &Path, manifest: &Manifest) -> Result<RestoreResult, String> {
    let roots = manifest_roots(manifest)?;
    let (plan, required) = restore_entries(storage, manifest, None).await?;
    if plan.iter().any(|entry| entry.status == "conflict") { return Err("Restore blocked by conflicting files. Nothing was written.".into()); }
    if required > storage.info().free_space_bytes { return Err("Not enough device storage. Nothing was written.".into()); }
    let inventory = restore_inventory(storage, &roots).await?;
    let mut parents = std::collections::HashMap::new();
    let mut directories = manifest.directories.clone();
    directories.sort();
    for path in directories {
        let parent_path = path.rsplit_once('/').map(|(parent, _)| parent);
        let parent = match parent_path { Some(parent) => Some(*parents.get(parent).ok_or("Invalid backup directory hierarchy")?), None => None };
        let name = path.rsplit('/').next().ok_or("Invalid folder")?;
        let handle = match inventory.get(&path.to_lowercase()) {
            Some(object) => object.handle,
            None => storage.upload(parent, mtp_rs::mtp::NewObjectInfo::folder(name), futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>()).await.map_err(|e| format!("Restore incomplete creating {path}: {e}"))?,
        };
        parents.insert(path, handle);
    }
    let mut result = RestoreResult { copied: 0, skipped: 0, bytes: 0 };
    let mut files: Vec<_> = manifest.files.iter().collect();
    files.sort_by_key(|file| (file.path.starts_with("projects/"), file.path.ends_with("patch.json")));
    for file in files {
        if plan.iter().any(|entry| entry.path == file.path && entry.status == "identical") { result.skipped += 1; continue; }
        let (parent, name) = file.path.rsplit_once('/').ok_or("Invalid backup file hierarchy")?;
        let parent_handle = *parents.get(parent).ok_or("Missing backup parent folder")?;
        let input = File::open(checked_path(folder, &file.path, &roots)?).map_err(|e| e.to_string())?;
        let stream = futures::stream::try_unfold(input, |mut input| async move {
            let mut chunk = vec![0u8; 64 * 1024];
            let count = input.read(&mut chunk)?;
            chunk.truncate(count);
            Ok::<_, std::io::Error>(if count == 0 { None } else { Some((bytes::Bytes::from(chunk), input)) })
        });
        let handle = storage.upload(Some(parent_handle), mtp_rs::mtp::NewObjectInfo::file(name, file.size), Box::pin(stream)).await.map_err(|e| format!("Restore incomplete at {}: {e}. Existing files preserved; refresh and preview again before retrying.", file.path))?;
        if device_hash(storage, handle, None).await? != file.sha256 { return Err(format!("Restore verification failed: {}. The new file may be incomplete; existing files preserved.", file.path)); }
        result.copied += 1; result.bytes += file.size;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            Self::with_kind("op-xy")
        }
        fn with_kind(kind: &str) -> Self {
            static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let counter = NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/backup-tests").join(format!("{id}-{kind}-{}-{counter}", std::process::id()));
            fs::create_dir_all(&path).unwrap();
            let roots = te::backup_roots(kind);
            for root in roots { fs::create_dir(path.join(root)).unwrap(); }
            let (file_path, directories): (&str, Vec<String>) = if kind == "tp-7" {
                fs::create_dir_all(path.join("memo")).unwrap();
                ("memo/2026-02-23_112713_000.wav", vec!["recordings".into(), "memo".into()])
            } else {
                fs::create_dir_all(path.join("projects/user/Song.versions")).unwrap();
                ("projects/user/Song.versions/old.xy", vec!["projects".into(), "presets".into(), "samples".into(), "projects/user".into(), "projects/user/Song.versions".into()])
            };
            let sample = b"original project bytes";
            fs::write(path.join(file_path), sample).unwrap();
            let manifest = Manifest {
                format: "doxy-device-backup".into(), version: 1, created_unix: 0,
                model: "OP-XY".into(), serial: "test".into(), firmware: "1.1.33".into(), kind: kind.into(),
                directories,
                files: vec![BackupFile { path: file_path.into(), size: sample.len() as u64, sha256: format!("{:x}", Sha256::digest(sample)) }],
            };
            serde_json::to_writer(File::create(path.join(MANIFEST)).unwrap(), &manifest).unwrap();
            Self(path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); }
    }

    #[test]
    fn verifies_original_bytes_and_project_history() {
        let fixture = Fixture::new();
        let report = verify_folder(&fixture.0).unwrap();
        assert_eq!(report.files, 1);
        assert_eq!(report.bytes, 22);
        assert_eq!(report.kind, "op-xy");
    }

    #[test]
    fn cancels_local_restore_verification_before_reading_files() {
        let fixture = Fixture::new();
        let flag = std::sync::atomic::AtomicBool::new(true);
        assert!(verify_folder_cancellable(&fixture.0, Some(&flag)).unwrap_err().contains("cancelled"));
        assert!(verify_folder(&fixture.0).is_ok());
    }

    #[tokio::test]
    async fn cancels_restore_comparison_without_device_writes() {
        let fixture = Fixture::new();
        let device = virtual_device(&fixture.0, 1024 * 1024).await;
        let storages = device.storages().await.unwrap();
        let flag = std::sync::atomic::AtomicBool::new(true);
        let result = restore_entries(&storages[0], &load_manifest(&fixture.0).unwrap(), Some(&flag)).await;
        assert!(result.err().unwrap().contains("cancelled"));
        assert!(verify_folder(&fixture.0).is_ok());
    }

    async fn virtual_device(folder: &Path, capacity: u64) -> mtp_rs::mtp::MtpDevice {
        use mtp_rs::transport::virtual_device::config::{VirtualDeviceConfig, VirtualStorageConfig};
        mtp_rs::mtp::MtpDevice::builder().open_virtual(VirtualDeviceConfig {
            manufacturer: "teenage engineering".into(), model: "OP-XY".into(), serial: "virtual".into(),
            storages: vec![VirtualStorageConfig { description: "test".into(), capacity, backing_dir: folder.into(), read_only: false }],
            supports_rename: true, event_poll_interval: std::time::Duration::ZERO, watch_backing_dirs: false,
        }).await.unwrap()
    }

    #[tokio::test]
    async fn restores_missing_files_and_skips_verified_identical_files() {
        let source = Fixture::new();
        let destination = Fixture::new();
        let relative = "projects/user/Song.versions/old.xy";
        fs::remove_file(destination.0.join(relative)).unwrap();
        let device = virtual_device(&destination.0, 1024 * 1024).await;
        let storages = device.storages().await.unwrap();
        let manifest = load_manifest(&source.0).unwrap();
        let report = restore_to_storage(&storages[0], &source.0, &manifest).await.unwrap();
        assert_eq!(report.copied, 1);
        assert_eq!(fs::read(destination.0.join(relative)).unwrap(), b"original project bytes");
        let report = restore_to_storage(&storages[0], &source.0, &manifest).await.unwrap();
        assert_eq!(report.copied, 0);
        assert_eq!(report.skipped, 1);
    }

    #[tokio::test]
    async fn restore_conflict_blocks_every_write_and_preserves_destination() {
        let source = Fixture::new();
        let destination = Fixture::new();
        let relative = "projects/user/Song.versions/old.xy";
        fs::write(destination.0.join(relative), b"new music").unwrap();
        let device = virtual_device(&destination.0, 1024 * 1024).await;
        let storages = device.storages().await.unwrap();
        let error = restore_to_storage(&storages[0], &source.0, &load_manifest(&source.0).unwrap()).await.err().unwrap();
        assert!(error.contains("conflicting"));
        assert_eq!(fs::read(destination.0.join(relative)).unwrap(), b"new music");
    }

    #[tokio::test]
    async fn restore_checks_free_space_before_writing() {
        let source = Fixture::new();
        let destination = Fixture::new();
        let relative = "projects/user/Song.versions/old.xy";
        fs::remove_file(destination.0.join(relative)).unwrap();
        let device = virtual_device(&destination.0, 1).await;
        let storages = device.storages().await.unwrap();
        assert!(restore_to_storage(&storages[0], &source.0, &load_manifest(&source.0).unwrap()).await.err().unwrap().contains("Not enough"));
        assert!(!destination.0.join(relative).exists());
    }

    #[test]
    fn export_rejects_absolute_and_symlink_paths() {
        let fixture = Fixture::new();
        assert!(safe_join(&fixture.0, "/absolute.wav").is_err());
        assert!(safe_join(&fixture.0, "samples//file.wav").is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(fixture.0.join("samples"), fixture.0.join("link")).unwrap();
            assert!(safe_join(&fixture.0, "link/new.wav").is_err());
        }
    }

    #[test]
    fn verifies_tp7_snapshots_with_their_own_roots() {
        let fixture = Fixture::with_kind("tp-7");
        let report = verify_folder(&fixture.0).unwrap();
        assert_eq!(report.kind, "tp-7");
        fs::remove_dir(fixture.0.join("recordings")).unwrap();
        assert!(verify_folder(&fixture.0).is_err(), "a missing library root is a failed verification");
    }

    #[test]
    fn treats_manifests_without_a_kind_as_op_xy() {
        let fixture = Fixture::new();
        let mut manifest: serde_json::Value = serde_json::from_reader(File::open(fixture.0.join(MANIFEST)).unwrap()).unwrap();
        manifest.as_object_mut().unwrap().remove("kind");
        serde_json::to_writer(File::create(fixture.0.join(MANIFEST)).unwrap(), &manifest).unwrap();
        assert_eq!(verify_folder(&fixture.0).unwrap().kind, "op-xy");
    }

    /// Restore is a write path, and the README calls it "additive recovery".
    ///
    /// `main.rs` has a test asserting that every write path there refuses to replace what is
    /// already on the device. That test named four commands and this one was missing from
    /// it — restoring writes to the instrument just as sending does, and it lives in this
    /// file rather than `main.rs`, which is exactly how it escaped the audit. So the same
    /// rule is enforced here.
    ///
    /// Restore is in fact the most heavily guarded of the five. It requires a token that
    /// matches the preview, refuses when the device session generation has changed, refuses
    /// when the backup's own manifest has changed since the preview, **refuses the whole
    /// operation if any single file conflicts**, checks free space before writing, and skips
    /// files already byte-identical. "Additive" is not a policy applied afterwards; a
    /// conflict stops everything before the first byte.
    #[test]
    fn restoring_never_replaces_what_is_already_on_the_device() {
        let source = include_str!("backup.rs");
        // The restore path is two functions: the command checks the token, the session and
        // the manifest, then hands off to `restore_to_storage`, which owns the conflict and
        // space refusals. Slicing only the command missed those — which is the same shape of
        // mistake as the audit in `main.rs` missing this file entirely, so take both.
        let start = source.find("pub async fn restore_backup(").expect("restore_backup is gone; this test must follow it");
        let helper = source.find("async fn restore_to_storage(").expect("restore_to_storage is gone; this test must follow it");
        let after_helper = &source[helper..];
        let helper_end = helper + after_helper[1..].find("\nasync fn ").map(|i| i + 1)
            .or_else(|| after_helper[1..].find("\npub async fn ").map(|i| i + 1))
            .unwrap_or(after_helper.len().min(6000));
        let body = format!("{}{}", &source[start..helper], &source[helper..helper_end]);
        let body = body.as_str();

        for (needle, why) in [
            ("Restore blocked by conflicting files", "a conflicting file must stop the whole restore"),
            ("Nothing was written", "a refusal must say that nothing was written"),
            ("Device session changed", "a reconnect must invalidate the preview"),
            ("Backup changed", "a backup edited after the preview must be refused"),
            ("Not enough device storage", "a restore that cannot fit must be refused before writing"),
            ("\"identical\"", "files already identical must be skipped rather than rewritten"),
        ] {
            assert!(body.contains(needle), "{why} — {needle:?} is no longer in restore_backup");
        }

        // And it must not reach for the operations this app disables anywhere.
        for forbidden in [".delete(", ".rename(", "delete_object", "rename_object"] {
            assert!(!body.contains(forbidden), "restore_backup uses {forbidden}, which this app does not do");
        }
    }

    /// Task 1 of `docs/companion-app-comparison.md` names a *single* corrupted byte,
    /// so flip exactly one bit of one byte and leave the length identical. A checker
    /// that compared only sizes, or hashed lazily when the size matched, would pass
    /// the old version of this test and fail here.
    #[test]
    fn rejects_corruption_even_when_length_matches() {
        let fixture = Fixture::new();
        let file = fixture.0.join("projects/user/Song.versions/old.xy");
        let mut bytes = fs::read(&file).unwrap();
        let before = bytes.len();
        // One bit, in the middle, where a truncation check would not look.
        bytes[before / 2] ^= 0x01;
        fs::write(&file, &bytes).unwrap();
        assert_eq!(fs::read(&file).unwrap().len(), before, "the length must be unchanged for this to test content");
        let failure = verify_folder(&fixture.0).unwrap_err();
        assert!(failure.contains("verification failed"), "{failure}");
        // And it names the file, so the user knows which one to replace.
        assert!(failure.contains("old.xy"), "the failure should name the file: {failure}");
    }

    #[test]
    fn rejects_missing_and_untracked_files() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("samples/extra.wav"), b"extra").unwrap();
        assert!(verify_folder(&fixture.0).unwrap_err().contains("Untracked"));
        fs::remove_file(fixture.0.join("samples/extra.wav")).unwrap();
        fs::remove_file(fixture.0.join("projects/user/Song.versions/old.xy")).unwrap();
        assert!(verify_folder(&fixture.0).is_err());
    }

    #[test]
    fn rejects_path_traversal_and_keeps_unicode() {
        for path in ["../outside", "/samples/x", "samples/../x", "samples//x", "samples/a\\b", "samples/C:x", "recordings/take.wav"] {
            assert!(!valid_path(path, &DEFAULT_ROOTS), "{path}");
        }
        assert!(valid_path("samples/user/Été/鐘.wav", &DEFAULT_ROOTS));
        assert!(valid_path("recordings/take.wav", te::backup_roots("tp-7")));
    }

    #[test]
    fn joins_export_paths_safely() {
        let root = Path::new("/tmp/export");
        assert_eq!(safe_join(root, "recordings/take.wav").unwrap(), root.join("recordings").join("take.wav"));
        assert_eq!(safe_join(root, "tape 1/track_1.aif").unwrap(), root.join("tape 1").join("track_1.aif"));
        for bad in ["", "../take.wav", "a/../b", "a\\..\\b", "a:b", "\u{0}"] {
            assert!(safe_join(root, bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn write_new_file_refuses_to_overwrite() {
        let fixture = Fixture::new();
        let target = fixture.0.join("samples/new/mix.wav");
        assert!(write_new_file(&target, b"one").is_ok());
        assert!(write_new_file(&target, b"two").unwrap_err().contains("already exists"));
        assert_eq!(fs::read(&target).unwrap(), b"one");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlinked_content() {
        let fixture = Fixture::new();
        let target = fixture.0.join("projects/user/Song.versions/old.xy");
        fs::remove_file(&target).unwrap();
        std::os::unix::fs::symlink(fixture.0.join(MANIFEST), target).unwrap();
        assert!(verify_folder(&fixture.0).unwrap_err().contains("symbolic link"));
    }
}
