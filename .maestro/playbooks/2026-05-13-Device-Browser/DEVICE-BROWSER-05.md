# Phase 5: Tauri Native Desktop Wrapper (Proof of Concept)

Build a Tauri-based native desktop app that wraps OP-PatchStudio with full MTP device access via the `mtp-rs` Rust library. This is the most capable path for OP-XY device management — no Field-Kit dependency, full read/write/rename/delete support.

## Context

### Why Tauri over Electron
- **mtp-rs** (pure Rust, async): Full MTP operation set — read, write, delete, rename, mkdir, directory listing, streaming transfers. No C dependencies.
- Electron's Node.js MTP libraries are either dead (`node-mtp`, last updated 2020) or read-only (`webmtp`).
- Tauri produces smaller binaries and uses the system webview.

### Prerequisites
- Rust toolchain must be installed (`rustup`). This was not installed during the prior session.
- macOS caveat: `ptpcamerad` daemon may need to be stopped to release the USB device.

### Scope
This is a **proof of concept** — connect to OP-XY, list directory contents, read a file. The goal is to validate the mtp-rs integration works before committing to a full Tauri migration.

## Implementation

- [ ] **Install Rust toolchain and initialize Tauri project** — (1) Install Rust via rustup: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`, then source the cargo env. (2) Install Tauri CLI: `cargo install tauri-cli` (or use `npm create tauri-app` if preferred). (3) Initialize Tauri in the existing project: create `src-tauri/` directory with `Cargo.toml`, `tauri.conf.json`, and `src/main.rs`. Configure `tauri.conf.json` to use the existing Vite dev server (`http://localhost:5173`) as the frontend. Add `mtp-rs` as a dependency in `Cargo.toml`. Verify `cargo build` succeeds in `src-tauri/`. Add `src-tauri/target/` to `.gitignore`. Do NOT modify the existing web app — Tauri wraps it as-is.

- [ ] **Implement Tauri MTP commands in Rust** — In `src-tauri/src/main.rs` (or a dedicated `src-tauri/src/mtp.rs` module), implement Tauri commands that the frontend can invoke via `@tauri-apps/api`: (1) `#[tauri::command] fn mtp_list_devices() -> Result<Vec<MtpDeviceInfo>, String>` — enumerate connected MTP devices using mtp-rs, return device name + storage info. (2) `#[tauri::command] fn mtp_list_directory(device_id: u32, path: String) -> Result<Vec<MtpEntry>, String>` — list directory contents at given path. (3) `#[tauri::command] fn mtp_read_file(device_id: u32, path: String) -> Result<Vec<u8>, String>` — read file contents. Define Serde-serializable structs for `MtpDeviceInfo` and `MtpEntry`. Register all commands in the Tauri builder. Handle the macOS `ptpcamerad` issue by documenting it — do not auto-kill the daemon in the PoC.

- [ ] **Create frontend bridge `src/utils/tauriBridge.ts`** — Create a TypeScript module that wraps Tauri's `invoke()` API and provides the same interface as the existing device hooks. Functions: (1) `isTauriAvailable(): boolean` — check if `window.__TAURI__` exists, (2) `listMtpDevices(): Promise<MtpDeviceInfo[]>`, (3) `listMtpDirectory(deviceId, path): Promise<MtpEntry[]>`, (4) `readMtpFile(deviceId, path): Promise<ArrayBuffer>`. Add TypeScript types matching the Rust structs. This bridge allows the app to detect at runtime whether it's running in Tauri (native MTP) or browser (File System Access / WebUSB fallback).

- [ ] **Build and test the PoC end-to-end** — (1) Start the Vite dev server (`npm run dev`), (2) Run `cargo tauri dev` from `src-tauri/` to launch the Tauri app with the existing frontend, (3) Connect an OP-XY device via USB, (4) Call `mtp_list_devices` from the browser console via `window.__TAURI__.invoke('mtp_list_devices')` and verify the OP-XY appears, (5) Call `mtp_list_directory` to list the root and verify presets/samples/projects folders appear, (6) Call `mtp_read_file` on a small file and verify contents. Document results and any issues encountered in `docs/tauri-poc-results.md`. If mtp-rs can't connect (ptpcamerad conflict), document the workaround steps.

**Note:** This phase intentionally does NOT integrate MTP into the Device Browser UI — it only validates the Rust/Tauri/mtp-rs stack works. UI integration would be a follow-up phase after the PoC proves viable.
