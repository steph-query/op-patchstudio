//! Teenage Engineering device knowledge: recognising devices, listing what is
//! plugged in, and the MIDI handshake that moves a TP-7 into MTP mode.
//!
//! The SysEx envelope below follows the format used by teenage engineering's
//! own web updater and documented by the open-source `tp7` CLI research
//! (https://github.com/totocaster/tp7/blob/main/docs/tp7-handshake.md).

use serde::Serialize;
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

/// USB vendor id assigned to teenage engineering.
pub const TE_VENDOR_ID: u16 = 0x2367;
/// Product id the TP-7 reports in audio/MIDI mode.
pub const TP7_PRODUCT_ID: u16 = 0x0019;

/// Recognise a device family from its MTP/USB product or model string.
pub fn classify(model: &str, product_id: Option<u16>) -> &'static str {
    let text = model.to_lowercase().replace(['\u{2013}', '\u{2014}'], "-");
    let words: Vec<&str> = text.split(|c: char| !c.is_alphanumeric()).collect();
    if text.contains("op-xy") || text.contains("opxy") || words.contains(&"xy") {
        return "op-xy";
    }
    if text.contains("tp-7") || text.contains("tp7") {
        return "tp-7";
    }
    if (text.contains("op-1") || text.contains("op1")) && text.contains("field") {
        return "op-1-field";
    }
    match product_id {
        Some(TP7_PRODUCT_ID) => "tp-7",
        _ => "unknown",
    }
}

/// Library root folders that a complete backup must contain for each family.
pub fn backup_roots(kind: &str) -> &'static [&'static str] {
    match kind {
        "op-xy" => &["projects", "presets", "samples"],
        "op-1-field" => &["drum", "synth", "tape", "album"],
        "tp-7" => &["recordings", "memo"],
        _ => &[],
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct AvailableDevice {
    /// Non-zero only when the device can be opened over MTP right now.
    pub location_id: u64,
    pub vendor_id: u16,
    pub product_id: u16,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial: Option<String>,
    pub kind: String,
    /// "mtp" when an MTP session can be opened, "usb" when the device is only visible on the bus.
    pub mode: String,
}

/// Everything on USB that looks like a TE device or an MTP device.
pub fn list_available() -> Result<Vec<AvailableDevice>, String> {
    let mtp = mtp_rs::mtp::MtpDevice::list_devices().map_err(|e| e.to_string())?;
    let mut result: Vec<AvailableDevice> = mtp
        .iter()
        .map(|d| AvailableDevice {
            location_id: d.location_id,
            vendor_id: d.vendor_id,
            product_id: d.product_id,
            manufacturer: d.manufacturer.clone(),
            product: d.product.clone(),
            serial: d.serial_number.clone(),
            kind: classify(d.product.as_deref().unwrap_or(""), Some(d.product_id)).into(),
            mode: "mtp".into(),
        })
        .collect();
    // TE devices that are plugged in but not in MTP mode yet, for example a TP-7 in audio/MIDI mode.
    use nusb::MaybeFuture;
    if let Ok(devices) = nusb::list_devices().wait() {
        for dev in devices {
            if dev.vendor_id() != TE_VENDOR_ID {
                continue;
            }
            let serial = dev.serial_number().map(String::from);
            let seen = result.iter().any(|d| {
                (serial.is_some() && d.serial == serial)
                    || (serial.is_none() && d.vendor_id == dev.vendor_id() && d.product_id == dev.product_id())
            });
            if seen {
                continue;
            }
            result.push(AvailableDevice {
                location_id: 0,
                vendor_id: dev.vendor_id(),
                product_id: dev.product_id(),
                manufacturer: dev.manufacturer_string().map(String::from),
                product: dev.product_string().map(String::from),
                serial,
                kind: classify(dev.product_string().unwrap_or(""), Some(dev.product_id())).into(),
                mode: "usb".into(),
            });
        }
    }
    Ok(result)
}

// --- Teenage Engineering SysEx ------------------------------------------------

const TE_MIDI_ID: [u8; 3] = [0x00, 0x20, 0x76];
const TE_MARKER: u8 = 0x40;
const FLAG_REQUEST: u8 = 0x40;
const FLAG_REQUEST_ID: u8 = 0x20;
const STATUS_OK: u8 = 0x00;
const STATUS_BAD_REQUEST: u8 = 0x03;
const COMMAND_GREET: u8 = 0x01;
const COMMAND_MODE: u8 = 0x04;
/// Mode payload accepted by current TP-7 firmware; older firmware may want the legacy value.
const MODE_MTP: [u8; 2] = [0x01, 0x03];
const MODE_MTP_LEGACY: [u8; 2] = [0x01, 0x02];
const DEFAULT_TP7_DEVICE_ID: u8 = 0x19;
const IDENTITY_REQUEST: [u8; 6] = [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7];

#[derive(Serialize, Clone, Debug, Default)]
pub struct Tp7SwitchReport {
    pub device_id: u8,
    pub product: Option<String>,
    pub mode: Option<String>,
    pub os_version: Option<String>,
    pub serial: Option<String>,
    pub payload: Vec<u8>,
}

#[derive(Debug, PartialEq)]
pub struct TeResponse {
    pub request_id: u16,
    pub command: u8,
    pub status: u8,
    pub data: Vec<u8>,
}

#[derive(Debug)]
enum TeError {
    Timeout(String),
    Rejected { command: u8, status: u8 },
    Transport(String),
}

impl std::fmt::Display for TeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TeError::Timeout(what) => write!(f, "Timed out {what}"),
            TeError::Rejected { command, status } => write!(f, "TP-7 rejected command 0x{command:02x} with status 0x{status:02x}"),
            TeError::Transport(message) => write!(f, "{message}"),
        }
    }
}

/// Pack 8-bit data into 7-bit-safe SysEx bytes: one header byte carries the high bits of the next seven bytes.
pub fn pack_7bit(data: &[u8]) -> Vec<u8> {
    let mut packed = Vec::with_capacity(data.len() + data.len().div_ceil(7));
    for chunk in data.chunks(7) {
        let mut high = 0u8;
        for (index, byte) in chunk.iter().enumerate() {
            high |= (byte >> 7) << index;
        }
        packed.push(high);
        packed.extend(chunk.iter().map(|byte| byte & 0x7f));
    }
    packed
}

pub fn unpack_7bit(data: &[u8]) -> Vec<u8> {
    let mut unpacked = Vec::with_capacity(data.len());
    for chunk in data.chunks(8) {
        let Some((high, rest)) = chunk.split_first() else { break; };
        for (index, byte) in rest.iter().enumerate() {
            unpacked.push((byte & 0x7f) | (((high >> index) & 0x01) << 7));
        }
    }
    unpacked
}

pub fn build_te_request(device_id: u8, request_id: u16, command: u8, payload: &[u8]) -> Vec<u8> {
    let mut message = vec![
        0xf0,
        TE_MIDI_ID[0],
        TE_MIDI_ID[1],
        TE_MIDI_ID[2],
        device_id,
        TE_MARKER,
        FLAG_REQUEST | FLAG_REQUEST_ID | (((request_id >> 7) & 0x1f) as u8),
        (request_id & 0x7f) as u8,
        command,
    ];
    message.extend(pack_7bit(payload));
    message.push(0xf7);
    message
}

/// Device id from a universal identity reply that carries the TE manufacturer id.
pub fn parse_identity_device_id(message: &[u8]) -> Option<u8> {
    if message.len() < 9
        || message[0] != 0xf0
        || message[1] != 0x7e
        || message[3] != 0x06
        || message[4] != 0x02
        || message[5..8] != TE_MIDI_ID
        || *message.last()? != 0xf7
    {
        return None;
    }
    Some(message[2])
}

pub fn parse_te_response(message: &[u8]) -> Option<TeResponse> {
    if message.len() < 11
        || message[0] != 0xf0
        || message[1..4] != TE_MIDI_ID
        || message[5] != TE_MARKER
        || *message.last()? != 0xf7
        || message[6] & FLAG_REQUEST != 0
        || message[6] & FLAG_REQUEST_ID == 0
    {
        return None;
    }
    Some(TeResponse {
        request_id: (((message[6] & 0x1f) as u16) << 7) | (message[7] as u16 & 0x7f),
        command: message[8],
        status: message[9],
        data: unpack_7bit(&message[10..message.len() - 1]),
    })
}

/// The greet reply is "key:value;key:value" text, for example
/// `mode:normal;product:TP-7;sw_version:1.1.9;os_version:1.1.9;serial:F1RTL11C`.
pub fn parse_greet(data: &[u8], report: &mut Tp7SwitchReport) {
    let text = String::from_utf8_lossy(data);
    for field in text.split(';') {
        let Some((key, value)) = field.split_once(':') else { continue; };
        let value = value.trim_matches(char::from(0)).to_string();
        match key.trim() {
            "mode" => report.mode = Some(value),
            "product" => report.product = Some(value),
            "os_version" => report.os_version = Some(value),
            "serial" => report.serial = Some(value),
            _ => {}
        }
    }
}

fn is_tp7_port(name: &str) -> bool {
    let lower = name.to_lowercase().replace(['\u{2013}', '\u{2014}'], "-");
    lower.contains("tp-7") || lower.contains("tp7")
}

fn wait_for<T>(rx: &Receiver<Vec<u8>>, timeout: Duration, mut accept: impl FnMut(&[u8]) -> Option<T>, what: &str) -> Result<T, TeError> {
    let deadline = Instant::now() + timeout;
    loop {
        let now = Instant::now();
        if now >= deadline {
            return Err(TeError::Timeout(what.into()));
        }
        let message = rx.recv_timeout(deadline - now).map_err(|_| TeError::Timeout(what.into()))?;
        if let Some(value) = accept(&message) {
            return Ok(value);
        }
    }
}

fn send_request(
    out: &mut midir::MidiOutputConnection,
    rx: &Receiver<Vec<u8>>,
    device_id: u8,
    next_id: &mut u16,
    command: u8,
    payload: &[u8],
) -> Result<TeResponse, TeError> {
    let request_id = *next_id;
    *next_id = (*next_id + 1) % 4096;
    out.send(&build_te_request(device_id, request_id, command, payload)).map_err(|e| TeError::Transport(e.to_string()))?;
    let response = wait_for(
        rx,
        Duration::from_secs(3),
        |message| parse_te_response(message).filter(|r| r.request_id == request_id && r.command == command),
        "waiting for the TP-7 to answer",
    )?;
    if response.status == STATUS_OK {
        Ok(response)
    } else {
        Err(TeError::Rejected { command, status: response.status })
    }
}

/// Ask a TP-7 in audio/MIDI mode to re-enumerate as an MTP device.
/// Blocks for a few seconds at most; call from a blocking task.
pub fn switch_tp7_to_mtp() -> Result<Tp7SwitchReport, String> {
    let mut input = midir::MidiInput::new("doxy").map_err(|e| e.to_string())?;
    input.ignore(midir::Ignore::None);
    let ports: Vec<_> = input.ports().into_iter().filter(|port| input.port_name(port).map(|name| is_tp7_port(&name)).unwrap_or(false)).collect();
    if ports.len() != 1 { return Err("Connect exactly one TP-7 in audio/MIDI mode before preparing it for transfer.".into()); }
    let in_port = &ports[0];
    let output = midir::MidiOutput::new("doxy").map_err(|e| e.to_string())?;
    let out_port = output
        .ports()
        .into_iter()
        .find(|port| output.port_name(port).map(|name| is_tp7_port(&name)).unwrap_or(false))
        .ok_or("No TP-7 MIDI output found. Close other apps that hold the TP-7 and try again.")?;
    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let _input_connection = input
        .connect(in_port, "doxy-in", move |_, message, _| { let _ = tx.send(message.to_vec()); }, ())
        .map_err(|e| e.to_string())?;
    let mut out = output.connect(&out_port, "doxy-out").map_err(|e| e.to_string())?;

    out.send(&IDENTITY_REQUEST).map_err(|e| e.to_string())?;
    let device_id = wait_for(&rx, Duration::from_secs(2), parse_identity_device_id, "waiting for the MIDI identity reply")
        .unwrap_or(DEFAULT_TP7_DEVICE_ID);

    let mut next_id = 1u16;
    let mut report = Tp7SwitchReport { device_id, ..Default::default() };
    if let Ok(greet) = send_request(&mut out, &rx, device_id, &mut next_id, COMMAND_GREET, &[]) {
        parse_greet(&greet.data, &mut report);
    }
    report.payload = match send_request(&mut out, &rx, device_id, &mut next_id, COMMAND_MODE, &MODE_MTP) {
        Ok(_) => MODE_MTP.to_vec(),
        Err(TeError::Rejected { status: STATUS_BAD_REQUEST, .. }) => {
            send_request(&mut out, &rx, device_id, &mut next_id, COMMAND_MODE, &MODE_MTP_LEGACY).map_err(|e| e.to_string())?;
            MODE_MTP_LEGACY.to_vec()
        }
        Err(error) => return Err(error.to_string()),
    };
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_te_product_strings() {
        assert_eq!(classify("OP-XY", None), "op-xy");
        assert_eq!(classify("OP\u{2013}XY", None), "op-xy");
        assert_eq!(classify("OP-1 field", None), "op-1-field");
        assert_eq!(classify("TP-7 MTP Device", None), "tp-7");
        assert_eq!(classify("", Some(TP7_PRODUCT_ID)), "tp-7");
        assert_eq!(classify("Pixel 9", Some(0x4ee1)), "unknown");
    }

    /// The same model strings the frontend test asserts, so the two classifiers
    /// cannot drift apart. A case added on either side is checked by both.
    #[test]
    fn classifies_every_model_in_the_shared_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures/device-models.json");
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("{}: {error}", path.display()));
        let fixture: serde_json::Value = serde_json::from_str(&text).expect("device-models.json is valid json");
        let cases = fixture["cases"].as_array().expect("cases is an array");
        assert!(cases.len() > 20, "the fixture should hold every model string we know");

        for case in cases {
            let model = case["model"].as_str().expect("model is a string");
            let product_id = case["productId"].as_u64().map(|value| value as u16);
            let expected = case["kind"].as_str().expect("kind is a string");
            let why = case["why"].as_str().unwrap_or("");
            assert_eq!(
                classify(model, product_id),
                expected,
                "model {model:?} with product id {product_id:?}: {why}"
            );
        }
    }

    #[test]
    fn backup_roots_follow_the_device_family() {
        assert_eq!(backup_roots("op-1-field"), &["drum", "synth", "tape", "album"]);
        assert_eq!(backup_roots("tp-7"), &["recordings", "memo"]);
        assert!(backup_roots("unknown").is_empty());
    }

    #[test]
    fn packs_payloads_into_seven_bit_bytes() {
        assert_eq!(pack_7bit(&[0x01, 0x03]), vec![0x00, 0x01, 0x03]);
        assert_eq!(pack_7bit(&[0x80, 0x7f, 0xff]), vec![0b101, 0x00, 0x7f, 0x7f]);
        let data: Vec<u8> = (0..=255u8).collect();
        assert_eq!(unpack_7bit(&pack_7bit(&data)), data);
        assert!(pack_7bit(&[]).is_empty());
    }

    #[test]
    fn builds_the_validated_mode_switch_request() {
        assert_eq!(
            build_te_request(0x19, 5, COMMAND_MODE, &MODE_MTP),
            vec![0xf0, 0x00, 0x20, 0x76, 0x19, 0x40, 0x60, 0x05, 0x04, 0x00, 0x01, 0x03, 0xf7]
        );
        assert_eq!(build_te_request(0x19, 1, COMMAND_GREET, &[]), vec![0xf0, 0x00, 0x20, 0x76, 0x19, 0x40, 0x60, 0x01, 0x01, 0xf7]);
    }

    #[test]
    fn parses_identity_and_mode_responses() {
        let identity = [0xf0, 0x7e, 0x19, 0x06, 0x02, 0x00, 0x20, 0x76, 0x19, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf7];
        assert_eq!(parse_identity_device_id(&identity), Some(0x19));
        assert_eq!(parse_identity_device_id(&[0xf0, 0x7e, 0x19, 0x06, 0x02, 0x00, 0x00, 0x01, 0xf7]), None);
        let response = parse_te_response(&[0xf0, 0x00, 0x20, 0x76, 0x19, 0x40, 0x20, 0x05, 0x04, 0x00, 0xf7]).unwrap();
        assert_eq!(response, TeResponse { request_id: 5, command: COMMAND_MODE, status: STATUS_OK, data: vec![] });
        assert!(parse_te_response(&build_te_request(0x19, 5, COMMAND_MODE, &MODE_MTP)).is_none(), "requests are not responses");
    }

    #[test]
    fn parses_greet_metadata() {
        let mut report = Tp7SwitchReport::default();
        parse_greet(b"mode:normal;product:TP-7;sw_version:1.1.9;os_version:1.1.9;serial:F1RTL11C;sku:TE025AS001", &mut report);
        assert_eq!(report.product.as_deref(), Some("TP-7"));
        assert_eq!(report.mode.as_deref(), Some("normal"));
        assert_eq!(report.os_version.as_deref(), Some("1.1.9"));
        assert_eq!(report.serial.as_deref(), Some("F1RTL11C"));
    }
}
