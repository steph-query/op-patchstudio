use mtp_rs::mtp::{MtpDevice, NewObjectInfo, Storage};
use mtp_rs::ptp::{DateTime, ObjectHandle, ObjectInfo};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::PathBuf;
use tauri::State;
use tokio::sync::Mutex;
mod backup;
mod catalog;
mod localaudio;
mod stems;
mod te;

struct DeviceState {
    device: Mutex<Option<MtpDevice>>,
    generation: std::sync::atomic::AtomicU64,
    restore_plan: Mutex<Option<backup::PreparedRestore>>,
    restore_cancel: std::sync::Arc<std::sync::atomic::AtomicBool>,
    /// Folders the user picked through a native dialog: the only places app-generated files may be written.
    approved_folders: std::sync::Mutex<HashSet<PathBuf>>,
    /// Root of the local capture library, once opened.
    library: std::sync::Mutex<Option<PathBuf>>,
    /// The one send the user has reviewed, consumed when it is written.
    prepared_send: std::sync::Mutex<Option<PreparedSend>>,
    /// The one partly-written folder the user has inspected, consumed when completed.
    prepared_completion: std::sync::Mutex<Option<PreparedSend>>,
}

#[derive(Serialize, Clone)]
struct DeviceInfo {
    manufacturer: String,
    model: String,
    serial: String,
    connected: bool,
    firmware: String,
    /// Device family recognised from the model string: op-xy, op-1-field, tp-7 or unknown.
    kind: String,
    supports_rename: bool,
}

#[derive(Serialize, Clone)]
struct StorageEntry {
    description: String,
    free_space: u64,
    capacity: u64,
}

#[derive(Serialize, Clone)]
struct FileEntry {
    handle: u32,
    name: String,
    is_directory: bool,
    size: u64,
}

#[tauri::command]
async fn mtp_list_available() -> Result<Vec<te::AvailableDevice>, String> {
    tauri::async_runtime::spawn_blocking(te::list_available).await.map_err(|e| e.to_string())?
}

/// Ask a TP-7 in audio/MIDI mode to re-enumerate as an MTP device. The caller polls `mtp_list_available` afterwards.
#[tauri::command]
async fn tp7_switch_to_mtp() -> Result<te::Tp7SwitchReport, String> {
    tauri::async_runtime::spawn_blocking(te::switch_tp7_to_mtp).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn mtp_connect(state: State<'_, DeviceState>, location_id: Option<String>) -> Result<DeviceInfo, String> {
    let mut guard = state.device.lock().await;
    if guard.is_some() { return Err("Disconnect the current device first".into()); }
    // Parsed from a string rather than taken as a u64; see `te::AvailableDevice::location_id`.
    let location = location_id
        .as_deref()
        .and_then(|id| id.parse::<u64>().ok())
        .filter(|id| *id != 0)
        .ok_or("Select a device before connecting")?;
    let opened = MtpDevice::open_by_location(location).await;
    let device = opened.map_err(|e| {
        format!("Failed to connect: {}. Put the device in MTP mode, close Field Kit and other transfer apps, then reconnect USB.", e)
    })?;

    let info = device.device_info();
    let result = DeviceInfo {
        manufacturer: info.manufacturer.clone(),
        model: info.model.clone(),
        serial: info.serial_number.clone(),
        connected: true,
        firmware: info.device_version.clone(),
        kind: te::classify(&info.model, None).into(),
        supports_rename: device.supports_rename(),
    };

    if result.kind == "unknown" { return Err("This device model is not supported. No device session was opened.".into()); }
    *guard = Some(device);
    state.generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);

    Ok(result)
}

#[tauri::command]
async fn mtp_disconnect(state: State<'_, DeviceState>) -> Result<(), String> {
    let mut guard = state.device.lock().await;
    *guard = None;
    state.generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[tauri::command]
async fn mtp_list_storages(state: State<'_, DeviceState>) -> Result<Vec<StorageEntry>, String> {
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;

    let storages = device.storages().await.map_err(|e| e.to_string())?;
    Ok(storages
        .iter()
        .map(|s| {
            let info = s.info();
            StorageEntry {
                description: info.description.clone(),
                free_space: info.free_space_bytes,
                capacity: info.max_capacity,
            }
        })
        .collect())
}

#[tauri::command]
async fn mtp_list_directory(
    state: State<'_, DeviceState>,
    parent_handle: Option<u32>,
) -> Result<Vec<FileEntry>, String> {
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;

    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found on device")?;

    let parent = parent_handle.map(ObjectHandle);
    let objects = storage
        .list_objects(parent)
        .await
        .map_err(|e| e.to_string())?;

    Ok(objects
        .iter()
        .map(|obj| FileEntry {
            handle: obj.handle.0,
            name: obj.filename.clone(),
            is_directory: obj.is_folder(),
            size: obj.size,
        })
        .collect())
}

fn raw_response(data: Vec<u8>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(tauri::ipc::InvokeResponseBody::Raw(data))
}

/// Whole-file download returned as raw bytes (an ArrayBuffer on the JavaScript side).
#[tauri::command]
async fn mtp_read_file(state: State<'_, DeviceState>, handle: u32) -> Result<tauri::ipc::Response, String> {
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;

    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let mut stream = storage.download_stream(ObjectHandle(handle)).await.map_err(|e| e.to_string())?;
    let mut data = Vec::new();
    while let Some(chunk) = stream.next_chunk().await {
        let chunk = match chunk { Ok(chunk) => chunk, Err(error) => { let _ = stream.cancel(std::time::Duration::from_secs(2)).await; return Err(error.to_string()); } };
        if data.len() + chunk.len() > 128 * 1024 * 1024 {
            let _ = stream.cancel(std::time::Duration::from_secs(2)).await;
            return Err("File exceeds the 128 MB editor limit. Export the original file to disk instead.".into());
        }
        data.extend_from_slice(&chunk);
    }
    Ok(raw_response(data))
}

/// Byte-range download used to inspect audio headers without pulling whole recordings.
/// Unsupported partial reads return an error; never download a whole long recording as fallback.
#[tauri::command]
async fn mtp_read_partial(state: State<'_, DeviceState>, handle: u32, offset: u64, size: u32) -> Result<tauri::ipc::Response, String> {
    if size > 32 * 1024 * 1024 { return Err("Preview request exceeds 32 MB".into()); }
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let data = match storage.download_partial(ObjectHandle(handle), offset, size).await {
        Ok(data) => data,
        Err(error) => return Err(format!("Device does not support this partial read: {error}. Export the original file to preview on your Mac.")),
    };
    Ok(raw_response(data))
}


#[tauri::command]
async fn mtp_delete(state: State<'_, DeviceState>, handles: Vec<u32>) -> Result<DeleteOutcome, String> {
    if handles.is_empty() {
        return Err("Nothing was selected to delete.".into());
    }
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let mut outcome = DeleteOutcome::default();
    for handle in handles {
        let object = ObjectHandle(handle);
        // Read first: the name is what the report can say, and a handle that no longer
        // resolves means the file is already gone rather than that deleting it failed.
        let info = match storage.get_object_info(object).await {
            Ok(info) => info,
            Err(_) => { outcome.already_gone += 1; continue; }
        };
        if info.is_folder() {
            // A folder delete is a recursive delete wearing a single confirmation, and
            // the user approved a list of files. Refused rather than guessed at.
            outcome.failed.push(DeleteFailure { name: info.filename.clone(), error: "Folders are not deleted here; choose the files inside it.".into() });
            continue;
        }
        match storage.delete(object).await {
            Ok(()) => {
                // Verified, not assumed. A firmware that accepts the command and keeps
                // the file would otherwise leave the list claiming it had gone.
                match storage.get_object_info(object).await {
                    Ok(still_there) if still_there.filename == info.filename => outcome.failed.push(DeleteFailure {
                        name: info.filename.clone(),
                        error: "The device still reports this file. Nothing was removed.".into(),
                    }),
                    _ => { outcome.deleted_bytes += info.size; outcome.deleted.push(info.filename.clone()); }
                }
            }
            Err(error) => outcome.failed.push(DeleteFailure { name: info.filename.clone(), error: error.to_string() }),
        }
    }
    Ok(outcome)
}

#[derive(Serialize, Default, Clone)]
struct DeleteFailure {
    name: String,
    error: String,
}

/// What a delete actually did, per file, rather than one overall success flag.
#[derive(Serialize, Default, Clone)]
struct DeleteOutcome {
    deleted: Vec<String>,
    deleted_bytes: u64,
    /// Handles that no longer resolved — already removed, or the list was stale.
    already_gone: usize,
    failed: Vec<DeleteFailure>,
}

fn validate_filename(name: &str) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() || name == "." || name == ".." || name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c)) {
        return Err("Use a name without path separators or reserved characters".into());
    }
    Ok(())
}

/// Whether a rename keeps the file loadable by the instrument that wrote it.
///
/// Renaming was refused outright until the owner asked for it on a TP-7, where a recording
/// is named after the moment it was made and nothing points at it. Two cases genuinely do
/// break, and they are refused here rather than in the interface, because the native layer
/// is the boundary that cannot be bypassed:
///
/// - **An OP-1 field tape track.** `track_1.aif` … `track_4.aif` *is* the reference — the
///   number in the name is the track number. Renaming one silently removes it from the tape.
/// - **An extension change.** The instruments dispatch on it, so `.wav` → `.txt` makes a
///   file the device will no longer read.
///
/// An OP-XY sample is the harder call and is **allowed**: projects reference samples by
/// path, so renaming one can orphan a reference — but the sample-usage sweep exists to
/// answer which projects use a file, and refusing outright is what sent people to Finder
/// to do the same thing with no check at all. The frontend names the risk before asking.
fn check_rename(current: &str, proposed: &str) -> Result<(), String> {
    let extension = |name: &str| name.rsplit_once('.').map(|(_, ext)| ext.to_lowercase());
    if extension(current) != extension(proposed) {
        return Err(format!(
            "Keep the .{} ending: the instrument decides how to read a file from it.",
            extension(current).unwrap_or_default()
        ));
    }
    // `track_3.aif` and friends: the number is the track, so the name is not free text.
    let stem = current.rsplit_once('.').map(|(stem, _)| stem).unwrap_or(current).to_lowercase();
    if stem.starts_with("track_") && stem[6..].chars().all(|c| c.is_ascii_digit()) && !stem[6..].is_empty() {
        return Err(format!(
            "{current} is a tape track, and the number in its name is how the field finds it. Renaming it would take it off the tape."
        ));
    }
    Ok(())
}

/// Rename a file on the device, in place.
///
/// Verified rather than assumed: the object is read back and the new name confirmed, so a
/// firmware that accepts the command and ignores it is reported as a failure instead of
/// leaving the interface showing a name the device does not have.
#[tauri::command]
async fn mtp_rename(state: State<'_, DeviceState>, handle: u32, new_name: String) -> Result<String, String> {
    let proposed = new_name.trim().to_string();
    validate_filename(&proposed)?;

    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    if !device.supports_rename() {
        return Err("This device's firmware does not support renaming over USB.".into());
    }
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let target = storage.get_object_info(ObjectHandle(handle)).await.map_err(|e| e.to_string())?;
    if target.is_folder() {
        return Err("Only files can be renamed here.".into());
    }
    if target.filename == proposed {
        return Ok(proposed);
    }
    check_rename(&target.filename, &proposed)?;

    // Nothing is ever replaced: a name already in use is refused before the write, not
    // discovered afterwards by the file that used to be there being gone.
    // `parent` is 0 for an object sitting at the storage root, which `list_objects`
    // spells as `None`.
    let parent = if target.parent.0 == 0 { None } else { Some(target.parent) };
    let siblings = storage.list_objects(parent).await.map_err(|e| e.to_string())?;
    if siblings.iter().any(|object| object.handle != target.handle && object.filename.eq_ignore_ascii_case(&proposed)) {
        return Err(format!("{proposed} is already in that folder. Choose another name."));
    }

    storage.rename(ObjectHandle(handle), &proposed).await.map_err(|e| e.to_string())?;
    let confirmed = storage.get_object_info(ObjectHandle(handle)).await.map_err(|e| format!("Renamed, but the result could not be read back: {e}"))?;
    if confirmed.filename != proposed {
        return Err(format!("The device still calls this file {}. Nothing was changed.", confirmed.filename));
    }
    Ok(confirmed.filename)
}

#[derive(Serialize, Clone)]
struct TreeEntry {
    /// Path including the root folder as it is named on the device.
    path: String,
    handle: u32,
    parent_handle: u32,
    is_directory: bool,
    size: u64,
    modified: Option<String>,
}

#[derive(Serialize)]
struct RootMatch {
    requested: String,
    actual: String,
    handle: u32,
}

#[derive(Serialize)]
struct TreeScan {
    entries: Vec<TreeEntry>,
    missing_roots: Vec<String>,
    roots: Vec<RootMatch>,
}

fn format_datetime(value: &DateTime) -> String {
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
        value.year, value.month, value.day, value.hour, value.minute, value.second
    )
}

/// Enumerate whole library folders. Root names are matched case-insensitively because devices differ.
#[tauri::command]
async fn mtp_scan_tree(state: State<'_, DeviceState>, roots: Vec<String>) -> Result<TreeScan, String> {
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let root_objects = storage.list_objects(None).await.map_err(|e| e.to_string())?;
    let mut scan = TreeScan { entries: Vec::new(), missing_roots: Vec::new(), roots: Vec::new() };
    for requested in roots {
        let Some(folder) = root_objects.iter().find(|o| o.is_folder() && o.filename.eq_ignore_ascii_case(&requested)) else {
            scan.missing_roots.push(requested);
            continue;
        };
        scan.roots.push(RootMatch { requested: requested.clone(), actual: folder.filename.clone(), handle: folder.handle.0 });
        for (relative, object) in walk_objects(storage, folder.handle).await? {
            scan.entries.push(TreeEntry {
                path: format!("{}/{}", folder.filename, relative),
                handle: object.handle.0,
                parent_handle: object.parent.0,
                is_directory: object.is_folder(),
                size: object.size,
                modified: object.modified.as_ref().map(format_datetime),
            });
        }
    }
    Ok(scan)
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(value) = u8::from_str_radix(std::str::from_utf8(&bytes[index + 1..index + 3]).unwrap_or("zz"), 16) {
                out.push(value);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn header_value(request: &tauri::ipc::Request<'_>, name: &str) -> Option<String> {
    request.headers().get(name).and_then(|value| value.to_str().ok()).map(percent_decode)
}

fn raw_body(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(_) => Err("Expected raw file bytes".into()),
    }
}

/// Upload one file into a folder path such as drum/user. The bytes arrive as the raw IPC body;
/// `x-doxy-path`, `x-doxy-filename` and `x-doxy-create` headers carry the metadata.
/// The upload is read back and compared before success is reported.
#[tauri::command]
async fn mtp_upload_at_path(state: State<'_, DeviceState>, request: tauri::ipc::Request<'_>) -> Result<u32, String> {
    let path = header_value(&request, "x-doxy-path").unwrap_or_default();
    let filename = header_value(&request, "x-doxy-filename").ok_or("Missing file name")?;
    let create_missing = header_value(&request, "x-doxy-create").as_deref() == Some("1");
    validate_filename(&filename)?;
    let data = raw_body(&request)?;

    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let mut parent: Option<ObjectHandle> = None;
    for segment in path.split('/').filter(|segment| !segment.is_empty()) {
        validate_filename(segment)?;
        parent = Some(match find_child_folder_ci(storage, parent, segment).await? {
            Some(folder) => folder.handle,
            None if create_missing => {
                let stream = futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>();
                storage.upload(parent, NewObjectInfo::folder(segment), stream).await.map_err(|e| format!("Could not create folder {segment}: {e}"))?
            }
            None => return Err(format!("Folder {path} does not exist on the device")),
        });
    }
    let siblings = storage.list_objects(parent).await.map_err(|e| e.to_string())?;
    if siblings.iter().any(|object| object.filename.eq_ignore_ascii_case(filename.trim())) {
        // Not "rename or delete it first": this app disables both, so that advice
        // asked the user for something it refuses to do. Send it under another name —
        // which the install plan does automatically on a collision — or remove the
        // existing file with whatever transfer tool they use for that.
        return Err(format!(
            "{} is already in {}. Send it under a different name — a write never replaces what is already on the device. To remove the existing file, do it from the device's own file list first.",
            filename.trim(),
            if path.is_empty() { "the root folder" } else { path.as_str() }
        ));
    }
    if (data.len() as u64) > storage.info().free_space_bytes {
        return Err("Not enough free space on the device".into());
    }
    let info = NewObjectInfo::file(filename.trim(), data.len() as u64);
    let stream = futures::stream::iter(vec![Ok::<_, std::io::Error>(bytes::Bytes::from(data.clone()))]);
    let handle = storage.upload(parent, info, stream).await.map_err(|e| e.to_string())?;
    let verified = storage.download(handle).await.map_err(|e| format!("Upload could not be verified: {e}"))?;
    if verified != data {
        return Err("Upload verification failed; the file on the device may be incomplete".into());
    }
    Ok(handle.0)
}

#[derive(Deserialize)]
struct ExportRequest {
    handle: u32,
    relative_path: String,
    size: u64,
}

#[derive(Serialize)]
struct ExportFailure {
    path: String,
    error: String,
}

#[derive(Serialize)]
struct ExportResult {
    path: String,
    copied: usize,
    skipped: usize,
    bytes: u64,
    failed: Vec<ExportFailure>,
}

/// Stream device files into a folder the user picks. Existing files are skipped, never overwritten.
#[tauri::command]
async fn export_device_files(state: State<'_, DeviceState>, files: Vec<ExportRequest>) -> Result<Option<ExportResult>, String> {
    if files.is_empty() {
        return Err("Nothing selected to export".into());
    }
    let guard = state.device.lock().await;
    let Some(folder) = rfd::AsyncFileDialog::new().set_title("Choose where to save the files").pick_folder().await else { return Ok(None); };
    let root = folder.path().to_path_buf();
    state.approved_folders.lock().map_err(|_| "Folder registry unavailable")?.insert(root.clone());

    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let mut result = ExportResult { path: root.display().to_string(), copied: 0, skipped: 0, bytes: 0, failed: Vec::new() };
    for file in files {
        let target = match backup::safe_join(&root, &file.relative_path) {
            Ok(target) => target,
            Err(error) => { result.failed.push(ExportFailure { path: file.relative_path, error }); continue; }
        };
        if target.exists() {
            result.skipped += 1;
            continue;
        }
        if let Some(parent) = target.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                result.failed.push(ExportFailure { path: file.relative_path, error: error.to_string() });
                continue;
            }
        }
        match backup::stream_object_to_file(storage, ObjectHandle(file.handle), &target, Some(file.size)).await {
            Ok((size, _)) => { result.copied += 1; result.bytes += size; }
            Err(error) => result.failed.push(ExportFailure { path: file.relative_path, error }),
        }
    }
    Ok(Some(result))
}

#[derive(Serialize)]
struct SaveResult {
    path: String,
    files: usize,
}

/// Remember a folder chosen by the user so later saves can go there without another dialog.
#[tauri::command]
async fn pick_folder(state: State<'_, DeviceState>, title: String) -> Result<Option<String>, String> {
    let Some(folder) = rfd::AsyncFileDialog::new().set_title(&title).pick_folder().await else { return Ok(None); };
    let path = folder.path().to_path_buf();
    state.approved_folders.lock().map_err(|_| "Folder registry unavailable")?.insert(path.clone());
    Ok(Some(path.display().to_string()))
}

/// Save app-generated bytes (stems, mixdowns, kits) into a folder the user chose. Never overwrites.
#[tauri::command]
async fn save_file_to_folder(state: State<'_, DeviceState>, request: tauri::ipc::Request<'_>) -> Result<Option<SaveResult>, String> {
    let relative = header_value(&request, "x-doxy-path").ok_or("Missing destination file name")?;
    let folder_header = header_value(&request, "x-doxy-folder");
    let data = raw_body(&request)?;
    let root = match folder_header {
        Some(folder) => {
            let path = PathBuf::from(folder);
            let approved = state.approved_folders.lock().map_err(|_| "Folder registry unavailable")?.contains(&path);
            if !approved {
                return Err("Choose a destination folder first".into());
            }
            path
        }
        None => {
            let Some(folder) = rfd::AsyncFileDialog::new().set_title("Choose where to save").pick_folder().await else { return Ok(None); };
            let path = folder.path().to_path_buf();
            state.approved_folders.lock().map_err(|_| "Folder registry unavailable")?.insert(path.clone());
            path
        }
    };
    let target = backup::safe_join(&root, &relative)?;
    let written = tauri::async_runtime::spawn_blocking(move || backup::write_new_file(&target, &data))
        .await
        .map_err(|e| e.to_string())??;
    Ok(Some(SaveResult { path: written, files: 1 }))
}

struct PresetFile {
    name: String,
    data: bytes::Bytes,
}

fn decode_preset_files(data: Vec<u8>, metadata: &str) -> Result<Vec<PresetFile>, String> {
    #[derive(Deserialize)]
    struct FileSpec { name: String, size: usize }
    if data.len() > 128 * 1024 * 1024 || metadata.len() > 64 * 1024 { return Err("Preset exceeds send limits".into()); }
    let specs: Vec<FileSpec> = serde_json::from_str(metadata).map_err(|e| format!("Invalid preset file list: {e}"))?;
    if specs.is_empty() || specs.len() > 256 { return Err("Invalid number of preset files".into()); }
    let data = bytes::Bytes::from(data);
    let mut offset = 0usize;
    let mut files = Vec::new();
    for spec in specs {
        let end = offset.checked_add(spec.size).ok_or("Preset size overflow")?;
        if end > data.len() { return Err("Truncated preset upload".into()); }
        files.push(PresetFile { name: spec.name, data: data.slice(offset..end) });
        offset = end;
    }
    if offset != data.len() { return Err("Unexpected trailing preset bytes".into()); }
    Ok(files)
}


/// A send the user reviewed, bound to the device and session it was reviewed against.
#[derive(Clone, Debug, PartialEq)]
struct PreparedSend {
    token: String,
    serial: String,
    generation: u64,
    category: String,
    preset_name: String,
    /// Names and sizes of the files as reviewed.
    digest: String,
    bytes: u64,
}

#[derive(Deserialize)]
struct PresetFileMeta {
    name: String,
    size: u64,
}

#[derive(Serialize)]
struct SendPlan {
    token: String,
    device_model: String,
    device_serial: String,
    destination: String,
    files: usize,
    bytes: u64,
    free_space: u64,
    /// True when the category folder does not exist yet and will be created.
    creates_category: bool,
}

/// Fingerprint of what was reviewed: file names and sizes, in order.
fn manifest_digest<'a>(files: impl Iterator<Item = (&'a str, u64)>) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    for (name, size) in files {
        hasher.update(name.as_bytes());
        hasher.update(b":");
        hasher.update(size.to_string().as_bytes());
        hasher.update(b"\n");
    }
    format!("{:x}", hasher.finalize())
}

/// Refuse a write whose reviewed plan no longer describes what is about to happen.
/// Pure so the rules can be tested without a device.
fn check_plan(
    plan: &PreparedSend,
    token: &str,
    serial: &str,
    generation: u64,
    category: &str,
    preset_name: &str,
    digest: &str,
) -> Result<(), String> {
    if plan.token != token {
        return Err("This send does not match the reviewed plan. Review it again.".into());
    }
    if plan.generation != generation {
        return Err("The device was reconnected after the review, so the plan is out of date. Review the send again.".into());
    }
    if plan.serial != serial {
        return Err("A different device is connected than the one reviewed. Nothing was written. Review the send against this device.".into());
    }
    if plan.category != category || plan.preset_name != preset_name {
        return Err("The destination changed after the review. Review the send again.".into());
    }
    if plan.digest != digest {
        return Err("The preset changed after it was reviewed. Review it again so you can see what will be written.".into());
    }
    Ok(())
}

/// Check everything a send needs before anything is written, and remember the result.
/// Read-only: no folder is created and no file is touched here.
#[tauri::command]
async fn preflight_preset_send(
    state: State<'_, DeviceState>,
    category: String,
    preset_name: String,
    files: Vec<PresetFileMeta>,
) -> Result<SendPlan, String> {
    validate_filename(&category)?;
    validate_filename(&preset_name)?;
    if files.is_empty() || files.len() > 256 {
        return Err("A preset needs between one and 256 files.".into());
    }
    let mut names = HashSet::new();
    let mut bytes = 0u64;
    for file in &files {
        validate_filename(&file.name)?;
        if !names.insert(file.name.to_lowercase()) {
            return Err("Two files in this preset have the same name.".into());
        }
        bytes = bytes.checked_add(file.size).ok_or("Preset too large")?;
    }
    if !files.iter().any(|file| file.name == "patch.json") {
        return Err("This preset has no patch.json, so the device would not read it.".into());
    }

    let generation = state.generation.load(std::sync::atomic::Ordering::SeqCst);
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let info = device.device_info();
    if te::classify(&info.model, None) != "op-xy" {
        return Err("Preset sends are supported only on OP-XY.".into());
    }
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let free_space = storage.info().free_space_bytes;
    if bytes > free_space {
        return Err(format!("This preset needs {bytes} bytes and the device has {free_space} free."));
    }
    let root = find_child_folder_ci(storage, None, "presets").await?.ok_or("The device has no presets folder; nothing was written.")?;
    let category_folder = find_child_folder_ci(storage, Some(root.handle), &category).await?;
    let folder_name = format!("{}.preset", preset_name.trim());
    if let Some(folder) = &category_folder {
        let siblings = storage.list_objects(Some(folder.handle)).await.map_err(|e| e.to_string())?;
        if siblings.iter().any(|object| object.filename.eq_ignore_ascii_case(&folder_name)) {
            return Err(format!("presets/{category}/{folder_name} already exists. Choose a new name; existing content is never replaced."));
        }
    }

    let digest = manifest_digest(files.iter().map(|file| (file.name.as_str(), file.size)));
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    let token = manifest_digest(
        [
            (info.serial_number.as_str(), generation),
            (category.as_str(), bytes),
            (preset_name.as_str(), files.len() as u64),
            (digest.as_str(), now.as_nanos() as u64),
        ]
        .into_iter(),
    );
    let plan = PreparedSend {
        token: token.clone(),
        serial: info.serial_number.clone(),
        generation,
        category: category.clone(),
        preset_name: preset_name.clone(),
        digest,
        bytes,
    };
    *state.prepared_send.lock().map_err(|_| "Plan registry unavailable")? = Some(plan);

    Ok(SendPlan {
        token,
        device_model: info.model.clone(),
        device_serial: info.serial_number.clone(),
        destination: format!("presets/{category}/{folder_name}"),
        files: files.len(),
        bytes,
        free_space,
        creates_category: category_folder.is_none(),
    })
}


#[derive(Serialize, Debug, PartialEq)]
struct ReconcileFile {
    name: String,
    /// "identical", "different", or "absent".
    status: String,
    device_bytes: Option<u64>,
}

#[derive(Serialize)]
struct ReconcileReport {
    destination: String,
    folder_exists: bool,
    files: Vec<ReconcileFile>,
    /// Files in that folder that this preset does not describe.
    extra: Vec<String>,
    identical: usize,
    different: usize,
    absent: usize,
    /// "nothing on the device", "already complete", "can complete", or "blocked".
    verdict: String,
    /// Why, in the user's words.
    explanation: String,
    /// Present only when the missing files can be written; authorises exactly that.
    token: Option<String>,
}

/// What a retry may safely do. Pure so the rules are testable without a device.
fn reconcile_verdict(folder_exists: bool, identical: usize, different: usize, absent: usize, extra: usize) -> (&'static str, String) {
    if !folder_exists {
        return ("nothing on the device", "Nothing of this preset is on the device, so sending it is a fresh write.".into());
    }
    if different > 0 || extra > 0 {
        let mut reasons = Vec::new();
        if different > 0 { reasons.push(format!("{different} file(s) on the device differ from this preset")); }
        if extra > 0 { reasons.push(format!("{extra} file(s) in that folder are not part of this preset")); }
        return (
            "blocked",
            format!(
                "{}. Nothing will be changed. Inspect that folder with your usual transfer tool, or send under a new name.",
                reasons.join(", and ")
            ),
        );
    }
    if absent == 0 {
        return ("already complete", format!("All {identical} file(s) are already on the device and match this preset byte for byte. There is nothing to send."));
    }
    ("can complete", format!("{identical} file(s) already match and {absent} are missing. Only the missing files would be written; nothing existing is touched."))
}

/// Compare a preset against what is actually in its folder on the device.
/// Read-only: this command writes nothing, ever.
#[tauri::command]
async fn reconcile_preset_send(state: State<'_, DeviceState>, request: tauri::ipc::Request<'_>) -> Result<ReconcileReport, String> {
    let category = header_value(&request, "x-doxy-category").ok_or("Missing category")?;
    let preset_name = header_value(&request, "x-doxy-preset-name").ok_or("Missing preset name")?;
    let metadata = header_value(&request, "x-doxy-files").ok_or("Missing file list")?;
    validate_filename(&category)?;
    validate_filename(&preset_name)?;
    let files = decode_preset_files(raw_body(&request)?, &metadata)?;

    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let folder_name = format!("{}.preset", preset_name.trim());
    let destination = format!("presets/{category}/{folder_name}");

    let root = find_child_folder_ci(storage, None, "presets").await?.ok_or("The device has no presets folder.")?;
    let category_folder = find_child_folder_ci(storage, Some(root.handle), &category).await?;
    let preset_folder = match &category_folder {
        Some(folder) => find_child_folder_ci(storage, Some(folder.handle), &folder_name).await?,
        None => None,
    };

    let Some(preset_folder) = preset_folder else {
        let (verdict, explanation) = reconcile_verdict(false, 0, 0, files.len(), 0);
        return Ok(ReconcileReport {
            destination,
            folder_exists: false,
            files: files.iter().map(|file| ReconcileFile { name: file.name.clone(), status: "absent".into(), device_bytes: None }).collect(),
            extra: Vec::new(),
            identical: 0,
            different: 0,
            absent: files.len(),
            verdict: verdict.into(),
            explanation,
            token: None,
        });
    };

    let present = storage.list_objects(Some(preset_folder.handle)).await.map_err(|e| e.to_string())?;
    let mut report_files = Vec::new();
    let (mut identical, mut different, mut absent) = (0usize, 0usize, 0usize);
    for file in &files {
        match present.iter().find(|object| !object.is_folder() && object.filename.eq_ignore_ascii_case(&file.name)) {
            None => {
                absent += 1;
                report_files.push(ReconcileFile { name: file.name.clone(), status: "absent".into(), device_bytes: None });
            }
            Some(object) => {
                // Sizes first: a mismatch needs no transfer to decide.
                let same = if object.size != file.data.len() as u64 {
                    false
                } else {
                    let actual = storage.download(object.handle).await.map_err(|e| format!("Could not read {destination}/{}: {e}", file.name))?;
                    actual.as_slice() == file.data.as_ref()
                };
                if same { identical += 1; } else { different += 1; }
                report_files.push(ReconcileFile {
                    name: file.name.clone(),
                    status: if same { "identical".into() } else { "different".into() },
                    device_bytes: Some(object.size),
                });
            }
        }
    }
    let described: HashSet<String> = files.iter().map(|file| file.name.to_lowercase()).collect();
    let extra: Vec<String> = present
        .iter()
        .filter(|object| !described.contains(&object.filename.to_lowercase()))
        .map(|object| object.filename.clone())
        .collect();

    let (mut verdict, mut explanation) = reconcile_verdict(true, identical, different, absent, extra.len());
    let token = if verdict == "can complete" {
        let generation = state.generation.load(std::sync::atomic::Ordering::SeqCst);
        let missing: Vec<(&str, u64)> = report_files
            .iter()
            .filter(|file| file.status == "absent")
            .filter_map(|file| files.iter().find(|source| source.name == file.name).map(|source| (source.name.as_str(), source.data.len() as u64)))
            .collect();
        let digest = manifest_digest(missing.iter().copied());
        let bytes: u64 = missing.iter().map(|(_, size)| *size).sum();
        let free = storage.info().free_space_bytes;
        if bytes > free {
            // Still a report, not an error: the user asked what is up there, and the
            // answer is "this could be finished, but there is no room for it".
            verdict = "blocked";
            // The review already shows the device's free space, so this says which
            // way the shortfall runs rather than formatting bytes a second time.
            explanation = format!(
                "{absent} file(s) are missing, but the device does not have room for them. Nothing will be changed. Free some space and check again."
            );
            None
        } else {
            let serial = device.device_info().serial_number.clone();
            let token = manifest_digest([(serial.as_str(), generation), (digest.as_str(), bytes)].into_iter());
            *state.prepared_completion.lock().map_err(|_| "Plan registry unavailable")? = Some(PreparedSend {
                token: token.clone(), serial, generation,
                category: category.clone(), preset_name: preset_name.clone(), digest, bytes,
            });
            Some(token)
        }
    } else {
        *state.prepared_completion.lock().map_err(|_| "Plan registry unavailable")? = None;
        None
    };
    Ok(ReconcileReport {
        destination,
        folder_exists: true,
        files: report_files,
        extra,
        identical,
        different,
        absent,
        verdict: verdict.into(),
        explanation,
        token,
    })
}

/// Finish a partly written preset by adding only the files that are missing.
/// Requires the token from a check that said it could be completed, and refuses
/// if anything about that folder changed since.
#[tauri::command]
async fn complete_preset_send(state: State<'_, DeviceState>, request: tauri::ipc::Request<'_>) -> Result<usize, String> {
    let category = header_value(&request, "x-doxy-category").ok_or("Missing category")?;
    let preset_name = header_value(&request, "x-doxy-preset-name").ok_or("Missing preset name")?;
    let metadata = header_value(&request, "x-doxy-files").ok_or("Missing file list")?;
    let token = header_value(&request, "x-doxy-token").ok_or("Check the device before completing a preset.")?;
    validate_filename(&category)?;
    validate_filename(&preset_name)?;
    let files = decode_preset_files(raw_body(&request)?, &metadata)?;
    let generation = state.generation.load(std::sync::atomic::Ordering::SeqCst);

    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let plan = state.prepared_completion.lock().map_err(|_| "Plan registry unavailable")?.take()
        .ok_or("That check has already been used, or none has run. Check the device again.")?;

    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let folder_name = format!("{}.preset", preset_name.trim());
    let destination = format!("presets/{category}/{folder_name}");
    let root = find_child_folder_ci(storage, None, "presets").await?.ok_or("The device has no presets folder.")?;
    let category_folder = find_child_folder_ci(storage, Some(root.handle), &category).await?.ok_or("That category folder is gone. Check the device again.")?;
    let preset_folder = find_child_folder_ci(storage, Some(category_folder.handle), &folder_name).await?
        .ok_or("That preset folder is gone. Send it as a fresh preset instead.")?;

    // Re-read the folder: the missing set must be exactly what was inspected.
    let present = storage.list_objects(Some(preset_folder.handle)).await.map_err(|e| e.to_string())?;
    let mut missing: Vec<&PresetFile> = Vec::new();
    for file in &files {
        if !present.iter().any(|object| !object.is_folder() && object.filename.eq_ignore_ascii_case(&file.name)) {
            missing.push(file);
        }
    }
    // Device, session and destination are checked exactly as a fresh send is; the
    // digest is passed through so the folder change can be reported in its own words.
    check_plan(&plan, &token, &device.device_info().serial_number, generation, &category, &preset_name, &plan.digest)?;
    if missing.is_empty() {
        return Err("Nothing is missing from that folder any more. Check the device again.".into());
    }
    let now = manifest_digest(missing.iter().map(|file| (file.name.as_str(), file.data.len() as u64)));
    if now != plan.digest {
        return Err("That folder changed since you checked it, so this no longer matches what you saw. Check the device again.".into());
    }

    // Metadata last, so an interrupted completion still does not look like a finished preset.
    missing.sort_by_key(|file| file.name == "patch.json");
    let mut written = 0usize;
    for file in missing {
        let info = NewObjectInfo::file(&file.name, file.data.len() as u64);
        let stream = futures::stream::iter(vec![Ok::<_, std::io::Error>(file.data.clone())]);
        let handle = storage.upload(Some(preset_folder.handle), info, stream).await
            .map_err(|e| format!("Stopped after {written} file(s) at {destination}/{}: {e}. Existing content preserved.", file.name))?;
        let actual = storage.download(handle).await.map_err(|e| format!("Could not verify {destination}/{}: {e}", file.name))?;
        if actual.as_slice() != file.data.as_ref() {
            return Err(format!("Verification failed at {destination}/{}. Existing content preserved.", file.name));
        }
        written += 1;
    }
    Ok(written)
}

#[tauri::command]
async fn mtp_upload_preset(
    state: State<'_, DeviceState>,
    request: tauri::ipc::Request<'_>,
) -> Result<u32, String> {
    let category = header_value(&request, "x-doxy-category").ok_or("Missing category")?;
    let preset_name = header_value(&request, "x-doxy-preset-name").ok_or("Missing preset name")?;
    let metadata = header_value(&request, "x-doxy-files").ok_or("Missing file list")?;
    let token = header_value(&request, "x-doxy-token").ok_or("This send was not reviewed. Review it before anything is written.")?;
    let files = decode_preset_files(raw_body(&request)?, &metadata)?;
    let generation = state.generation.load(std::sync::atomic::Ordering::SeqCst);
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;

    // The reviewed plan is single-use: taking it here prevents a second write from one approval.
    let plan = state.prepared_send.lock().map_err(|_| "Plan registry unavailable")?.take()
        .ok_or("This send was not reviewed, or its review has already been used. Review it again.")?;
    check_plan(
        &plan,
        &token,
        &device.device_info().serial_number,
        generation,
        &category,
        &preset_name,
        &manifest_digest(files.iter().map(|file| (file.name.as_str(), file.data.len() as u64))),
    )?;

    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    if te::classify(&device.device_info().model, None) != "op-xy" {
        return Err("Preset uploads are supported only on OP-XY".into());
    }
    validate_filename(&category)?;
    validate_filename(&preset_name)?;
    let mut names = HashSet::new();
    let mut required = 0u64;
    for file in &files {
        validate_filename(&file.name)?;
        if !names.insert(file.name.to_lowercase()) { return Err("Duplicate file names in preset".into()); }
        required = required.checked_add(file.data.len() as u64).ok_or("Preset too large")?;
    }
    if !files.iter().any(|file| file.name == "patch.json") { return Err("Preset is missing patch.json".into()); }
    if required > storage.info().free_space_bytes { return Err("Not enough free space on device".into()); }
    let root = find_child_folder_ci(storage, None, "presets").await?.ok_or("Presets folder missing; no files written")?;
    let category_handle = match find_child_folder_ci(storage, Some(root.handle), &category).await? {
        Some(folder) => folder.handle,
        None => {
            let siblings = storage.list_objects(Some(root.handle)).await.map_err(|e| e.to_string())?;
            if siblings.iter().any(|object| object.filename.eq_ignore_ascii_case(&category)) { return Err("Category conflicts with an existing file".into()); }
            storage.upload(Some(root.handle), NewObjectInfo::folder(&category), futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>()).await.map_err(|e| e.to_string())?
        }
    };
    let folder_name = format!("{}.preset", preset_name.trim());
    let siblings = storage.list_objects(Some(category_handle)).await.map_err(|e| e.to_string())?;
    if siblings.iter().any(|object| object.filename.eq_ignore_ascii_case(&folder_name)) {
        return Err("A preset with this name already exists. Choose a new name; existing content is never replaced.".into());
    }
    let preset_folder_handle = storage.upload(Some(category_handle), NewObjectInfo::folder(&folder_name), futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>()).await.map_err(|e| e.to_string())?;
    // Write metadata last: incomplete transfers are never reported as complete presets.
    let mut files = files;
    files.sort_by_key(|file| file.name == "patch.json");
    for file in files {
        let info = NewObjectInfo::file(&file.name, file.data.len() as u64);
        let stream = futures::stream::iter(vec![Ok::<_, std::io::Error>(file.data.clone())]);
        let handle = storage.upload(Some(preset_folder_handle), info, stream).await
            .map_err(|e| format!("Upload incomplete at presets/{category}/{folder_name}: {e}. Existing content preserved."))?;
        let actual = storage.download(handle).await.map_err(|e| format!("Could not verify presets/{category}/{folder_name}/{}: {e}. The new folder may be incomplete; existing content preserved.", file.name))?;
        if actual.as_slice() != file.data.as_ref() { return Err(format!("Verification failed at presets/{category}/{folder_name}/{}. The new folder may be incomplete; existing content preserved.", file.name)); }
    }

    Ok(preset_folder_handle.0)
}

#[tauri::command]
async fn mtp_copy_preset(
    state: State<'_, DeviceState>, folder_handle: u32, new_name: String,
) -> Result<u32, String> {
    let name = new_name.trim();
    if name.is_empty() || name == "." || name == ".." || name.chars().any(|c| c.is_control() || "/\\:*?\"<>|".contains(c)) {
        return Err("Enter a valid preset name without path separators or reserved characters".into());
    }
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let root = find_child_folder(storage, None, "presets").await.map_err(|e| e.to_string())?.ok_or("Presets folder not found")?;
    let tree = walk_directory(storage, root).await?;
    let (source_path, source) = tree.iter().find(|(_, entry)| entry.handle == folder_handle && entry.is_directory).ok_or("Preset no longer exists; refresh the device")?;
    if !source.name.ends_with(".preset") { return Err("Selected folder is not a preset".into()); }
    let parent_path = source_path.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("");
    let parent = if parent_path.is_empty() { root } else {
        ObjectHandle(tree.iter().find(|(path, entry)| path == parent_path && entry.is_directory).ok_or("Parent folder not found")?.1.handle)
    };
    let target_name = format!("{}.preset", name);
    let siblings = storage.list_objects(Some(parent)).await.map_err(|e| e.to_string())?;
    if siblings.iter().any(|entry| entry.filename.to_lowercase() == target_name.to_lowercase()) {
        return Err("A preset with this name already exists; choose a different name".into());
    }
    let contents = walk_directory(storage, ObjectHandle(folder_handle)).await?;
    let required: u64 = contents.iter().filter(|(_, entry)| !entry.is_directory).map(|(_, entry)| entry.size).sum();
    if required > storage.info().free_space_bytes { return Err("Not enough device storage for this copy".into()); }
    let stream = futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>();
    let target = storage.upload(Some(parent), NewObjectInfo::folder(&target_name), stream).await.map_err(|e| e.to_string())?;
    let copy_result: Result<(), String> = async {
    let mut folders = std::collections::HashMap::from([(String::new(), target)]);
    // walk_directory returns lexical order, placing each parent before its descendants.
    for (path, entry) in contents {
        let parent_path = path.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("");
        let parent = *folders.get(parent_path).ok_or("Copy folder hierarchy is incomplete")?;
        let result = if entry.is_directory {
            let stream = futures::stream::empty::<Result<bytes::Bytes, std::io::Error>>();
            storage.upload(Some(parent), NewObjectInfo::folder(&entry.name), stream).await
        } else {
            let data = storage.download(ObjectHandle(entry.handle)).await.map_err(|e| format!("Copy incomplete; original preserved: {}", e))?;
            let info = NewObjectInfo::file(&entry.name, data.len() as u64);
            let stream = futures::stream::iter(vec![Ok::<_, std::io::Error>(bytes::Bytes::from(data.clone()))]);
            let uploaded = storage.upload(Some(parent), info, stream).await.map_err(|e| format!("Copy incomplete; original preserved: {}", e))?;
            let verified = storage.download(uploaded).await.map_err(|e| format!("Copy could not be verified; original preserved: {}", e))?;
            if verified != data { return Err("Copy verification failed; original preserved. The new folder may be incomplete.".into()); }
            Ok(uploaded)
        };
        let handle = result.map_err(|e| format!("Copy incomplete; original preserved: {}", e))?;
        if entry.is_directory { folders.insert(path, handle); }
    }
    Ok(())
    }.await;
    copy_result.map_err(|error| format!("Copy incomplete at presets/{parent_path}/{target_name}: {error}. Inspect this new folder before retrying; originals preserved."))?;
    Ok(target.0)
}

#[derive(Serialize, Clone)]
struct DevicePresetSample {
    handle: u32,
    name: String,
    size: u64,
    path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct PatchJsonRegion {
    sample: Option<String>,
    framecount: Option<u64>,
    #[serde(rename(deserialize = "pitch.keycenter", serialize = "pitch_keycenter"))]
    pitch_keycenter: Option<i64>,
    hikey: Option<i64>,
    lokey: Option<i64>,
    playmode: Option<String>,
    reverse: Option<bool>,
    transpose: Option<i64>,
    gain: Option<i64>,
    pan: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone)]
struct PatchJson {
    #[serde(rename(deserialize = "type", serialize = "preset_type"))]
    preset_type: Option<String>,
    name: Option<String>,
    regions: Option<Vec<PatchJsonRegion>>,
}

#[derive(Serialize, Clone)]
struct DevicePreset {
    id: String,
    name: String,
    category: String,
    preset_type: String,
    folder_handle: u32,
    patch_json: Option<PatchJson>,
    samples: Vec<DevicePresetSample>,
    total_size: u64,
}

#[derive(Serialize, Clone)]
struct DeviceProjectEntry {
    handle: u32,
    name: String,
    size: u64,
}

#[derive(Serialize)]
struct DeviceScanResult {
    presets: Vec<DevicePreset>,
    standalone_samples: Vec<DevicePresetSample>,
    projects: Vec<DeviceProjectEntry>,
}

/// Helper: find a child folder by exact name within a parent.
async fn find_child_folder(
    storage: &Storage,
    parent: Option<ObjectHandle>,
    name: &str,
) -> Result<Option<ObjectHandle>, mtp_rs::Error> {
    let objects = storage.list_objects(parent).await?;
    for obj in &objects {
        if obj.is_folder() && obj.filename.eq_ignore_ascii_case(name) {
            return Ok(Some(obj.handle));
        }
    }
    Ok(None)
}

/// Helper: find a child folder ignoring case, returning its full object info.
async fn find_child_folder_ci(
    storage: &Storage,
    parent: Option<ObjectHandle>,
    name: &str,
) -> Result<Option<ObjectInfo>, String> {
    let objects = storage.list_objects(parent).await.map_err(|e| e.to_string())?;
    Ok(objects.into_iter().find(|object| object.is_folder() && object.filename.eq_ignore_ascii_case(name)))
}

/// Enumerate a complete subtree, retaining relative paths for OS 1.1.15+ folders.
/// Iterative traversal avoids recursive async futures and rejects cyclic device listings.
async fn walk_objects(storage: &Storage, root: ObjectHandle) -> Result<Vec<(String, ObjectInfo)>, String> {
    let mut pending = vec![(root, String::new())];
    let mut visited = std::collections::HashSet::new();
    let mut entries = Vec::new();
    while let Some((parent, prefix)) = pending.pop() {
        if !visited.insert(parent.0) {
            return Err("Device returned a repeated folder; scan is incomplete".into());
        }
        let objects = storage.list_objects(Some(parent)).await.map_err(|e| e.to_string())?;
        for object in objects {
            let path = if prefix.is_empty() { object.filename.clone() }
                else { format!("{}/{}", prefix, object.filename) };
            validate_filename(&object.filename).map_err(|e| format!("Invalid device path {path}: {e}"))?;
            if object.is_folder() {
                pending.push((object.handle, path.clone()));
            }
            entries.push((path, object));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(entries)
}

async fn walk_directory(storage: &Storage, root: ObjectHandle) -> Result<Vec<(String, FileEntry)>, String> {
    Ok(walk_objects(storage, root)
        .await?
        .into_iter()
        .map(|(path, object)| (path, FileEntry {
            handle: object.handle.0, name: object.filename.clone(),
            is_directory: object.is_folder(), size: object.size,
        }))
        .collect())
}

fn is_audio_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    [".wav", ".aiff", ".aif"].iter().any(|suffix| lower.ends_with(suffix))
}

#[tauri::command]
async fn mtp_scan_presets(state: State<'_, DeviceState>) -> Result<DeviceScanResult, String> {
    let guard = state.device.lock().await;
    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;
    let mut presets = Vec::new();
    let mut standalone_samples = Vec::new();
    let mut projects = Vec::new();

    if let Some(root) = find_child_folder(storage, None, "presets").await.map_err(|e| e.to_string())? {
        let entries = walk_directory(storage, root).await?;
        for (path, folder) in &entries {
            if !folder.is_directory || !folder.name.ends_with(".preset") { continue; }
            let prefix = format!("{}/", path);
            let mut patch_json = None;
            let mut samples = Vec::new();
            let mut total_size = 0;
            for (child_path, child) in &entries {
                if child.is_directory { continue; }
                let Some(relative) = child_path.strip_prefix(&prefix) else { continue; };
                if relative.eq_ignore_ascii_case("patch.json") {
                    let data = storage.download(ObjectHandle(child.handle)).await.map_err(|e| e.to_string())?;
                    // Keep malformed presets visible; the detail view can report unavailable metadata.
                    patch_json = serde_json::from_slice::<PatchJson>(&data).ok();
                } else if is_audio_file(relative) {
                    total_size += child.size;
                    samples.push(DevicePresetSample { handle: child.handle, name: relative.to_string(), size: child.size, path: None });
                }
            }
            let category = path.rsplit_once('/').map(|(parent, _)| parent).unwrap_or("").to_string();
            presets.push(DevicePreset {
                id: path.clone(), name: folder.name.trim_end_matches(".preset").to_string(), category,
                preset_type: patch_json.as_ref().and_then(|p| p.preset_type.clone()).unwrap_or_else(|| "unknown".into()),
                folder_handle: folder.handle, patch_json, samples, total_size,
            });
        }
    }
    if let Some(root) = find_child_folder(storage, None, "samples").await.map_err(|e| e.to_string())? {
            for (path, entry) in walk_directory(storage, root).await? {
                if !entry.is_directory && is_audio_file(&entry.name) {
                    standalone_samples.push(DevicePresetSample { handle: entry.handle, name: path.clone(), size: entry.size, path: Some(format!("samples/{path}")) });
                }
            }
    }
    if let Some(root) = find_child_folder(storage, None, "projects").await.map_err(|e| e.to_string())? {
            for (path, entry) in walk_directory(storage, root).await? {
                if !entry.is_directory && entry.name.to_lowercase().ends_with(".xy") {
                    projects.push(DeviceProjectEntry { handle: entry.handle, name: path[..path.len() - 3].to_string(), size: entry.size });
                }
            }
    }
    Ok(DeviceScanResult { presets, standalone_samples, projects })
}

/// Opt-in packaging diagnostic only: never reachable during a normal launch.
#[tauri::command]
fn smoke_test_complete(app: tauri::AppHandle, success: bool, detail: String) -> Result<(), String> {
    if std::env::var_os("DOXY_SMOKE_TEST").is_none() { return Err("Startup diagnostic is not enabled".into()); }
    eprintln!("DOXY_NATIVE_SMOKE {}: {}", if success { "PASS" } else { "FAIL" }, detail);
    app.exit(if success { 0 } else { 1 });
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            if std::env::var_os("DOXY_SMOKE_TEST").is_some() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(20));
                    eprintln!("DOXY_NATIVE_SMOKE FAIL: startup handshake timed out");
                    handle.exit(1);
                });
            }
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if std::env::var_os("DOXY_SMOKE_TEST").is_some() && payload.event() == tauri::webview::PageLoadEvent::Finished {
                // This runs against the production assets, CSP and real injected bridge.
                // The expected disconnected error proves device IPC without touching USB.
                let _ = webview.eval(r#"
                    (async () => {
                        const invoke = window.__TAURI__?.core?.invoke;
                        if (!invoke) return; // Native watchdog reports bridge startup failure.
                        for (let i = 0; i < 100 && !document.querySelector('[aria-label="Device connection"]'); i++) await new Promise(resolve => setTimeout(resolve, 100));
                        if (!document.querySelector('[aria-label="Device connection"]')) return invoke('smoke_test_complete', {success: false, detail: 'Connection UI did not render'});
                        try {
                            await invoke('mtp_list_storages');
                            return invoke('smoke_test_complete', {success: false, detail: 'Expected a disconnected startup state'});
                        } catch (error) {
                            return invoke('smoke_test_complete', {success: String(error) === 'No device connected', detail: 'Rendered connection UI; native device IPC returned: ' + String(error)});
                        }
                    })();
                "#);
            }
        })
        .manage(DeviceState {
            device: Mutex::new(None),
            generation: std::sync::atomic::AtomicU64::new(0),
            restore_plan: Mutex::new(None),
            restore_cancel: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
            approved_folders: std::sync::Mutex::new(HashSet::new()),
            library: std::sync::Mutex::new(None),
            prepared_send: std::sync::Mutex::new(None),
            prepared_completion: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            smoke_test_complete,
            mtp_list_available,
            tp7_switch_to_mtp,
            mtp_connect,
            mtp_disconnect,
            mtp_list_storages,
            mtp_list_directory,
            mtp_read_file,
            mtp_read_partial,
            mtp_delete,
            mtp_rename,
            mtp_scan_tree,
            mtp_upload_at_path,
            export_device_files,
            stems::export_device_stems,
            catalog::catalog_open,
            catalog::catalog_choose,
            catalog::catalog_status,
            catalog::catalog_assets,
            catalog::catalog_import_from_device,
            catalog::catalog_import_local,
            catalog::catalog_transfers,
            catalog::catalog_record_transfer,
            catalog::catalog_save_region,
            catalog::catalog_label_asset,
            catalog::catalog_delete_region,
            localaudio::local_audio_info,
            localaudio::local_audio_window,
            localaudio::local_audio_peaks,
            pick_folder,
            save_file_to_folder,
            mtp_scan_presets,
            preflight_preset_send,
            reconcile_preset_send,
            complete_preset_send,
            mtp_upload_preset,
            mtp_copy_preset,
            backup::create_backup,
            backup::verify_backup,
            backup::preview_restore,
            backup::cancel_restore_preview,
            backup::restore_backup,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_binary_preset_files_without_json_audio_arrays() {
        let files = decode_preset_files(vec![0, 255, 128, 123, 125], r#"[{"name":"sample.wav","size":3},{"name":"patch.json","size":2}]"#).unwrap();
        assert_eq!(files[0].data.as_ref(), &[0, 255, 128]);
        assert_eq!(files[1].data.as_ref(), b"{}");
        assert_eq!(files[1].name, "patch.json");
    }

    #[test]
    fn rejects_malformed_binary_preset_lengths() {
        assert!(decode_preset_files(vec![1], r#"[{"name":"patch.json","size":2}]"#).is_err());
        assert!(decode_preset_files(vec![1, 2], r#"[{"name":"patch.json","size":1}]"#).is_err());
        assert!(decode_preset_files(vec![], "[]").is_err());
        assert!(decode_preset_files(vec![], "not json").is_err());
    }

    #[test]
    fn decodes_percent_encoded_headers() {
        assert_eq!(percent_decode("drum%2Fuser"), "drum/user");
        assert_eq!(percent_decode("kit%20%C3%89t%C3%A9.aif"), "kit Été.aif");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
    }

    #[test]
    fn rejects_unsafe_file_names() {
        assert!(validate_filename("kit.aif").is_ok());
        assert!(validate_filename("  ").is_err());
        assert!(validate_filename("..").is_err());
        assert!(validate_filename("a/b").is_err());
        assert!(validate_filename("a:b").is_err());
    }


    fn plan(serial: &str, generation: u64) -> PreparedSend {
        PreparedSend {
            token: "tok".into(),
            serial: serial.into(),
            generation,
            category: "drum".into(),
            preset_name: "field kit".into(),
            digest: manifest_digest([("patch.json", 512u64), ("kick.wav", 2048)].into_iter()),
            bytes: 2560,
        }
    }

    fn reviewed_digest() -> String {
        manifest_digest([("patch.json", 512u64), ("kick.wav", 2048)].into_iter())
    }

    #[test]
    fn accepts_a_write_that_matches_its_review() {
        assert!(check_plan(&plan("XY-1", 3), "tok", "XY-1", 3, "drum", "field kit", &reviewed_digest()).is_ok());
    }

    #[test]
    fn refuses_a_write_to_a_different_device_than_the_one_reviewed() {
        let error = check_plan(&plan("XY-1", 3), "tok", "XY-2", 3, "drum", "field kit", &reviewed_digest()).unwrap_err();
        assert!(error.contains("different device"), "{error}");
        assert!(error.contains("Nothing was written"), "{error}");
    }

    #[test]
    fn refuses_after_a_reconnect_changed_the_session() {
        let error = check_plan(&plan("XY-1", 3), "tok", "XY-1", 4, "drum", "field kit", &reviewed_digest()).unwrap_err();
        assert!(error.contains("reconnected"), "{error}");
    }

    #[test]
    fn refuses_when_the_preset_changed_after_the_review() {
        let changed = manifest_digest([("patch.json", 512u64), ("kick.wav", 4096)].into_iter());
        let error = check_plan(&plan("XY-1", 3), "tok", "XY-1", 3, "drum", "field kit", &changed).unwrap_err();
        assert!(error.contains("changed after it was reviewed"), "{error}");
    }

    #[test]
    fn refuses_a_different_destination_or_a_token_that_does_not_match() {
        assert!(check_plan(&plan("XY-1", 3), "tok", "XY-1", 3, "keys", "field kit", &reviewed_digest()).unwrap_err().contains("destination changed"));
        assert!(check_plan(&plan("XY-1", 3), "tok", "XY-1", 3, "drum", "other kit", &reviewed_digest()).unwrap_err().contains("destination changed"));
        assert!(check_plan(&plan("XY-1", 3), "wrong", "XY-1", 3, "drum", "field kit", &reviewed_digest()).unwrap_err().contains("does not match the reviewed plan"));
    }

    #[test]
    fn a_manifest_digest_depends_on_names_sizes_and_order() {
        let base = manifest_digest([("a.wav", 1u64), ("b.wav", 2)].into_iter());
        assert_ne!(base, manifest_digest([("b.wav", 2u64), ("a.wav", 1)].into_iter()), "order matters");
        assert_ne!(base, manifest_digest([("a.wav", 2u64), ("b.wav", 1)].into_iter()), "sizes matter");
        assert_ne!(base, manifest_digest([("a.wav", 1u64), ("c.wav", 2)].into_iter()), "names matter");
        assert_eq!(base, manifest_digest([("a.wav", 1u64), ("b.wav", 2)].into_iter()), "stable for the same input");
    }


    #[test]
    fn a_missing_folder_means_a_fresh_write() {
        let (verdict, explanation) = reconcile_verdict(false, 0, 0, 3, 0);
        assert_eq!(verdict, "nothing on the device");
        assert!(explanation.contains("fresh write"));
    }

    #[test]
    fn everything_matching_means_there_is_nothing_to_send() {
        let (verdict, explanation) = reconcile_verdict(true, 4, 0, 0, 0);
        assert_eq!(verdict, "already complete");
        assert!(explanation.contains("byte for byte"), "{explanation}");
        assert!(explanation.contains("nothing to send"));
    }

    #[test]
    fn a_partly_written_folder_can_be_completed() {
        let (verdict, explanation) = reconcile_verdict(true, 2, 0, 3, 0);
        assert_eq!(verdict, "can complete");
        assert!(explanation.contains("2 file(s) already match and 3 are missing"), "{explanation}");
        assert!(explanation.contains("nothing existing is touched"));
    }

    /// The two destructive device operations are registered so the interface gets a
    /// clear refusal rather than an unknown-command error — but they must stay
    /// refusals. `docs/hardware-test-guide.md` states that deletion and in-place
    /// rename are disabled while project dependency coverage is partial, and nothing
    /// else enforces that: there is no UI path to them and no other test.
    /// The source of one `#[tauri::command]` function, for tests that assert on its body.
    fn command_body<'a>(source: &'a str, command: &str) -> &'a str {
        let start = source
            .find(&format!("async fn {command}("))
            .unwrap_or_else(|| panic!("{command} is gone; if a write path was renamed this test must follow it"));
        let rest = &source[start..];
        let end = rest[1..].find("#[tauri::command]").map(|i| i + 1).unwrap_or(rest.len());
        &rest[..end]
    }

    /// Every path in *this file* that writes to a device must refuse to replace what is
    /// already there — and the set of such paths must not grow silently.
    ///
    /// The first version of this test named four commands from memory and missed
    /// `restore_backup`, which writes to the instrument just as sending does but lives in
    /// `backup.rs`. An audit that hard-codes its own scope will keep passing while the thing
    /// it was meant to cover moves out of view, so the companion test below derives the list
    /// from the source instead of trusting it. `backup.rs` carries its own equivalent for the
    /// restore path.
    ///
    /// The README promises that a write is "reviewed once, verified byte for byte", and the
    /// review is a frontend flow — a convention, not a guarantee. What makes device content
    /// safe is enforced here instead: each of the four write commands independently refuses
    /// when the destination name is taken. Two of them (`mtp_upload_preset`,
    /// `complete_preset_send`) additionally require a single-use token bound to the device
    /// session, so a reviewed plan cannot be replayed; the install and copy paths are
    /// guarded by name refusal alone. That asymmetry is deliberate and worth knowing, but
    /// the refusal is the part that must never be dropped from any of them.
    #[test]
    fn every_write_path_refuses_to_replace_existing_content() {
        let source = include_str!("main.rs");
        // Three of the four write a *new* name, so a taken name must be refused.
        for command in ["mtp_upload_at_path", "mtp_upload_preset", "mtp_copy_preset"] {
            let body = command_body(source, command);
            let refuses = body.contains("already exists") || body.contains("already in");
            assert!(refuses, "{command} does not refuse a name that is already taken");
            assert!(body.contains("Err("), "{command} has no refusal path at all");
        }

        // `complete_preset_send` is the exception, and writing this test is what made the
        // difference clear: its whole purpose is to fill in a folder that already exists,
        // so refusing a taken name would refuse the only thing it does. It protects the
        // same property by a different route — it re-reads the folder, recomputes the
        // missing set, and refuses when that no longer matches what the user was shown,
        // so it can only ever add files that are genuinely absent.
        let completion = command_body(source, "complete_preset_send");
        assert!(
            completion.contains("changed since you checked it"),
            "complete_preset_send must refuse when the folder no longer matches the review",
        );
        assert!(
            completion.contains("Nothing is missing from that folder any more"),
            "complete_preset_send must refuse when there is nothing absent to add",
        );
    }

    /// The list of device-writing commands must be derived, not remembered.
    ///
    /// This is the test that would have caught `restore_backup` being absent from the audit.
    /// It finds every `#[tauri::command]` in the crate whose body reaches for `storage.upload`
    /// — the one way anything gets onto a device — and requires each to be named in a test
    /// somewhere. A new write path, or an old one moved to another file, fails here.
    #[test]
    fn no_device_write_path_escapes_the_audit() {
        // Every command named by a test that asserts on write safety, in either file.
        const AUDITED: &[&str] = &[
            "mtp_upload_at_path",
            "mtp_upload_preset",
            "mtp_copy_preset",
            "complete_preset_send",
            "restore_backup",
        ];
        // Scan the crate, not the tests. The slice after the last `#[tauri::command]` runs to
        // end of file, so without this the detector reads the test module — and finds its own
        // string literals, reporting this very function as a device writer. It did exactly
        // that on the first run.
        let crate_only = |source: &'static str| -> &'static str {
            match source.find("#[cfg(test)]") {
                Some(at) => &source[..at],
                None => source,
            }
        };
        let files = [
            ("main.rs", crate_only(include_str!("main.rs"))),
            ("backup.rs", crate_only(include_str!("backup.rs"))),
        ];
        let mut writers: Vec<String> = Vec::new();
        for (name, source) in files {
            for (index, _) in source.match_indices("#[tauri::command]") {
                let rest = &source[index..];
                let end = rest[1..].find("#[tauri::command]").map(|i| i + 1).unwrap_or(rest.len());
                let body = &rest[..end];
                let Some(fn_at) = body.find("fn ") else { continue };
                let after = &body[fn_at + 3..];
                let command = after[..after.find('(').unwrap_or(0)].trim().to_string();
                // `storage.upload` is the only way bytes reach a device, folders included.
                if body.contains("storage.upload") || body.contains(".upload(") {
                    assert!(
                        AUDITED.contains(&command.as_str()),
                        "{command} in {name} writes to the device but no write-safety test names it",
                    );
                    writers.push(command);
                }
            }
        }
        // And the audit list must not name commands that no longer exist or no longer write.
        assert!(!writers.is_empty(), "no device-writing commands found at all; the detector has stopped working");
    }

    /// The two paths that carry a reviewed plan must check its token.
    #[test]
    fn a_reviewed_send_cannot_be_written_without_its_review() {
        let source = include_str!("main.rs");
        for command in ["mtp_upload_preset", "complete_preset_send"] {
            let body = command_body(source, command);
            assert!(body.contains("x-doxy-token"), "{command} writes without requiring the review token");
        }
    }

    /// Refusals must not ask for something this app disables. The install path used
    /// to say "rename or delete it first", and both of those are stubs that refuse.
    #[test]
    fn no_refusal_asks_the_user_to_delete_or_rename_on_the_device() {
        let source = include_str!("main.rs");
        for line in source.lines() {
            let trimmed = line.trim_start();
            if trimmed.starts_with("//") || !line.contains('"') { continue; }
            let lowered = line.to_lowercase();
            // The advice this app cannot carry out, assembled from pieces so this
            // test's own needles do not trip it.
            let verbs = ["delete", "rename"];
            let tails = [" it first", " the existing", " or delete it", " or rename it"];
            for verb in verbs {
                for tail in tails {
                    let impossible = format!("{verb}{tail}");
                    assert!(
                        !lowered.contains(&impossible),
                        "a message tells the user to {impossible}, which this app refuses to do: {line}"
                    );
                }
            }
        }
    }

    /// Deleting and renaming are no longer refused — the owner asked for both on their
    /// own recorder — so what is asserted is the guarantee that replaced the refusal:
    /// **nothing is destroyed silently, and nothing is reported that was not verified.**
    #[test]
    fn deleting_and_renaming_verify_what_they_did() {
        let source = include_str!("main.rs");
        for name in ["mtp_delete", "mtp_rename"] {
            let body = command_body(source, name);
            // Both read the object back after writing, so a firmware that accepts a
            // command and ignores it is reported as a failure rather than believed.
            assert!(body.contains("get_object_info"), "{name} does not read back what it did");
        }
        let rename = command_body(source, "mtp_rename");
        assert!(rename.contains("validate_filename"), "rename must reject path separators and reserved characters");
        assert!(rename.contains("check_rename"), "rename must apply the tape-track and extension rules");
        assert!(rename.contains("already in that folder"), "rename must refuse a name that is taken rather than replace a file");

        let delete = command_body(source, "mtp_delete");
        assert!(delete.contains("is_folder"), "delete must refuse folders rather than recursing into them");
    }

    /// The two renames that break the instrument's own references.
    #[test]
    fn a_rename_that_would_break_the_file_is_refused() {
        // A field tape track: the number in the name is the track number.
        assert!(check_rename("track_1.aif", "yard door slam.aif").is_err());
        assert!(check_rename("track_12.aif", "anything.aif").is_err());
        // Changing what the file claims to be.
        assert!(check_rename("2026-02-23_112713_000.wav", "slam.txt").is_err());
        assert!(check_rename("take.wav", "take").is_err());

        // A recorder's take, which is what this was built for, and an OP-XY sample,
        // which is allowed because the sweep can answer which projects use it.
        assert!(check_rename("2026-02-23_112713_000.wav", "yard door slam.wav").is_ok());
        assert!(check_rename("kick.wav", "kick soft.wav").is_ok());
        // Case-only differences in the extension are the same extension.
        assert!(check_rename("pad.AIF", "warm pad.aif").is_ok());
        // Not a tape track, despite starting the same way.
        assert!(check_rename("track_notes.wav", "session notes.wav").is_ok());
    }

    #[test]
    fn a_completion_is_refused_when_the_missing_set_changed() {
        // Checked when only patch.json was missing.
        let digest = manifest_digest([("patch.json", 512u64)].into_iter());
        let plan = PreparedSend {
            token: "t".into(), serial: "XY-1".into(), generation: 3,
            category: "drum".into(), preset_name: "field kit".into(), digest: digest.clone(), bytes: 512,
        };
        assert!(check_plan(&plan, "t", "XY-1", 3, "drum", "field kit", &digest).is_ok());
        // A sample vanished in between, so two files are missing now — a different set,
        // which the completion path compares against the plan rather than writing.
        let changed = manifest_digest([("patch.json", 512u64), ("kick.wav", 2048)].into_iter());
        assert_ne!(changed, digest);
        assert!(check_plan(&plan, "t", "XY-1", 3, "drum", "field kit", &changed).is_err());
    }

    #[test]
    fn differing_or_unexpected_content_blocks_a_retry() {
        let (verdict, explanation) = reconcile_verdict(true, 1, 1, 2, 0);
        assert_eq!(verdict, "blocked");
        assert!(explanation.contains("differ from this preset"), "{explanation}");
        assert!(explanation.contains("Nothing will be changed"));

        let (verdict, explanation) = reconcile_verdict(true, 3, 0, 0, 2);
        assert_eq!(verdict, "blocked");
        assert!(explanation.contains("not part of this preset"), "{explanation}");

        let (verdict, explanation) = reconcile_verdict(true, 0, 2, 1, 1);
        assert_eq!(verdict, "blocked");
        assert!(explanation.contains("differ from this preset"), "{explanation}");
        assert!(explanation.contains("not part of this preset"), "{explanation}");
    }

    #[test]
    fn formats_device_timestamps() {
        let value = DateTime { year: 2026, month: 2, day: 23, hour: 11, minute: 27, second: 13 };
        assert_eq!(format_datetime(&value), "2026-02-23T11:27:13");
    }
}
