//! Bounded reads of library audio, so a long take can be inspected without
//! loading it.
//!
//! Playbook phase 04.1–04.2. A 900 MB multitrack take must open immediately and
//! let any moment in it be auditioned, which means two things: read a *window*
//! of frames rather than a file, and keep a small cached summary for drawing the
//! whole thing. Headers are parsed by the same validated reader the stem
//! splitter uses, so there is one definition of what this app accepts as WAV.

use crate::{catalog, stems, DeviceState};
use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::State;

const PEAKS_DIR: &str = "peaks";
/// Bump when the peak maths changes, so stale caches are ignored rather than trusted.
const PEAKS_VERSION: u32 = 1;
/// Largest window a single read may return, keeping IPC and memory bounded.
const MAX_WINDOW_BYTES: u64 = 32 * 1024 * 1024;
const MAX_BUCKETS: u32 = 8192;
const HEADER_SCAN_BYTES: usize = 64 * 1024;
const STREAM_CHUNK: usize = 1024 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct AudioInfo {
    pub asset_id: String,
    pub sample_rate: u32,
    pub channels: u16,
    pub bits: u16,
    pub is_float: bool,
    pub frames: u64,
    pub duration_seconds: f64,
    /// Bytes of audio, excluding the header.
    pub audio_bytes: u64,
}

fn library_root(state: &State<'_, DeviceState>) -> Result<PathBuf, String> {
    state
        .library
        .lock()
        .map_err(|_| "Library registry unavailable")?
        .clone()
        .ok_or_else(|| "Open your library first.".to_string())
}

/// Locate an asset's file inside the library, refusing anything that escapes it.
fn asset_path(root: &Path, asset_id: &str) -> Result<(PathBuf, catalog::Asset), String> {
    let catalog = catalog::load(root)?;
    let asset = catalog
        .assets
        .into_iter()
        .find(|asset| asset.id == asset_id)
        .ok_or("That take is not in this library.")?;
    let mut path = root.to_path_buf();
    for segment in asset.stored_path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." || segment.contains('\\') {
            return Err("That take's stored path is not one this app will read.".into());
        }
        path.push(segment);
    }
    let metadata = fs::symlink_metadata(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("That take is not a regular file.".into());
    }
    Ok((path, asset))
}

fn read_header(path: &Path) -> Result<(stems::WavInfo, u64), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let total = file.metadata().map_err(|e| e.to_string())?.len();
    let mut prefix = vec![0u8; HEADER_SCAN_BYTES.min(total as usize)];
    let read = file.read(&mut prefix).map_err(|e| e.to_string())?;
    prefix.truncate(read);
    let info = stems::parse_audio_header(&prefix)?
        .ok_or("This take's header is longer than this app reads, or incomplete.")?;
    Ok((info, total))
}

/// Audio bytes actually present, respecting both the declared length and the file size.
fn audio_bytes(info: &stems::WavInfo, total: u64) -> u64 {
    let available = total.saturating_sub(info.data_offset as u64);
    match info.data_len {
        Some(declared) => declared.min(available),
        None => available,
    }
}

fn describe(asset_id: &str, info: &stems::WavInfo, total: u64) -> AudioInfo {
    let bytes = audio_bytes(info, total);
    let frames = bytes / info.block_align as u64;
    AudioInfo {
        asset_id: asset_id.to_string(),
        sample_rate: info.sample_rate,
        channels: info.channels,
        bits: info.bits,
        is_float: info.format == 3,
        frames,
        duration_seconds: if info.sample_rate > 0 { frames as f64 / info.sample_rate as f64 } else { 0.0 },
        audio_bytes: bytes,
    }
}

/// One sample as a float, whatever the source encoding.
/// One sample as a float, from either byte order.
///
/// AIFF is big-endian and its 8-bit samples are signed, where WAV's are unsigned —
/// so the byte order also decides how the narrowest samples are read.
fn sample_at(bytes: &[u8], offset: usize, bits: u16, is_float: bool, big_endian: bool) -> f32 {
    if big_endian {
        return match (is_float, bits) {
            (true, 32) => f32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]),
            (true, 64) => f64::from_be_bytes([
                bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
                bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
            ]) as f32,
            (false, 8) => bytes[offset] as i8 as f32 / 128.0,
            (false, 16) => i16::from_be_bytes([bytes[offset], bytes[offset + 1]]) as f32 / 32768.0,
            (false, 24) => {
                let value = ((bytes[offset + 2] as i32) | ((bytes[offset + 1] as i32) << 8) | ((bytes[offset] as i8 as i32) << 16)) as f32;
                value / 8_388_608.0
            }
            (false, 32) => i32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) as f32 / 2_147_483_648.0,
            _ => 0.0,
        };
    }
    match (is_float, bits) {
        (true, 32) => f32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]),
        (true, 64) => f64::from_le_bytes([
            bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3],
            bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7],
        ]) as f32,
        (false, 8) => (bytes[offset] as f32 - 128.0) / 128.0,
        (false, 16) => i16::from_le_bytes([bytes[offset], bytes[offset + 1]]) as f32 / 32768.0,
        (false, 24) => {
            let value = ((bytes[offset] as i32) | ((bytes[offset + 1] as i32) << 8) | ((bytes[offset + 2] as i8 as i32) << 16)) as f32;
            value / 8_388_608.0
        }
        (false, 32) => i32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) as f32 / 2_147_483_648.0,
        _ => 0.0,
    }
}

fn canonical_header(info: &stems::WavInfo, data_len: u32) -> Vec<u8> {
    let block_align = info.block_align;
    let mut header = Vec::with_capacity(44);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&(36 + data_len).to_le_bytes());
    header.extend_from_slice(b"WAVEfmt ");
    header.extend_from_slice(&16u32.to_le_bytes());
    header.extend_from_slice(&info.format.to_le_bytes());
    header.extend_from_slice(&info.channels.to_le_bytes());
    header.extend_from_slice(&info.sample_rate.to_le_bytes());
    header.extend_from_slice(&(info.sample_rate * block_align as u32).to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&info.bits.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&data_len.to_le_bytes());
    header
}

/// Rewrite big-endian samples in place as the little-endian ones WAV requires.
///
/// The sample values are the same numbers; only their byte order changes. Eight-bit
/// samples are re-centred instead, because AIFF stores them signed and WAV unsigned.
fn to_little_endian(audio: &mut [u8], bits: u16) {
    let width = (bits / 8) as usize;
    match width {
        0 => {}
        1 => {
            for byte in audio.iter_mut() {
                *byte = (*byte as i8 as i16 + 128) as u8;
            }
        }
        _ => {
            for sample in audio.chunks_exact_mut(width) {
                sample.reverse();
            }
        }
    }
}

/// A window of frames as a playable WAV, with the source's sample values untouched.
pub fn window_bytes(path: &Path, info: &stems::WavInfo, total: u64, start_frame: u64, frames: u32) -> Result<Vec<u8>, String> {
    let available_frames = audio_bytes(info, total) / info.block_align as u64;
    if start_frame >= available_frames {
        return Err("That position is past the end of this take.".into());
    }
    let wanted = (frames as u64).min(available_frames - start_frame);
    let length = wanted * info.block_align as u64;
    if length > MAX_WINDOW_BYTES {
        return Err(format!("A single read is limited to {} MB. Ask for a shorter window.", MAX_WINDOW_BYTES / (1024 * 1024)));
    }
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(info.data_offset as u64 + start_frame * info.block_align as u64)).map_err(|e| e.to_string())?;
    let mut audio = vec![0u8; length as usize];
    file.read_exact(&mut audio).map_err(|e| e.to_string())?;
    if info.big_endian {
        to_little_endian(&mut audio, info.bits);
    }
    let mut out = canonical_header(info, u32::try_from(length).map_err(|_| "Window too large".to_string())?);
    out.append(&mut audio);
    Ok(out)
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Peaks {
    pub version: u32,
    pub asset_id: String,
    pub buckets: u32,
    pub channels: u16,
    pub frames: u64,
    pub sample_rate: u32,
    /// Channel-major: all buckets for channel 0, then channel 1, and so on.
    pub min: Vec<f32>,
    pub max: Vec<f32>,
}

/// Stream the file once, reducing it to min/max pairs per bucket per channel.
/// Memory stays at one chunk plus the summary, whatever the file's length.
pub fn compute_peaks(path: &Path, info: &stems::WavInfo, total: u64, asset_id: &str, buckets: u32) -> Result<Peaks, String> {
    let buckets = buckets.clamp(1, MAX_BUCKETS);
    let channels = info.channels as usize;
    let frames = audio_bytes(info, total) / info.block_align as u64;
    let mut min = vec![f32::MAX; buckets as usize * channels];
    let mut max = vec![f32::MIN; buckets as usize * channels];
    if frames == 0 {
        return Ok(Peaks { version: PEAKS_VERSION, asset_id: asset_id.into(), buckets, channels: info.channels, frames: 0, sample_rate: info.sample_rate, min: vec![0.0; buckets as usize * channels], max: vec![0.0; buckets as usize * channels] });
    }

    let mut file = File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(info.data_offset as u64)).map_err(|e| e.to_string())?;
    let align = info.block_align as usize;
    let sample_bytes = info.bits as usize / 8;
    let is_float = info.format == 3;
    let mut buffer = vec![0u8; STREAM_CHUNK - (STREAM_CHUNK % align)];
    let mut carry: Vec<u8> = Vec::new();
    let mut frame_index: u64 = 0;
    let mut remaining = frames * align as u64;

    while remaining > 0 {
        let want = (buffer.len() as u64).min(remaining) as usize;
        let read = file.read(&mut buffer[..want]).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        remaining -= read as u64;
        let data: &[u8] = if carry.is_empty() {
            &buffer[..read]
        } else {
            carry.extend_from_slice(&buffer[..read]);
            &carry
        };
        let whole = data.len() - data.len() % align;
        for frame in data[..whole].chunks_exact(align) {
            // Spread frames evenly across buckets; the last frame lands in the last bucket.
            let bucket = ((frame_index * buckets as u64) / frames).min(buckets as u64 - 1) as usize;
            for channel in 0..channels {
                let value = sample_at(frame, channel * sample_bytes, info.bits, is_float, info.big_endian);
                let slot = channel * buckets as usize + bucket;
                if value < min[slot] { min[slot] = value; }
                if value > max[slot] { max[slot] = value; }
            }
            frame_index += 1;
        }
        let leftover = data[whole..].to_vec();
        carry = leftover;
    }

    // Buckets with no frames (a very short take against many buckets) read as silence, not as f32::MAX.
    for index in 0..min.len() {
        if min[index] > max[index] {
            min[index] = 0.0;
            max[index] = 0.0;
        }
    }
    Ok(Peaks { version: PEAKS_VERSION, asset_id: asset_id.into(), buckets, channels: info.channels, frames, sample_rate: info.sample_rate, min, max })
}

fn peaks_cache_path(root: &Path, asset_id: &str, buckets: u32) -> PathBuf {
    root.join(PEAKS_DIR).join(format!("{asset_id}-{buckets}-v{PEAKS_VERSION}.json"))
}

/// Cached peaks are disposable: anything unreadable, stale or from another
/// version is recomputed rather than trusted, and never blocks the take.
fn cached_peaks(path: &Path, asset_id: &str, buckets: u32) -> Option<Peaks> {
    let bytes = fs::read(path).ok()?;
    let peaks: Peaks = serde_json::from_slice(&bytes).ok()?;
    let expected = buckets.clamp(1, MAX_BUCKETS);
    if peaks.version != PEAKS_VERSION || peaks.asset_id != asset_id || peaks.buckets != expected {
        return None;
    }
    if peaks.min.len() != peaks.max.len() || peaks.min.len() != expected as usize * peaks.channels as usize {
        return None;
    }
    Some(peaks)
}

fn store_peaks(path: &Path, peaks: &Peaks) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temporary = path.with_extension("writing");
    {
        let mut file = OpenOptions::new().write(true).create(true).truncate(true).open(&temporary).map_err(|e| e.to_string())?;
        serde_json::to_writer(&mut file, peaks).map_err(|e| e.to_string())?;
        file.flush().map_err(|e| e.to_string())?;
    }
    fs::rename(&temporary, path).map_err(|e| e.to_string())
}

// --- Commands ----------------------------------------------------------------

#[tauri::command]
pub async fn local_audio_info(state: State<'_, DeviceState>, asset_id: String) -> Result<AudioInfo, String> {
    let root = library_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (path, asset) = asset_path(&root, &asset_id)?;
        let (info, total) = read_header(&path)?;
        Ok(describe(&asset.id, &info, total))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Raw bytes of a frame window, wrapped in a canonical header so the webview can decode it.
#[tauri::command]
pub async fn local_audio_window(
    state: State<'_, DeviceState>,
    asset_id: String,
    start_frame: u64,
    frames: u32,
) -> Result<tauri::ipc::Response, String> {
    let root = library_root(&state)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        let (path, _) = asset_path(&root, &asset_id)?;
        let (info, total) = read_header(&path)?;
        window_bytes(&path, &info, total, start_frame, frames)
    })
    .await
    .map_err(|e| e.to_string())??;
    Ok(tauri::ipc::Response::new(tauri::ipc::InvokeResponseBody::Raw(bytes)))
}

/// Peaks for drawing a whole take, computed once and cached beside the library.
#[tauri::command]
pub async fn local_audio_peaks(state: State<'_, DeviceState>, asset_id: String, buckets: u32) -> Result<Peaks, String> {
    let root = library_root(&state)?;
    tauri::async_runtime::spawn_blocking(move || {
        let cache = peaks_cache_path(&root, &asset_id, buckets);
        if let Some(peaks) = cached_peaks(&cache, &asset_id, buckets) {
            return Ok(peaks);
        }
        let (path, asset) = asset_path(&root, &asset_id)?;
        let (info, total) = read_header(&path)?;
        let peaks = compute_peaks(&path, &info, total, &asset.id, buckets)?;
        // A cache that cannot be written is not a failure the user needs to see.
        let _ = store_peaks(&cache, &peaks);
        Ok(peaks)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new(label: &str) -> Self {
            let id = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("target/localaudio-tests").join(format!("{label}-{id}"));
            fs::create_dir_all(path.join("originals")).unwrap();
            Self(path)
        }
        /// A WAV whose samples encode their frame index, so windows can be checked exactly.
        fn wav(&self, name: &str, channels: u16, frames: u32) -> PathBuf {
            let bits = 16u16;
            let align = channels * bits / 8;
            let data_len = frames * align as u32;
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"RIFF");
            bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
            bytes.extend_from_slice(b"WAVEfmt ");
            bytes.extend_from_slice(&16u32.to_le_bytes());
            bytes.extend_from_slice(&1u16.to_le_bytes());
            bytes.extend_from_slice(&channels.to_le_bytes());
            bytes.extend_from_slice(&44100u32.to_le_bytes());
            bytes.extend_from_slice(&(44100 * align as u32).to_le_bytes());
            bytes.extend_from_slice(&align.to_le_bytes());
            bytes.extend_from_slice(&bits.to_le_bytes());
            bytes.extend_from_slice(b"data");
            bytes.extend_from_slice(&data_len.to_le_bytes());
            for frame in 0..frames {
                for channel in 0..channels {
                    let value = (frame as i16).wrapping_mul(if channel == 0 { 1 } else { -1 });
                    bytes.extend_from_slice(&value.to_le_bytes());
                }
            }
            let path = self.0.join("originals").join(name);
            fs::write(&path, bytes).unwrap();
            path
        }

        /// The same audio as `wav`, in an AIFF: big-endian samples, an 80-bit
        /// extended sample rate, and an SSND chunk with its offset field.
        fn aiff(&self, name: &str, channels: u16, frames: u32) -> PathBuf {
            let bits = 16u16;
            let align = channels * bits / 8;
            let data_len = frames * align as u32;
            let mut bytes = Vec::new();
            bytes.extend_from_slice(b"FORM");
            bytes.extend_from_slice(&(4 + 8 + 18 + 8 + 8 + data_len).to_be_bytes());
            bytes.extend_from_slice(b"AIFF");
            bytes.extend_from_slice(b"COMM");
            bytes.extend_from_slice(&18u32.to_be_bytes());
            bytes.extend_from_slice(&channels.to_be_bytes());
            bytes.extend_from_slice(&frames.to_be_bytes());
            bytes.extend_from_slice(&bits.to_be_bytes());
            // 44100 as an 80-bit IEEE extended float.
            bytes.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
            bytes.extend_from_slice(b"SSND");
            bytes.extend_from_slice(&(8 + data_len).to_be_bytes());
            bytes.extend_from_slice(&0u32.to_be_bytes()); // offset
            bytes.extend_from_slice(&0u32.to_be_bytes()); // blockSize
            for frame in 0..frames {
                for channel in 0..channels {
                    let value = (frame as i16).wrapping_mul(if channel == 0 { 1 } else { -1 });
                    bytes.extend_from_slice(&value.to_be_bytes());
                }
            }
            let path = self.0.join("originals").join(name);
            fs::write(&path, bytes).unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn header(path: &Path) -> (stems::WavInfo, u64) {
        read_header(path).unwrap()
    }

    #[test]
    fn describes_a_take_without_reading_its_audio() {
        let fixture = Fixture::new("info");
        let path = fixture.wav("take.wav", 2, 44_100);
        let (info, total) = header(&path);
        let described = describe("hash-a", &info, total);
        assert_eq!(described.channels, 2);
        assert_eq!(described.sample_rate, 44_100);
        assert_eq!(described.bits, 16);
        assert_eq!(described.frames, 44_100);
        assert!((described.duration_seconds - 1.0).abs() < 1e-9);
        assert!(!described.is_float);
    }

    #[test]
    fn reads_a_late_window_and_keeps_its_samples_verbatim() {
        let fixture = Fixture::new("window");
        let path = fixture.wav("take.wav", 2, 10_000);
        let (info, total) = header(&path);
        let window = window_bytes(&path, &info, total, 9_990, 10).unwrap();
        assert_eq!(&window[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(window[40..44].try_into().unwrap()), 10 * 4, "data length is the window");
        // Frame 9990's left channel encodes 9990.
        assert_eq!(i16::from_le_bytes(window[44..46].try_into().unwrap()), 9_990);
        assert_eq!(i16::from_le_bytes(window[46..48].try_into().unwrap()), -9_990, "right channel is inverted in the fixture");
    }

    #[test]
    fn clamps_a_window_to_the_end_rather_than_failing() {
        let fixture = Fixture::new("clamp");
        let path = fixture.wav("take.wav", 1, 100);
        let (info, total) = header(&path);
        let window = window_bytes(&path, &info, total, 95, 1_000).unwrap();
        assert_eq!(u32::from_le_bytes(window[40..44].try_into().unwrap()), 5 * 2);
    }

    #[test]
    fn refuses_a_position_past_the_end_and_an_oversized_window() {
        let fixture = Fixture::new("bounds");
        let path = fixture.wav("take.wav", 1, 100);
        let (info, total) = header(&path);
        assert!(window_bytes(&path, &info, total, 100, 10).unwrap_err().contains("past the end"));

        let big = fixture.wav("big.wav", 2, 20_000_000); // 80 MB of audio
        let (big_info, big_total) = header(&big);
        assert!(window_bytes(&big, &big_info, big_total, 0, 20_000_000).unwrap_err().contains("limited to 32 MB"));
    }

    #[test]
    fn summarises_a_take_into_per_channel_peaks() {
        let fixture = Fixture::new("peaks");
        let path = fixture.wav("take.wav", 2, 1_000);
        let (info, total) = header(&path);
        let peaks = compute_peaks(&path, &info, total, "hash-a", 10).unwrap();
        assert_eq!(peaks.buckets, 10);
        assert_eq!(peaks.channels, 2);
        assert_eq!(peaks.frames, 1_000);
        assert_eq!(peaks.min.len(), 20);
        // Left channel rises with the frame index, so each bucket's max grows.
        let left_max: Vec<f32> = peaks.max[..10].to_vec();
        assert!(left_max.windows(2).all(|pair| pair[0] < pair[1]), "{left_max:?}");
        // Right channel is the inverse, so its minima fall.
        let right_min: Vec<f32> = peaks.min[10..].to_vec();
        assert!(right_min.windows(2).all(|pair| pair[0] > pair[1]), "{right_min:?}");
    }

    #[test]
    fn peaks_are_the_same_however_the_file_is_chunked() {
        let fixture = Fixture::new("chunking");
        // Larger than one streaming chunk, with an odd frame count so a carry is forced.
        let path = fixture.wav("take.wav", 3, 400_001);
        let (info, total) = header(&path);
        let peaks = compute_peaks(&path, &info, total, "hash-a", 64).unwrap();
        assert_eq!(peaks.frames, 400_001);
        assert_eq!(peaks.min.len(), 64 * 3);
        assert!(peaks.min.iter().all(|value| value.is_finite()));
        assert!(peaks.max.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn empty_and_tiny_takes_summarise_as_silence_not_as_infinities() {
        let fixture = Fixture::new("tiny");
        let empty = fixture.wav("empty.wav", 1, 0);
        let (info, total) = header(&empty);
        let peaks = compute_peaks(&empty, &info, total, "hash-empty", 16).unwrap();
        assert_eq!(peaks.frames, 0);
        assert!(peaks.min.iter().all(|value| *value == 0.0));
        assert!(peaks.max.iter().all(|value| *value == 0.0));

        let tiny = fixture.wav("tiny.wav", 1, 3);
        let (tiny_info, tiny_total) = header(&tiny);
        let tiny_peaks = compute_peaks(&tiny, &tiny_info, tiny_total, "hash-tiny", 64).unwrap();
        assert!(tiny_peaks.min.iter().all(|value| value.is_finite()));
        assert!(tiny_peaks.max.iter().all(|value| value.is_finite()));
    }

    #[test]
    fn caches_peaks_and_ignores_a_stale_or_foreign_cache() {
        let fixture = Fixture::new("cache");
        let path = fixture.wav("take.wav", 1, 500);
        let (info, total) = header(&path);
        let peaks = compute_peaks(&path, &info, total, "hash-a", 32).unwrap();
        let cache = peaks_cache_path(&fixture.0, "hash-a", 32);
        store_peaks(&cache, &peaks).unwrap();
        assert_eq!(cached_peaks(&cache, "hash-a", 32), Some(peaks.clone()));
        assert!(!cache.with_extension("writing").exists(), "no temporary file is left behind");

        // Another asset's peaks, a different resolution, and a corrupt file are all refused.
        assert_eq!(cached_peaks(&cache, "hash-b", 32), None);
        assert_eq!(cached_peaks(&cache, "hash-a", 64), None);
        fs::write(&cache, b"not json").unwrap();
        assert_eq!(cached_peaks(&cache, "hash-a", 32), None);
    }

    #[test]
    fn refuses_a_stored_path_that_leaves_the_library() {
        let fixture = Fixture::new("escape");
        catalog::open_root(&fixture.0).unwrap();
        let mut catalog_data = catalog::load(&fixture.0).unwrap();
        catalog_data.assets.push(catalog::Asset {
            id: "hash-escape".into(),
            stored_path: "originals/../../secrets.wav".into(),
            original_name: "secrets.wav".into(),
            bytes: 1,
            first_imported_unix: 0,
            occurrences: vec![],
            regions: vec![],
            label: None,
        });
        catalog::commit(&fixture.0, &catalog_data).unwrap();
        let error = asset_path(&fixture.0, "hash-escape").unwrap_err();
        assert!(error.contains("not one this app will read"), "{error}");
        assert!(asset_path(&fixture.0, "hash-missing").unwrap_err().contains("not in this library"));
    }

    #[test]
    fn decodes_every_supported_sample_encoding() {
        assert!((sample_at(&[0x00, 0x40], 0, 16, false, false) - 0.5).abs() < 1e-6);
        assert!((sample_at(&[0x00, 0xc0], 0, 16, false, false) + 0.5).abs() < 1e-6);
        assert!((sample_at(&[192], 0, 8, false, false) - 0.5).abs() < 1e-6);
        assert!((sample_at(&[0x00, 0x00, 0x40], 0, 24, false, false) - 0.5).abs() < 1e-6);
        assert!((sample_at(&[0x00, 0x00, 0xc0], 0, 24, false, false) + 0.5).abs() < 1e-6);
        assert!((sample_at(&[0, 0, 0, 0x40], 0, 32, false, false) - 0.5).abs() < 1e-6);
        assert!((sample_at(&0.25f32.to_le_bytes(), 0, 32, true, false) - 0.25).abs() < 1e-6);
        assert!((sample_at(&0.75f64.to_le_bytes(), 0, 64, true, false) - 0.75).abs() < 1e-6);
    }

    #[test]
    fn reads_an_aiff_take_as_readily_as_a_wav_one() {
        // An OP-1 field's tape and album audio is AIFF. Importing it and then being
        // unable to open it would be a dead end the import itself created.
        let fixture = Fixture::new("aiff");
        let aiff = fixture.aiff("tape.aif", 2, 500);
        let (info, total) = header(&aiff);
        assert_eq!(info.channels, 2);
        assert_eq!(info.sample_rate, 44_100);
        assert_eq!(info.bits, 16);
        assert_eq!(info.block_align, 4);
        assert!(info.big_endian);
        assert_eq!(audio_bytes(&info, total), 2000);
    }

    #[test]
    fn an_aiff_window_comes_back_as_a_playable_wav() {
        let fixture = Fixture::new("aiff-window");
        let aiff = fixture.aiff("tape.aif", 2, 500);
        let (info, total) = header(&aiff);
        let window = window_bytes(&aiff, &info, total, 100, 10).unwrap();

        // A browser is handed WAV, whatever the take was stored as.
        assert_eq!(&window[0..4], b"RIFF");
        assert_eq!(&window[8..12], b"WAVE");
        assert_eq!(window.len(), 44 + 10 * 4);
        // And the sample values are the source's own, in the order WAV expects.
        let first = i16::from_le_bytes([window[44], window[45]]);
        let second = i16::from_le_bytes([window[46], window[47]]);
        assert_eq!(first, 100);
        assert_eq!(second, -100);
    }

    #[test]
    fn the_same_audio_in_either_container_reads_identically() {
        // The strongest statement available without hardware: a take's waveform does
        // not depend on which of the two containers it arrived in.
        let fixture = Fixture::new("aiff-parity");
        let wav = fixture.wav("take.wav", 2, 400);
        let aiff = fixture.aiff("take.aif", 2, 400);
        let (wav_info, wav_total) = header(&wav);
        let (aiff_info, aiff_total) = header(&aiff);

        let from_wav = window_bytes(&wav, &wav_info, wav_total, 7, 32).unwrap();
        let from_aiff = window_bytes(&aiff, &aiff_info, aiff_total, 7, 32).unwrap();
        assert_eq!(from_wav, from_aiff, "the same frames, byte for byte");

        let wav_peaks = compute_peaks(&wav, &wav_info, wav_total, "hash-wav", 16).unwrap();
        let aiff_peaks = compute_peaks(&aiff, &aiff_info, aiff_total, "hash-aiff", 16).unwrap();
        assert_eq!(wav_peaks.min, aiff_peaks.min);
        assert_eq!(wav_peaks.max, aiff_peaks.max);
        assert_eq!(wav_peaks.frames, aiff_peaks.frames);
    }

    #[test]
    fn swaps_sample_bytes_without_changing_the_values() {
        let mut sixteen = vec![0x01, 0x02, 0xff, 0xfe];
        to_little_endian(&mut sixteen, 16);
        assert_eq!(sixteen, vec![0x02, 0x01, 0xfe, 0xff]);

        let mut twenty_four = vec![0x01, 0x02, 0x03];
        to_little_endian(&mut twenty_four, 24);
        assert_eq!(twenty_four, vec![0x03, 0x02, 0x01]);

        let mut float = 0.25f32.to_be_bytes().to_vec();
        to_little_endian(&mut float, 32);
        assert_eq!(float, 0.25f32.to_le_bytes().to_vec());

        // Eight-bit is re-centred, not reversed: AIFF stores it signed, WAV unsigned.
        let mut eight = vec![0u8, 0x40, 0x80];
        to_little_endian(&mut eight, 8);
        assert_eq!(eight, vec![128, 192, 0]);
    }

    #[test]
    fn reads_both_byte_orders_of_every_encoding() {
        assert!((sample_at(&[0x40, 0x00], 0, 16, false, true) - 0.5).abs() < 1e-6);
        assert!((sample_at(&[0xc0, 0x00], 0, 16, false, true) + 0.5).abs() < 1e-6);
        assert!((sample_at(&[0x40, 0x00, 0x00], 0, 24, false, true) - 0.5).abs() < 1e-6);
        assert!((sample_at(&[0x40, 0, 0, 0], 0, 32, false, true) - 0.5).abs() < 1e-6);
        assert!((sample_at(&0.25f32.to_be_bytes(), 0, 32, true, true) - 0.25).abs() < 1e-6);
        assert!((sample_at(&0.75f64.to_be_bytes(), 0, 64, true, true) - 0.75).abs() < 1e-6);
        // Signed in AIFF, unsigned in WAV: the same byte is a different number.
        assert!((sample_at(&[0x40], 0, 8, false, true) - 0.5).abs() < 1e-6);
        assert!((sample_at(&[0x40], 0, 8, false, false) + 0.5).abs() < 1e-6);
    }
}
