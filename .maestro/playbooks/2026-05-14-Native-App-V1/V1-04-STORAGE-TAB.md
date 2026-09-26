# Phase 3: Storage Tab — "Where is my space going?"

Add a dedicated Storage tab that gives users visibility into device usage, identifies large presets, and finds orphaned samples.

## Storage Breakdown

- [ ] **Add Storage tab to the app** — Add `'storage'` to the tab union type in AppContext (`currentTab` type). Add the tab to TabNavigation. Create `src/components/storage/StoragePage.tsx`. The tab only appears when a device is connected (conditionally render in TabNavigation based on `state.tauriDevice`). When disconnected, this tab is hidden. Layout: (1) top section: large storage bar showing used/free as a visual bar (like a disk usage indicator), formatted as "X.X GB used / 8.0 GB" with percentage, (2) breakdown section: three rows showing Presets (count + total size), Samples (count + total size), Projects (count + total size) — each with its own mini bar proportional to the total, (3) largest presets list: top 10 presets sorted by total_size descending. Calculate totals from `state.tauriPresets` data that's already in context.

## Orphaned Sample Detection

- [ ] **Add `mtp_scan_standalone_samples` Tauri command** — This should return all files in `samples/user/` with their handles and sizes (the existing `mtp_scan_presets` already returns `standalone_samples`). In `StoragePage`, cross-reference standalone samples against all preset sample filenames. Any standalone sample whose name doesn't appear in any preset's `patch_json.regions[].sample` field is "orphaned." Display orphaned samples in a section: "unused samples (not referenced by any preset)" with total size and a "clean up" button that deletes them after confirmation.

- [ ] **Write tests and verify build** — Create `src/test/components/StoragePage.test.tsx` testing: storage bar rendering, largest presets list, orphaned sample detection logic. Run `npm run test && npm run build && cd src-tauri && cargo build`.
