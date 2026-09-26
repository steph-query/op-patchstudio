# Phase 1: Enhanced Global Connection Bar

Upgrade the connection bar to show device metadata matching the product vision: device name, preset count, free space, refresh, and disconnect.

## Add Storage Info to Connection

- [ ] **Add `mtp_get_storage_info` Tauri command** — In `src-tauri/src/main.rs`, create a new command `mtp_get_storage_info` that returns `{ free_space: u64, capacity: u64, description: String }` from the first storage. Add corresponding function `mtpGetStorageInfo()` in `src/utils/tauriBridge.ts` with a `TauriStorageInfo` type. Add `storageInfo` to AppContext state: `tauriStorageInfo: { freeSpace: number; capacity: number } | null`. Add `SET_TAURI_STORAGE_INFO` action. Call it during connect (after `mtpScanPresets`) and on refresh. Build both Rust and TypeScript.

- [ ] **Enhance DeviceConnectionBar UI** — Update `src/components/common/DeviceConnectionBar.tsx` to read `tauriStorageInfo` from context and display: (1) green dot + device name (already done), (2) preset count (already done), (3) free space formatted as "X.X GB free" with a mini progress bar showing usage percentage, (4) a refresh button (⟳) that re-runs `mtpScanPresets` + `mtpGetStorageInfo` and updates context, (5) disconnect button (already done). Style: all lowercase, monospace for numbers, TE-style minimal aesthetic. The bar should be compact — single line, ~40px height. When disconnected, show "no device connected" with a "connect op-xy" button and a small help text "put your op-xy in mtp mode (com > m4)". Run tests and build.
