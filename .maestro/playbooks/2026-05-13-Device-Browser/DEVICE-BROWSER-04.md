# Phase 4: WebUSB + MTP Browser-Native Device Connection

Replace the File System Access API approach (which requires Field-Kit to mount the OP-XY) with direct WebUSB + MTP protocol communication, enabling Chrome/Edge to talk to the OP-XY without any third-party app.

## Context

The current Device Browser uses `showDirectoryPicker()` which requires the OP-XY to be mounted as a filesystem volume. On macOS, the OP-XY uses MTP (Media Transfer Protocol) and doesn't mount natively — users need TE's Field-Kit app. WebUSB can bypass this by speaking MTP directly over USB from the browser.

### Key Research Findings (from session history)
- **webmtp (tidepool)**: npm package, stable, but **read-only** — no write support
- **WebMTP (stephenkingston)**: Supports read/write/delete but **root folders only**, no rename, no nested directory support
- Both use Chrome's WebUSB API with the USB device picker
- macOS caveat: `ptpcamerad` daemon may claim the device — may need to be killed first

## Implementation

- [ ] **Research and select MTP library approach** — Read the source code of both `webmtp` (tidepool, npm) and `WebMTP` (stephenkingston, GitHub). Evaluate: (1) Can stephenkingston's WebMTP be extended to support nested directories and rename? Check the MTP operation codes it implements vs what the MTP spec defines. (2) Is it feasible to fork and extend one of these, or should we implement MTP from scratch using the WebUSB raw API? (3) Check if the OP-XY's MTP implementation supports the standard `MoveObject` and `RenameObject` operations (some devices only support a subset). Document findings in a `docs/webusb-mtp-research.md` file with a recommendation. Do NOT write implementation code in this task — research only.

- [ ] **Create MTP transport layer `src/utils/mtpTransport.ts`** — Based on research findings, implement the low-level MTP-over-USB transport. Core functions needed: (1) `connectMtpDevice(): Promise<MtpDevice>` — use `navigator.usb.requestDevice()` with OP-XY vendor/product ID filter, claim interface, (2) `openSession(device): Promise<MtpSession>` — MTP OpenSession operation, (3) `getDeviceInfo(session): Promise<DeviceInfo>` — MTP GetDeviceInfo, (4) `getStorageIds(session): Promise<number[]>` — enumerate storage, (5) `closeSession(session)` — clean disconnect. Follow the MTP/PTP spec for packet framing (container header: length, type, code, transaction ID). Handle USB bulk transfer endpoints. Add TypeScript types for all MTP data structures.

- [ ] **Implement MTP file operations in `src/utils/mtpOperations.ts`** — Build on the transport layer to implement file-level operations: (1) `listDirectory(session, storageId, parentHandle): Promise<MtpObject[]>` — MTP GetObjectHandles + GetObjectInfo for each, (2) `readFile(session, objectHandle): Promise<ArrayBuffer>` — MTP GetObject with streaming for large files, (3) `writeFile(session, storageId, parentHandle, filename, data): Promise<number>` — MTP SendObjectInfo + SendObject, (4) `deleteObject(session, objectHandle): Promise<void>` — MTP DeleteObject, (5) `renameObject(session, objectHandle, newName): Promise<void>` — MTP SetObjectPropValue for filename property, (6) `createDirectory(session, storageId, parentHandle, name): Promise<number>` — MTP SendObjectInfo with association type. Include proper error handling for unsupported operations (the OP-XY may not support all of these).

- [ ] **Create `src/hooks/useDeviceMtp.ts` adapter hook** — Create a hook that provides the same interface as `useDeviceConnection` but uses WebUSB+MTP instead of File System Access API. Implement: (1) `connect()` — opens USB device picker, establishes MTP session, (2) `disconnect()` — closes session and releases USB device, (3) `isSupported` — checks for `navigator.usb` availability, (4) expose the MTP session for use by other hooks. Create a `src/hooks/useDeviceBrowserMtp.ts` that mirrors `useDeviceBrowser` but reads directories via MTP operations instead of FileSystemDirectoryHandle iteration. The goal is that DevicePage can switch between File System Access and WebUSB+MTP backends based on what's available.

- [ ] **Add connection mode selector to DeviceConnectPrompt** — Modify `src/components/device/DeviceConnectPrompt.tsx` to offer two connection modes when both are available: (1) "Connect via USB" (WebUSB+MTP, no Field-Kit needed), (2) "Connect via Folder" (File System Access API, requires mounted directory). Show only the available options based on browser API support. Add a brief explanation of each mode. Default to WebUSB if available since it doesn't require Field-Kit.

- [ ] **Write tests for MTP layer** — Create `src/test/utils/mtpTransport.test.ts` and `src/test/utils/mtpOperations.test.ts`. Mock `navigator.usb` with a fake USBDevice that returns known MTP response packets. Test: (1) session open/close lifecycle, (2) directory listing parses MTP object info correctly, (3) file read reassembles data from bulk transfers, (4) write sends correct SendObjectInfo + SendObject sequence, (5) error handling for unsupported operations. Run `npm run test && npm run build`.
