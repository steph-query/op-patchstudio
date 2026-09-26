# Phase 4: Seamless Create-to-Device Flow

Wire the drum and multisample builders to send presets directly to the connected OP-XY via MTP.

## Send to Device via Tauri MTP

- [ ] **Add `mtp_upload_preset` Tauri command** — In `src-tauri/src/main.rs`, create a command that takes: `category: String`, `preset_name: String`, `files: Vec<(String, Vec<u8>)>` (list of filename + data pairs). The command: (1) navigates to `presets/{category}/` (creating if needed), (2) creates `{preset_name}.preset/` folder, (3) uploads each file (patch.json + samples) into it. Return the new folder handle. Add `mtpUploadPreset()` to tauriBridge.ts.

- [ ] **Rework DrumTool "Send to Device" handler** — In `src/components/drum/DrumTool.tsx`: replace the current `handleSendToDevice` (which uses `generateDrumPatch` + `exportPresetToDevice` File System API) with a new flow: (1) generate the preset zip blob using existing `generateDrumPatch()`, (2) unzip it in memory using JSZip, (3) collect all files as `{name: string, data: Uint8Array}[]`, (4) call `mtpUploadPreset(category, presetName, files)`. Add a category picker dropdown before the send button (default: 'drum'). Check for conflicts: call `mtpScanPresets` to see if a preset with that name already exists in the category. If conflict: show confirmation dialog. After success: dispatch notification, refresh presets in context. The "send to device" button should be visible when `state.tauriDevice` is not null (remove FEATURE_FLAGS.DEVICE_TAB check). Do the same for MultisampleTool (default category: 'keys'). Run `npm run test && npm run build && cd src-tauri && cargo build`.

## Post-Send Navigation

- [ ] **Show post-send guidance** — After a successful send, show a toast notification with the message: "preset sent to device. on your op-xy: instrument → shift+[track] → scroll to [preset name]". This helps users find their new preset on the device without guessing. Also refresh the preset list in context so the Library tab immediately shows the new preset.
