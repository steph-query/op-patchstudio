//! Split a multichannel recording into stereo-pair stems while it streams.
//!
//! The TP-7 records up to three stereo tracks into one interleaved WAV, and
//! owners currently split those by hand in a DAW. Doing it as the bytes arrive
//! means a full-length take is never held in memory, which is the only reason
//! the in-app 128 MB limit existed. Sample values are copied verbatim: the
//! stems carry the source's exact bit depth and sample rate, and no container
//! metadata beyond the canonical header is invented.

use crate::{backup, DeviceState};
use mtp_rs::ptp::ObjectHandle;
use serde::Serialize;
use std::fs;
use std::io::{Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use tauri::State;

const FORMAT_PCM: u16 = 1;
const FORMAT_FLOAT: u16 = 3;
const FORMAT_EXTENSIBLE: u16 = 0xfffe;
/// A header this large is not a recording we understand; refuse rather than buffer forever.
const MAX_HEADER_BYTES: usize = 1024 * 1024;
const HEADER_LENGTH: u64 = 44;

#[derive(Debug, Clone, PartialEq)]
pub struct WavInfo {
    pub format: u16,
    pub channels: u16,
    pub sample_rate: u32,
    pub bits: u16,
    pub block_align: u16,
    /// Byte offset of the first audio frame.
    pub data_offset: usize,
    /// Declared length of the data chunk, when the file states one.
    pub data_len: Option<u64>,
    /// True when sample bytes are big-endian, as in AIFF. WAV is always false.
    pub big_endian: bool,
}

fn u16_at(bytes: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_at(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]])
}

/// Bit depths the app can actually turn into samples.
///
/// `localaudio::sample_at` decodes 8/16/24/32-bit integers and 32/64-bit floats.
/// Accepting anything else parses a file that then reads as pure silence, with no
/// error to explain it — a worse outcome than refusing it by name.
fn decodable(tag: u16, bits: u16) -> bool {
    if tag == FORMAT_FLOAT {
        return bits == 32 || bits == 64;
    }
    matches!(bits, 8 | 16 | 24 | 32)
}

/// Parse a RIFF header from a possibly incomplete prefix.
/// `Ok(None)` means "not enough bytes yet"; `Err` means this is not a file we can split.
pub fn parse_wav_header(bytes: &[u8]) -> Result<Option<WavInfo>, String> {
    if bytes.len() < 12 {
        return Ok(None);
    }
    if &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return Err("This file is not a WAV recording.".into());
    }
    let mut offset = 12usize;
    let mut format: Option<(u16, u16, u32, u16, u16)> = None;
    loop {
        if offset + 8 > bytes.len() {
            if bytes.len() > MAX_HEADER_BYTES {
                return Err("This WAV has no audio data chunk where one is expected.".into());
            }
            return Ok(None);
        }
        let id = &bytes[offset..offset + 4];
        let size = u32_at(bytes, offset + 4) as usize;
        let body = offset + 8;
        if id == b"fmt " {
            if size < 16 {
                return Err("This WAV's format chunk is too short to describe its audio.".into());
            }
            if body + size.min(40) > bytes.len() {
                return Ok(None);
            }
            let mut tag = u16_at(bytes, body);
            let channels = u16_at(bytes, body + 2);
            let sample_rate = u32_at(bytes, body + 4);
            let block_align = u16_at(bytes, body + 12);
            let bits = u16_at(bytes, body + 14);
            if tag == FORMAT_EXTENSIBLE {
                if size < 40 || body + 26 > bytes.len() {
                    return Err("This WAV uses an extended format this app cannot read.".into());
                }
                tag = u16_at(bytes, body + 24);
            }
            if tag != FORMAT_PCM && tag != FORMAT_FLOAT {
                return Err("This recording is compressed, so it cannot be split without re-encoding.".into());
            }
            if channels == 0 || channels > 32 || sample_rate == 0 {
                return Err("This WAV's format values are outside what this app can split.".into());
            }
            if !decodable(tag, bits) {
                return Err(format!("This WAV's {bits}-bit samples are not a depth this app can read."));
            }
            if block_align as usize != channels as usize * (bits as usize / 8) {
                return Err("This WAV's frame size does not match its channel count.".into());
            }
            format = Some((tag, channels, sample_rate, bits, block_align));
        } else if id == b"data" {
            let Some((format, channels, sample_rate, bits, block_align)) = format else {
                return Err("This WAV describes its audio after the audio itself, which this app cannot stream.".into());
            };
            let data_len = if size == 0 || size == u32::MAX as usize { None } else { Some(size as u64) };
            return Ok(Some(WavInfo { format, channels, sample_rate, bits, block_align, data_offset: body, data_len, big_endian: false }));
        }
        // Chunks are padded to even lengths.
        offset = body + size + (size % 2);
    }
}


fn u16_be(bytes: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([bytes[offset], bytes[offset + 1]])
}

fn u32_be(bytes: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]])
}

/// The 80-bit IEEE 754 extended float AIFF uses for its sample rate.
/// Returns 0 for values that are not a plausible rate, which the caller rejects.
fn extended_float(bytes: &[u8], offset: usize) -> u32 {
    let exponent = i32::from(u16_be(bytes, offset) & 0x7fff);
    let mantissa = u64::from_be_bytes([
        bytes[offset + 2], bytes[offset + 3], bytes[offset + 4], bytes[offset + 5],
        bytes[offset + 6], bytes[offset + 7], bytes[offset + 8], bytes[offset + 9],
    ]);
    if exponent == 0 && mantissa == 0 {
        return 0;
    }
    // value = mantissa × 2^(exponent − 16383 − 63)
    let shift = exponent - 16383 - 63;
    let value = if shift >= 0 {
        (mantissa as f64) * 2f64.powi(shift)
    } else {
        (mantissa as f64) / 2f64.powi(-shift)
    };
    if value <= 0.0 || value > 1_000_000.0 { 0 } else { value.round() as u32 }
}

/// Parse an AIFF or AIFC header from a possibly incomplete prefix.
/// `Ok(None)` means "not enough bytes yet".
pub fn parse_aiff_header(bytes: &[u8]) -> Result<Option<WavInfo>, String> {
    if bytes.len() < 12 {
        return Ok(None);
    }
    if &bytes[0..4] != b"FORM" || (&bytes[8..12] != b"AIFF" && &bytes[8..12] != b"AIFC") {
        return Err("This file is not an AIFF recording.".into());
    }
    let mut offset = 12usize;
    // format, channels, sample rate, bits, frame size, and sample byte order.
    let mut common: Option<(u16, u16, u32, u16, u16, bool)> = None;
    loop {
        if offset + 8 > bytes.len() {
            if bytes.len() > MAX_HEADER_BYTES {
                return Err("This AIFF has no sound data chunk where one is expected.".into());
            }
            return Ok(None);
        }
        let id = &bytes[offset..offset + 4];
        let size = u32_be(bytes, offset + 4) as usize;
        let body = offset + 8;
        if id == b"COMM" {
            if size < 18 {
                return Err("This AIFF's description of its audio is too short to read.".into());
            }
            if body + size.min(23) > bytes.len() {
                return Ok(None);
            }
            let channels = u16_be(bytes, body);
            let bits = u16_be(bytes, body + 6);
            let sample_rate = extended_float(bytes, body + 8);
            // AIFC names its encoding; AIFF is always uncompressed big-endian PCM.
            let (format, big_endian) = if size >= 22 && &bytes[8..12] == b"AIFC" {
                match &bytes[body + 18..body + 22] {
                    b"NONE" => (FORMAT_PCM, true),
                    // `sowt` is the same PCM with the bytes the other way round.
                    b"sowt" => (FORMAT_PCM, false),
                    b"fl32" | b"FL32" | b"fl64" | b"FL64" => (FORMAT_FLOAT, true),
                    other => {
                        let name = String::from_utf8_lossy(other).to_string();
                        return Err(format!("This AIFF is compressed ({name}), which this app cannot read. Export it as uncompressed audio first."));
                    }
                }
            } else {
                (FORMAT_PCM, true)
            };
            if channels == 0 || channels > 64 {
                return Err("This AIFF's channel count is not one this app can read.".into());
            }
            if sample_rate == 0 {
                return Err("This AIFF does not state a sample rate this app can read.".into());
            }
            if !decodable(format, bits) {
                return Err(format!("This AIFF's {bits}-bit samples are not a depth this app can read."));
            }
            common = Some((format, channels, sample_rate, bits, channels * (bits / 8), big_endian));
        } else if id == b"SSND" {
            let Some((format, channels, sample_rate, bits, block_align, big_endian)) = common else {
                return Err("This AIFF describes its audio after the audio itself, which this app cannot read.".into());
            };
            if body + 8 > bytes.len() {
                return Ok(None);
            }
            // Sound data begins after the chunk's own offset and blockSize fields,
            // plus whatever padding the offset field declares.
            let padding = u32_be(bytes, body) as usize;
            let data_offset = body + 8 + padding;
            let data_len = (size as u64).checked_sub(8 + padding as u64).filter(|length| *length > 0);
            return Ok(Some(WavInfo {
                format,
                channels,
                sample_rate,
                bits,
                block_align,
                data_offset,
                data_len,
                big_endian,
            }));
        }
        offset = body + size + (size % 2);
    }
}

/// Parse whichever of the two containers this file is.
///
/// Devices write WAV (TP-7, OP-XY) or AIFF (OP-1 field); anything else is named as
/// unreadable rather than reported as a broken WAV.
pub fn parse_audio_header(bytes: &[u8]) -> Result<Option<WavInfo>, String> {
    if bytes.len() < 4 {
        return Ok(None);
    }
    match &bytes[0..4] {
        b"FORM" => parse_aiff_header(bytes),
        b"RIFF" => parse_wav_header(bytes),
        _ => Err("This take is not a WAV or AIFF recording, so this app cannot read its audio.".into()),
    }
}

/// How the source channels are grouped: stereo pairs, with a final mono stem for an odd channel.
pub fn stem_layout(channels: u16) -> Vec<u16> {
    let mut layout = Vec::new();
    let mut left = channels;
    while left > 0 {
        let take = left.min(2);
        layout.push(take);
        left -= take;
    }
    layout
}

fn write_header<W: Write>(writer: &mut W, info: &WavInfo, channels: u16) -> Result<(), String> {
    let block_align = channels * (info.bits / 8);
    let mut header = Vec::with_capacity(HEADER_LENGTH as usize);
    header.extend_from_slice(b"RIFF");
    header.extend_from_slice(&0u32.to_le_bytes()); // patched by finish()
    header.extend_from_slice(b"WAVEfmt ");
    header.extend_from_slice(&16u32.to_le_bytes());
    header.extend_from_slice(&info.format.to_le_bytes());
    header.extend_from_slice(&channels.to_le_bytes());
    header.extend_from_slice(&info.sample_rate.to_le_bytes());
    header.extend_from_slice(&(info.sample_rate * block_align as u32).to_le_bytes());
    header.extend_from_slice(&block_align.to_le_bytes());
    header.extend_from_slice(&info.bits.to_le_bytes());
    header.extend_from_slice(b"data");
    header.extend_from_slice(&0u32.to_le_bytes()); // patched by finish()
    writer.write_all(&header).map_err(|e| e.to_string())
}

struct Stem<W> {
    channels: u16,
    /// Byte offset of this stem's first channel within a source frame.
    offset: usize,
    width: usize,
    writer: W,
    bytes: u64,
}

/// Feeds arbitrary byte chunks in and writes complete frames out, carrying partial frames over.
pub struct StemSplitter<W: Write + Seek> {
    info: WavInfo,
    stems: Vec<Stem<W>>,
    pending: Vec<u8>,
    frames: u64,
    data_remaining: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq)]
pub struct StemSummary {
    pub index: usize,
    pub channels: u16,
    pub bytes: u64,
}

impl<W: Write + Seek> StemSplitter<W> {
    /// `writers` must be one sink per entry of `stem_layout(info.channels)`.
    pub fn new(info: WavInfo, writers: Vec<W>) -> Result<Self, String> {
        let layout = stem_layout(info.channels);
        if writers.len() != layout.len() {
            return Err("Internal error: one output is required per stem.".into());
        }
        let sample_bytes = info.bits as usize / 8;
        let mut offset = 0usize;
        let mut stems = Vec::new();
        for (channels, mut writer) in layout.into_iter().zip(writers) {
            write_header(&mut writer, &info, channels)?;
            let width = channels as usize * sample_bytes;
            stems.push(Stem { channels, offset, width, writer, bytes: 0 });
            offset += width;
        }
        let data_remaining = info.data_len;
        Ok(Self { info, stems, pending: Vec::new(), frames: 0, data_remaining })
    }

    /// Accept the next slice of source audio. Bytes past the declared data chunk are ignored.
    pub fn push(&mut self, data: &[u8]) -> Result<(), String> {
        let mut input = data;
        if let Some(remaining) = self.data_remaining {
            if remaining == 0 {
                return Ok(());
            }
            let take = (remaining as usize).min(input.len());
            input = &input[..take];
            self.data_remaining = Some(remaining - take as u64);
        }
        let align = self.info.block_align as usize;
        if self.pending.is_empty() {
            let whole = input.len() - input.len() % align;
            self.write_frames(&input[..whole])?;
            self.pending.extend_from_slice(&input[whole..]);
        } else {
            self.pending.extend_from_slice(input);
            let buffered = std::mem::take(&mut self.pending);
            let whole = buffered.len() - buffered.len() % align;
            self.write_frames(&buffered[..whole])?;
            self.pending.extend_from_slice(&buffered[whole..]);
        }
        Ok(())
    }

    fn write_frames(&mut self, frames: &[u8]) -> Result<(), String> {
        for frame in frames.chunks_exact(self.info.block_align as usize) {
            for stem in &mut self.stems {
                stem.writer.write_all(&frame[stem.offset..stem.offset + stem.width]).map_err(|e| e.to_string())?;
                stem.bytes += stem.width as u64;
            }
            self.frames += 1;
        }
        Ok(())
    }

    /// Patch the RIFF and data lengths and flush, returning the sinks so a caller can inspect them.
    /// A trailing partial frame is discarded rather than padded into audible noise.
    pub fn finish(mut self) -> Result<(Vec<StemSummary>, Vec<W>), String> {
        let mut summaries = Vec::new();
        for (index, stem) in self.stems.iter_mut().enumerate() {
            let data_len = u32::try_from(stem.bytes).map_err(|_| "A stem exceeded the 4 GB WAV limit.".to_string())?;
            stem.writer.seek(SeekFrom::Start(4)).map_err(|e| e.to_string())?;
            stem.writer.write_all(&(data_len + 36).to_le_bytes()).map_err(|e| e.to_string())?;
            stem.writer.seek(SeekFrom::Start(40)).map_err(|e| e.to_string())?;
            stem.writer.write_all(&data_len.to_le_bytes()).map_err(|e| e.to_string())?;
            stem.writer.flush().map_err(|e| e.to_string())?;
            summaries.push(StemSummary { index: index + 1, channels: stem.channels, bytes: HEADER_LENGTH + stem.bytes });
        }
        Ok((summaries, self.stems.into_iter().map(|stem| stem.writer).collect()))
    }

    pub fn frames(&self) -> u64 {
        self.frames
    }
}

#[derive(Serialize)]
pub struct StemExport {
    /// Folder the stems were written to.
    pub path: String,
    pub stems: Vec<StemSummary>,
    pub frames: u64,
    pub source_channels: u16,
    pub sample_rate: u32,
    pub bits: u16,
    pub is_float: bool,
}

fn remove_folder(path: &Path) {
    let _ = fs::remove_dir_all(path);
}

/// Stream one device recording into per-track stem files inside a folder the user picks.
/// Nothing is overwritten: the destination folder must not already exist.
#[tauri::command]
pub async fn export_device_stems(
    state: State<'_, DeviceState>,
    handle: u32,
    name: String,
    size: u64,
) -> Result<Option<StemExport>, String> {
    let guard = state.device.lock().await;
    let Some(folder) = rfd::AsyncFileDialog::new().set_title("Choose where to save the stems").pick_folder().await else { return Ok(None); };
    let root = folder.path().to_path_buf();
    state.approved_folders.lock().map_err(|_| "Folder registry unavailable")?.insert(root.clone());

    let device = guard.as_ref().ok_or("No device connected")?;
    let storages = device.storages().await.map_err(|e| e.to_string())?;
    let storage = storages.first().ok_or("No storage found")?;

    let destination: PathBuf = backup::safe_join(&root, &format!("{name} stems"))?;
    fs::create_dir(&destination).map_err(|error| {
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            format!("{} already exists; rename or move it first.", destination.display())
        } else {
            error.to_string()
        }
    })?;

    let result = stream_stems(storage, handle, size, &destination).await;
    match result {
        Ok(export) => Ok(Some(export)),
        Err(error) => {
            remove_folder(&destination);
            Err(error)
        }
    }
}

async fn stream_stems(
    storage: &mtp_rs::mtp::Storage,
    handle: u32,
    size: u64,
    destination: &Path,
) -> Result<StemExport, String> {
    let mut download = storage.download_stream(ObjectHandle(handle)).await.map_err(|e| e.to_string())?;
    let mut header = Vec::new();
    let mut splitter: Option<StemSplitter<std::io::BufWriter<fs::File>>> = None;
    let mut info: Option<WavInfo> = None;
    let mut received = 0u64;

    while let Some(chunk) = download.next_chunk().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                let _ = download.cancel(std::time::Duration::from_secs(2)).await;
                return Err(error.to_string());
            }
        };
        received += chunk.len() as u64;
        match splitter.as_mut() {
            Some(splitter) => splitter.push(&chunk)?,
            None => {
                header.extend_from_slice(&chunk);
                if let Some(parsed) = parse_wav_header(&header)? {
                    let layout = stem_layout(parsed.channels);
                    if layout.len() < 2 {
                        let _ = download.cancel(std::time::Duration::from_secs(2)).await;
                        return Err(format!(
                            "This recording has {} channel(s), so there is nothing to separate. Use Export to save the original file.",
                            parsed.channels
                        ));
                    }
                    let mut writers = Vec::new();
                    for index in 1..=layout.len() {
                        let path = destination.join(format!("track-{index}.wav"));
                        let file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
                        writers.push(std::io::BufWriter::new(file));
                    }
                    let mut started = StemSplitter::new(parsed.clone(), writers)?;
                    // Audio already buffered while looking for the header still has to be split.
                    started.push(&header[parsed.data_offset..])?;
                    info = Some(parsed);
                    splitter = Some(started);
                }
            }
        }
    }

    let Some(splitter) = splitter else {
        return Err("This recording ended before its audio data began.".into());
    };
    if received != size {
        return Err("The recording changed size during the transfer. Refresh the device and try again.".into());
    }
    let info = info.ok_or("Internal error: missing audio format")?;
    let frames = splitter.frames();
    let (stems, _sinks) = splitter.finish()?;
    Ok(StemExport {
        path: destination.display().to_string(),
        stems,
        frames,
        source_channels: info.channels,
        sample_rate: info.sample_rate,
        bits: info.bits,
        is_float: info.format == FORMAT_FLOAT,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn wav(channels: u16, bits: u16, frames: usize, declared: Option<u32>) -> Vec<u8> {
        let block_align = channels * (bits / 8);
        let data_len = frames * block_align as usize;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&((36 + data_len) as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&FORMAT_PCM.to_le_bytes());
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&44100u32.to_le_bytes());
        bytes.extend_from_slice(&(44100 * block_align as u32).to_le_bytes());
        bytes.extend_from_slice(&block_align.to_le_bytes());
        bytes.extend_from_slice(&bits.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&declared.unwrap_or(data_len as u32).to_le_bytes());
        // Each sample byte encodes its channel so the split can be checked exactly.
        for frame in 0..frames {
            for channel in 0..channels {
                for byte in 0..(bits / 8) {
                    bytes.push(((channel as usize + 1) * 16 + frame % 7 + byte as usize) as u8);
                }
            }
        }
        bytes
    }

    /// Feed a source through the splitter in fixed-size chunks and return the finished stem files.
    fn split(source: &[u8], chunk_size: usize) -> (Vec<Vec<u8>>, u64) {
        let info = parse_wav_header(source).unwrap().unwrap();
        let writers: Vec<Cursor<Vec<u8>>> = stem_layout(info.channels).iter().map(|_| Cursor::new(Vec::new())).collect();
        let data_offset = info.data_offset;
        let mut splitter = StemSplitter::new(info, writers).unwrap();
        for chunk in source[data_offset..].chunks(chunk_size.max(1)) {
            splitter.push(chunk).unwrap();
        }
        let frames = splitter.frames();
        let (_, sinks) = splitter.finish().unwrap();
        (sinks.into_iter().map(|sink| sink.into_inner()).collect(), frames)
    }

    #[test]
    fn parses_a_canonical_header() {
        let info = parse_wav_header(&wav(6, 24, 10, None)).unwrap().unwrap();
        assert_eq!(info.channels, 6);
        assert_eq!(info.bits, 24);
        assert_eq!(info.block_align, 18);
        assert_eq!(info.sample_rate, 44100);
        assert_eq!(info.data_len, Some(180));
        assert_eq!(info.data_offset, 44);
    }

    #[test]
    fn asks_for_more_bytes_instead_of_guessing() {
        let source = wav(4, 16, 4, None);
        assert_eq!(parse_wav_header(&source[..8]).unwrap(), None);
        assert_eq!(parse_wav_header(&source[..30]).unwrap(), None);
        assert!(parse_wav_header(&source[..44]).unwrap().is_some());
    }

    #[test]
    fn rejects_files_it_must_not_reinterpret() {
        assert!(parse_wav_header(b"FORM____AIFFCOMM").is_err());
        let mut compressed = wav(2, 16, 2, None);
        compressed[20] = 0x11; // IMA ADPCM
        assert!(parse_wav_header(&compressed).unwrap_err().contains("compressed"));
        let mut mismatched = wav(2, 16, 2, None);
        mismatched[32] = 9; // block align that disagrees with channels × depth
        assert!(parse_wav_header(&mismatched).unwrap_err().contains("frame size"));
    }

    #[test]
    fn groups_channels_into_pairs_with_a_mono_remainder() {
        assert_eq!(stem_layout(6), vec![2, 2, 2]);
        assert_eq!(stem_layout(5), vec![2, 2, 1]);
        assert_eq!(stem_layout(2), vec![2]);
        assert_eq!(stem_layout(1), vec![1]);
    }

    #[test]
    fn splits_identically_whatever_the_chunk_boundaries() {
        let source = wav(6, 24, 50, None);
        let (reference, frames) = split(&source, usize::MAX);
        assert_eq!(frames, 50);
        for chunk_size in [1, 7, 17, 18, 19, 180, 999] {
            let (stems, frames) = split(&source, chunk_size);
            assert_eq!(frames, 50, "frames at chunk size {chunk_size}");
            assert_eq!(stems, reference, "stem bytes at chunk size {chunk_size}");
        }
    }

    #[test]
    fn copies_each_channel_pair_verbatim() {
        let source = wav(6, 16, 3, None);
        let (stems, _) = split(&source, 5);
        assert_eq!(stems.len(), 3);
        let audio = &source[44..];
        for (index, stem) in stems.iter().enumerate() {
            assert_eq!(&stem[..4], b"RIFF");
            assert_eq!(&stem[8..12], b"WAVE");
            let body = &stem[44..];
            assert_eq!(body.len(), 3 * 4, "stereo pair of 16-bit frames");
            for frame in 0..3 {
                let source_frame = &audio[frame * 12..(frame + 1) * 12];
                let expected = &source_frame[index * 4..index * 4 + 4];
                assert_eq!(&body[frame * 4..frame * 4 + 4], expected);
            }
        }
    }

    #[test]
    fn stops_at_the_declared_data_length_and_drops_a_partial_frame() {
        // Declare fewer bytes than are present: trailing chunks must not become audio.
        let mut source = wav(4, 16, 10, Some(8 * 8));
        source.extend_from_slice(b"LIST____trailing");
        let (stems, frames) = split(&source, 3);
        assert_eq!(frames, 8);
        for stem in &stems {
            assert_eq!(stem.len(), 44 + 8 * 4);
        }

        let mut truncated = wav(4, 16, 4, None);
        truncated.truncate(truncated.len() - 3); // leave an incomplete final frame
        let (stems, frames) = split(&truncated, 5);
        assert_eq!(frames, 3, "an incomplete frame is discarded, never padded");
        assert_eq!(stems[0].len(), 44 + 3 * 4);
    }

    #[test]
    fn patches_riff_and_data_lengths_on_finish() {
        let source = wav(4, 16, 6, None);
        let info = parse_wav_header(&source).unwrap().unwrap();
        let writers: Vec<Cursor<Vec<u8>>> = vec![Cursor::new(Vec::new()), Cursor::new(Vec::new())];
        let mut splitter = StemSplitter::new(info, writers).unwrap();
        splitter.push(&source[44..]).unwrap();
        let (summaries, sinks) = splitter.finish().unwrap();
        assert_eq!(summaries, vec![
            StemSummary { index: 1, channels: 2, bytes: 44 + 24 },
            StemSummary { index: 2, channels: 2, bytes: 44 + 24 },
        ]);
        for sink in sinks {
            let bytes = sink.into_inner();
            assert_eq!(bytes.len(), 44 + 24);
            assert_eq!(u32_at(&bytes, 4), 36 + 24, "RIFF length");
            assert_eq!(u32_at(&bytes, 40), 24, "data length");
            assert_eq!(u16_at(&bytes, 22), 2, "stereo output");
            assert_eq!(u32_at(&bytes, 24), 44100, "sample rate preserved");
            assert_eq!(u16_at(&bytes, 34), 16, "bit depth preserved");
        }
    }

    #[test]
    fn refuses_more_outputs_than_the_layout_needs() {
        let info = parse_wav_header(&wav(4, 16, 1, None)).unwrap().unwrap();
        let writers: Vec<Cursor<Vec<u8>>> = vec![Cursor::new(Vec::new())];
        let error = match StemSplitter::new(info, writers) { Err(error) => error, Ok(_) => panic!("expected a refusal") };
        assert!(error.contains("one output is required"));
    }

    /// Build an AIFF/AIFC header with a chosen compression type and payload length.
    fn aiff_header(form: &[u8; 4], compression: Option<&[u8; 4]>, frames: u32, data_len: u32) -> Vec<u8> {
        aiff_header_bits(form, compression, frames, data_len, 16)
    }

    /// As above, with an explicit sample size — a float encoding must declare one
    /// that matches, or it is contradicting itself.
    fn aiff_header_bits(form: &[u8; 4], compression: Option<&[u8; 4]>, frames: u32, data_len: u32, bits: u16) -> Vec<u8> {
        let comm_size = if compression.is_some() { 22u32 } else { 18 };
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"FORM");
        bytes.extend_from_slice(&(4 + 8 + comm_size + 8 + 8 + data_len).to_be_bytes());
        bytes.extend_from_slice(form);
        bytes.extend_from_slice(b"COMM");
        bytes.extend_from_slice(&comm_size.to_be_bytes());
        bytes.extend_from_slice(&2u16.to_be_bytes());
        bytes.extend_from_slice(&frames.to_be_bytes());
        bytes.extend_from_slice(&bits.to_be_bytes());
        bytes.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
        if let Some(name) = compression {
            bytes.extend_from_slice(name);
        }
        bytes.extend_from_slice(b"SSND");
        bytes.extend_from_slice(&(8 + data_len).to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend(std::iter::repeat(0u8).take(data_len as usize));
        bytes
    }

    /// A WAV header with a chosen tag and sample size, to check what is accepted.
    fn wav_header(tag: u16, bits: u16, channels: u16) -> Vec<u8> {
        let align = channels * (bits / 8);
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&36u32.to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&tag.to_le_bytes());
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&44_100u32.to_le_bytes());
        bytes.extend_from_slice(&(44_100 * align as u32).to_le_bytes());
        bytes.extend_from_slice(&align.to_le_bytes());
        bytes.extend_from_slice(&bits.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&0u32.to_le_bytes());
        bytes
    }

    #[test]
    fn refuses_a_sample_depth_it_would_only_render_as_silence() {
        // `sample_at` decodes 8/16/24/32-bit integers and 32/64-bit floats. Anything
        // else used to parse happily and then read as zeros, with nothing to explain
        // why a recording was silent.
        for bits in [8u16, 16, 24, 32] {
            assert!(parse_wav_header(&wav_header(FORMAT_PCM, bits, 2)).unwrap().is_some(), "{bits}-bit pcm");
        }
        for bits in [40u16, 48, 56, 64, 128] {
            let error = parse_wav_header(&wav_header(FORMAT_PCM, bits, 2)).unwrap_err();
            assert!(error.contains(&format!("{bits}-bit samples")), "{bits}-bit: {error}");
        }
        // Float is the other way round: 32 and 64 only.
        assert!(parse_wav_header(&wav_header(FORMAT_FLOAT, 32, 1)).unwrap().is_some());
        assert!(parse_wav_header(&wav_header(FORMAT_FLOAT, 64, 1)).unwrap().is_some());
        for bits in [8u16, 16, 24] {
            assert!(parse_wav_header(&wav_header(FORMAT_FLOAT, bits, 1)).is_err(), "{bits}-bit float");
        }
    }

    #[test]
    fn reads_an_aiff_header() {
        let info = parse_aiff_header(&aiff_header(b"AIFF", None, 100, 400)).unwrap().unwrap();
        assert_eq!(info.channels, 2);
        assert_eq!(info.sample_rate, 44_100);
        assert_eq!(info.bits, 16);
        assert_eq!(info.block_align, 4);
        assert_eq!(info.data_len, Some(400));
        assert!(info.big_endian);
        assert_eq!(info.format, FORMAT_PCM);
    }

    #[test]
    fn reads_the_eighty_bit_sample_rates_devices_actually_write() {
        // 44100, 48000, 22050 and 96000 as AIFF stores them.
        let rates: [(u32, [u8; 10]); 4] = [
            (44_100, [0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]),
            (48_000, [0x40, 0x0e, 0xbb, 0x80, 0, 0, 0, 0, 0, 0]),
            (22_050, [0x40, 0x0d, 0xac, 0x44, 0, 0, 0, 0, 0, 0]),
            (96_000, [0x40, 0x0f, 0xbb, 0x80, 0, 0, 0, 0, 0, 0]),
        ];
        for (expected, encoded) in rates {
            assert_eq!(extended_float(&encoded, 0), expected, "{expected} hz");
        }
        // Nonsense, rather than a rate: reported as unreadable instead of guessed at.
        assert_eq!(extended_float(&[0u8; 10], 0), 0);
    }

    #[test]
    fn reads_aifc_byte_order_from_its_compression_name() {
        let plain = parse_aiff_header(&aiff_header(b"AIFC", Some(b"NONE"), 100, 400)).unwrap().unwrap();
        assert!(plain.big_endian, "NONE is big-endian PCM");
        // `sowt` is the same PCM with the bytes the other way round — reading it as
        // big-endian would turn a recording into noise.
        let swapped = parse_aiff_header(&aiff_header(b"AIFC", Some(b"sowt"), 100, 400)).unwrap().unwrap();
        assert!(!swapped.big_endian);
        let float = parse_aiff_header(&aiff_header_bits(b"AIFC", Some(b"fl32"), 100, 400, 32)).unwrap().unwrap();
        assert_eq!(float.format, FORMAT_FLOAT);
        assert_eq!(float.bits, 32);
        // A float encoding that declares 16-bit samples contradicts itself, and would
        // otherwise have been read as silence rather than refused.
        let error = parse_aiff_header(&aiff_header_bits(b"AIFC", Some(b"fl32"), 100, 400, 16)).unwrap_err();
        assert!(error.contains("16-bit samples are not a depth"), "{error}");
    }

    #[test]
    fn says_so_plainly_when_an_aiff_is_compressed() {
        let error = parse_aiff_header(&aiff_header(b"AIFC", Some(b"ima4"), 100, 400)).unwrap_err();
        assert!(error.contains("compressed (ima4)"), "{error}");
        assert!(error.contains("Export it as uncompressed audio first"), "{error}");
    }

    #[test]
    fn refuses_what_is_not_an_aiff_and_waits_for_what_is_incomplete() {
        assert!(parse_aiff_header(b"RIFF\0\0\0\0WAVE").unwrap_err().contains("not an AIFF"));
        // Too short to tell yet: ask for more rather than guessing.
        assert_eq!(parse_aiff_header(b"FORM").unwrap(), None);
        let full = aiff_header(b"AIFF", None, 100, 400);
        assert_eq!(parse_aiff_header(&full[..20]).unwrap(), None);
    }

    #[test]
    fn refuses_an_aiff_whose_audio_comes_before_its_description() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"FORM");
        bytes.extend_from_slice(&100u32.to_be_bytes());
        bytes.extend_from_slice(b"AIFF");
        bytes.extend_from_slice(b"SSND");
        bytes.extend_from_slice(&16u32.to_be_bytes());
        bytes.extend_from_slice(&[0u8; 16]);
        assert!(parse_aiff_header(&bytes).unwrap_err().contains("after the audio itself"));
    }

    #[test]
    fn skips_the_chunks_between_and_honours_the_ssnd_offset() {
        let mut bytes = Vec::new();
        let data_len = 8u32;
        bytes.extend_from_slice(b"FORM");
        bytes.extend_from_slice(&64u32.to_be_bytes());
        bytes.extend_from_slice(b"AIFF");
        // An odd-length chunk in the middle, padded — as a real file's name or marker
        // chunk would be.
        bytes.extend_from_slice(b"NAME");
        bytes.extend_from_slice(&3u32.to_be_bytes());
        bytes.extend_from_slice(b"abc\0");
        bytes.extend_from_slice(b"COMM");
        bytes.extend_from_slice(&18u32.to_be_bytes());
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&4u32.to_be_bytes());
        bytes.extend_from_slice(&16u16.to_be_bytes());
        bytes.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]);
        bytes.extend_from_slice(b"SSND");
        bytes.extend_from_slice(&(8 + 2 + data_len).to_be_bytes());
        bytes.extend_from_slice(&2u32.to_be_bytes()); // an offset before the samples
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&[0xaa, 0xbb]);
        bytes.extend(std::iter::repeat(0u8).take(data_len as usize));

        let info = parse_aiff_header(&bytes).unwrap().unwrap();
        assert_eq!(info.channels, 1);
        // The samples start after the offset, not at the chunk body.
        assert_eq!(&bytes[info.data_offset..info.data_offset + 2], &[0u8, 0u8]);
        assert_eq!(info.data_len, Some(data_len as u64));
    }

    #[test]
    fn names_a_container_it_cannot_read_instead_of_blaming_the_wav() {
        // An mp3 is not a damaged WAV, and saying so sends the user looking in the
        // wrong place.
        let error = parse_audio_header(b"ID3\x03\0\0\0\0\0\0\0").unwrap_err();
        assert!(error.contains("not a WAV or AIFF recording"), "{error}");
        assert_eq!(parse_audio_header(b"RI").unwrap(), None);
    }

    #[test]
    fn picks_the_container_from_the_first_four_bytes() {
        let aiff = parse_audio_header(&aiff_header(b"AIFF", None, 100, 400)).unwrap().unwrap();
        assert!(aiff.big_endian);
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&36u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&44_100u32.to_le_bytes());
        wav.extend_from_slice(&176_400u32.to_le_bytes());
        wav.extend_from_slice(&4u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&0u32.to_le_bytes());
        let parsed = parse_audio_header(&wav).unwrap().unwrap();
        assert!(!parsed.big_endian);
        assert_eq!(parsed.channels, 2);
    }
}
