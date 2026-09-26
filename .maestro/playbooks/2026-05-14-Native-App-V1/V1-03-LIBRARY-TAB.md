# Phase 2: Library Tab — Device Preset Manager

Transform the Library tab into the flagship device management screen. When connected, it shows all presets from the OP-XY in a polished, interactive table with full CRUD operations.

## Grid/List View and Polish

- [ ] **Add grid view to DevicePresetTable** — In `src/components/device/DevicePresetTable.tsx`, add a view toggle (grid/list) at the top right of the component. The list view is the current table. The grid view renders preset cards in a responsive CSS grid (3-4 columns depending on width). Each card shows: type icon (drum emoji vs keyboard emoji), preset name (large), category tag (small pill badge), sample count, total size, and a row of quick action buttons (play, rename, more). Use the TE design language: lowercase text, minimal borders, monospace numbers, generous whitespace, grayscale with green accents only for connected/playing states. Style the category filter tabs to look like TE's minimal button style — no background when inactive, subtle underline when active.

- [ ] **Add preset detail panel** — Create `src/components/device/DevicePresetDetail.tsx`. When a preset is selected (clicked in grid or list), show a detail panel as either a slide-out panel on the right (desktop) or full-screen overlay (mobile). Contents: (1) preset name (editable — click to rename), (2) metadata row: category, type, region count, total size, (3) sample table with columns: play button, sample filename, key mapping (pitch.keycenter), playmode, size, (4) patch settings summary: engine playmode, transpose, volume, width from patch_json, (5) action buttons at bottom: "download zip", "delete from device", "duplicate". Play buttons stream audio via `mtpReadFile` → `decodeAudioData` → `AudioBufferSourceNode` (same pattern as existing DevicePresetTable). The panel should feel like looking at an instrument's patch sheet.

## Rename Preset via MTP

- [ ] **Add `mtp_rename_preset` Tauri command** — In `src-tauri/src/main.rs`, implement a command that: (1) takes `folder_handle: u32`, `old_name: String`, `new_name: String`, `category: String`, (2) reads all files from the old preset folder, (3) creates a new folder named `{new_name}.preset` in the same category, (4) copies all files (upload each to new folder), (5) updates patch.json `name` field to `new_name`, (6) deletes the old folder, (7) returns the new folder handle. Add `mtpRenamePreset()` to tauriBridge.ts. This is the atomic rename operation — project reference updating comes in the Projects phase.

- [ ] **Wire inline rename in DevicePresetDetail** — When the user clicks the preset name in the detail panel, it becomes an editable input. Validate against OP-XY charset (alphanumeric, space, #, -, parens, dot). On Enter: call `mtpRenamePreset`, show a brief loading state, then refresh the preset list via `mtpScanPresets`. On Escape: cancel edit. Show validation errors inline. After successful rename, dispatch a notification and re-select the renamed preset.

## Delete Preset via MTP

- [ ] **Add `mtp_delete_preset` Tauri command** — Takes `folder_handle: u32`. Deletes the preset folder and all its contents recursively (delete each file first, then delete the folder). Add `mtpDeletePreset()` to tauriBridge. In the UI: add a "delete from device" button in DevicePresetDetail that shows a confirmation dialog: "delete [preset name]? this cannot be undone." After deletion, refresh the preset list and clear selection.

## Export Preset as ZIP

- [ ] **Implement download-as-zip** — In DevicePresetDetail, add a "download zip" button. When clicked: (1) read all files from the preset via `mtpReadFile` for each sample handle + construct patch.json from the stored data, (2) use JSZip (already a dependency) to create a .preset.zip, (3) trigger browser download via `URL.createObjectURL` + `<a>` click. This lets users share presets from their device without manually copying files.

## Tests and Verification

- [ ] **Write tests for new components and verify build** — Create `src/test/components/DevicePresetTable.test.tsx` testing: category filter, grid/list toggle, preset selection. Create `src/test/components/DevicePresetDetail.test.tsx` testing: rename validation, detail panel rendering. Run `npm run test && npm run build` and verify Rust build with `cd src-tauri && cargo build`.
