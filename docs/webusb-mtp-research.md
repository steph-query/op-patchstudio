# WebUSB + MTP Research Findings

## Existing Libraries

### webmtp (tidepool-org)
- **npm:** `webmtp`
- **GitHub:** https://github.com/tidepool-org/webmtp
- **Operations:** READ-ONLY (openSession, getObjectHandles, getFileName, getFile, close)
- **Platforms:** Chrome/Edge (WebUSB), Node.js, Electron
- **Status:** Stable, maintained
- **Verdict:** Cannot use alone — no write support

### WebMTP (stephenkingston)
- **GitHub:** https://github.com/stephenkingston/WebMTP
- **Operations:** Read listings, download files, upload files, delete files
- **Limitations:**
  - Root folder only (no nested directory traversal)
  - No rename support
  - Not tested with large files
  - Requires platform-specific driver setup (WinUSB on Windows, udev on Linux)
- **Verdict:** Has write/delete but lacks nested directory support and rename — critical for OP-XY (presets live in presets/drum/name.preset/)

## Gap Analysis for OP-XY Device Browser

| Capability Needed | webmtp (tidepool) | WebMTP (stephen) | Custom |
|---|---|---|---|
| List directories recursively | Partial (flat handles) | No (root only) | Yes |
| Read files | Yes | Yes | Yes |
| Write files | No | Yes (root only) | Yes |
| Delete files | No | Yes | Yes |
| Rename/move files | No | No | Yes |
| Create directories | No | No | Yes |
| Nested path navigation | No | No | Yes |

## Recommendation

**Fork and extend stephenkingston's WebMTP** as the starting point:
- It already has the USB bulk transfer framing and MTP packet construction
- Add MTP operation codes for: GetObjectHandles with parent filter, MoveObject, SetObjectPropValue (rename), SendObjectInfo+SendObject to specific parent
- The MTP spec is well-documented (USB-IF MTP 1.1 specification)

### MTP Operations Needed (by operation code)

| Code | Operation | Purpose |
|---|---|---|
| 0x1001 | GetDeviceInfo | Identify OP-XY |
| 0x1002 | OpenSession | Start communication |
| 0x1003 | CloseSession | End communication |
| 0x1004 | GetStorageIDs | Find storage volumes |
| 0x1005 | GetStorageInfo | Get capacity/free space |
| 0x1007 | GetObjectHandles | List directory (with parent handle filter) |
| 0x1008 | GetObjectInfo | File metadata (name, size, type) |
| 0x1009 | GetObject | Download file |
| 0x100C | SendObjectInfo | Prepare to upload (sets name, parent) |
| 0x100D | SendObject | Upload file data |
| 0x100B | DeleteObject | Remove file/folder |
| 0x9801 | GetObjectPropsSupported | Check rename support |
| 0x9804 | SetObjectPropValue | Rename (set filename property) |
| 0x1019 | MoveObject | Move to different parent (if supported) |

### macOS Caveat

On macOS, the `ptpcamerad` daemon auto-claims MTP/PTP devices. Users must either:
1. Kill the daemon: `sudo killall ptpcamerad` (temporary, respawns)
2. Disable SIP and remove the daemon (not recommended)
3. Use TE Field-Kit first to establish the connection, then use WebUSB

This is a known issue affecting ALL non-Apple MTP clients on macOS.

## Effort Estimate

Building a custom MTP stack for the OP-XY's specific needs (read, write, delete, rename, mkdir in nested paths) is feasible but substantial:
- Transport layer (USB bulk transfers, MTP container framing): ~300 lines
- Operation layer (each MTP op with proper request/response handling): ~500 lines
- High-level API (directory traversal, file read/write): ~200 lines
- Error handling and edge cases: ~200 lines
- Total: ~1200 lines of TypeScript

## Alternative: Tauri + mtp-rs

The `mtp-rs` Rust library provides the entire MTP stack already implemented and tested. Wrapping it via Tauri is significantly less work (~200 lines of Rust + ~100 lines of TypeScript bridge) and avoids the macOS ptpcamerad issue since Rust can use platform-specific USB APIs.

**Recommendation:** Pursue Tauri (Phase 5) as the primary path. Keep WebUSB as a fallback for environments where Tauri isn't available.
