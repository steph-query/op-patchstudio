# Phase 0: Consolidate to Tauri-Native App

Strip out browser-only code and make Tauri the primary (and only) runtime. The app is no longer a PWA fork — it's a native desktop companion app for the OP-XY.

## Remove PWA Infrastructure

- [ ] **Remove PWA plugin and service worker** — In `vite.config.ts`, remove the `import { VitePWA }` and the entire `VitePWA({...})` plugin entry from the plugins array. Remove `vite-plugin-pwa` from `package.json` devDependencies. Delete `public/manifest.json` and `public/sw.js` if they exist. Remove the `generate-icons`, `generate-icons-advanced`, and `generate-favicons` scripts from `package.json`. In `index.html`, remove the `<link rel="manifest">` tag and the Apple/Microsoft PWA meta tags (lines with `apple-mobile-web-app`, `msapplication`). Keep favicon links. Run `npm install` to update lockfile, then `npm run build` to verify.

## Remove Browser File System Access API Code

- [ ] **Remove browser-only device hooks and utilities** — Delete these files entirely: `src/hooks/useDeviceConnection.ts`, `src/hooks/useDeviceBrowser.ts`, `src/hooks/useDeviceAudio.ts` (browser version — audio preview will be reimplemented via Tauri MTP). Delete `src/utils/devicePatchJson.ts` and `src/utils/deviceExport.ts` (both use FileSystemDirectoryHandle — functionality is replaced by Tauri MTP commands). Keep `src/utils/deviceXyParser.ts` but remove the functions that use FileSystemFileHandle: `parseXyFile()`, `applyXyRenameToFile()`, and `backupXyFile()`. Keep the pure parsing functions: `parseXyPaths()`, `previewXyRename()`, `applyXyRename()`. Remove `src/types/device.ts` (types using FileSystemDirectoryHandle/FileSystemFileHandle — replaced by Tauri types in `tauriBridge.ts`). Remove `src/types/mtp.ts` (WebUSB MTP types — we use mtp-rs via Tauri instead).

- [ ] **Remove browser-only device components** — Delete: `src/components/device/DevicePage.tsx` (replaced by the library tab + global connection bar), `src/components/device/DeviceConnectPrompt.tsx` (replaced by DeviceConnectionBar), `src/components/device/DeviceTreeView.tsx` (replaced by DevicePresetTable), `src/components/device/DeviceDetailPanel.tsx` (will be rebuilt as preset detail panel), `src/components/device/DeviceRenameModal.tsx` (will be rebuilt for Tauri MTP), `src/components/device/DeviceProjectPanel.tsx` (will be rebuilt for Tauri MTP). Keep `src/components/device/DevicePresetTable.tsx` — it already uses Tauri bridge. Keep `src/components/common/DeviceConnectionBar.tsx` — it already uses Tauri bridge.

- [ ] **Remove browser-only device tests** — Delete: `src/test/hooks/useDeviceConnection.test.ts`, `src/test/hooks/useDeviceBrowser.test.ts`, `src/test/hooks/useDeviceAudio.test.ts`, `src/test/utils/devicePatchJson.test.ts`, `src/test/utils/deviceXyParser.test.ts` (will be rewritten for the pure functions only), `src/test/utils/deviceExport.test.ts`, `src/test/components/DeviceBrowser.test.tsx`.

## Clean Up AppContext and References

- [ ] **Remove deviceRootHandle from AppContext** — In `src/context/AppContext.tsx`: remove `deviceRootHandle: FileSystemDirectoryHandle | null` from the `AppState` interface, remove the `SET_DEVICE_ROOT_HANDLE` action type, remove it from `initialState`, remove the reducer case. Remove `FEATURE_FLAGS.DEVICE_TAB` from `src/utils/constants.ts`. In `src/components/drum/DrumTool.tsx` and `src/components/multisample/MultisampleTool.tsx`: remove the `FEATURE_FLAGS.DEVICE_TAB` checks around `onSendToDevice` — the send-to-device feature should now always be available when `state.tauriDevice` is not null (check `!!state.tauriDevice` instead). Remove the imports of `deviceExport`, `FEATURE_FLAGS` (if no longer needed), and `generateDrumPatch`/`generateMultisamplePatch` direct imports (the send-to-device flow will be reworked in a later phase to use Tauri MTP directly). Fix all test files that reference `deviceRootHandle: null` — remove these lines from mock state objects in `usePatchGeneration.test.ts`, `drumStartPoints.test.ts`, `libraryUtils.test.ts`, `patchGeneration.test.ts`, `sessionStorage.test.ts`, `sessionStorageIndexedDB.test.ts`. Run `npm run build && npm run test` to verify everything compiles and passes.

## Verify Clean Build

- [ ] **Run full verification** — Run `npm run test` (all tests should pass), `npm run build` (TypeScript + Vite build should succeed with no errors), `npm run lint` (verify no new lint errors introduced). Then verify the Tauri build: `cd src-tauri && cargo build`. Report final test count and any issues.
