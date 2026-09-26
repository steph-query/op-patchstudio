# OP-XY companion review — September 4, 2026

## Current firmware baseline

Latest researched release: **1.1.33, September 2, 2026**. OS 1.1.15 introduced deeper folders, UTF-8 MTP, templates and 16 patterns per track. Subsequent releases repaired snapshot saving and improved browsing and multisample behavior. These changes invalidate several assumptions in the May product vision. Source: https://teenage.engineering/downloads/op-xy

The app displays a dated research snapshot and the device-reported version when available. It does not claim automatic firmware checking or certify binary project compatibility. No firmware was installed on hardware during this review.

## User feedback and product priorities

These are qualitative community reports, not a representative survey. Older complaints must be checked against newer firmware before defining features.

| Evidence | Companion opportunity | Priority |
| --- | --- | --- |
| Users cannot tell which projects depend on which samples; deleting or moving content can break links. | Searchable dependency inspection, reverse usage index, conservative unresolved states. | First |
| Backup recovery reports describe projects that cannot load after copying folders back. | Complete snapshots, checksums, verification and a restore preview that handles conflicts. | First |
| Storage cleanup is laborious, and sample conversion requires external tooling. | Batch sample preparation, preview, size estimates and duplicate detection. | Next |
| Renaming and relinking are popular in community editors, but newer firmware families require parser changes. | Fixture-based binary format research before any in-place project editing. | Prerequisite for relinking |

Primary community discussions:

- https://op-forums.com/t/op-xy-storage-and-file-structure/28915
- https://op-forums.com/t/op-xy-file-editor/31689
- https://op-forums.com/t/op-xy-projects-corrupted/29060
- https://op-forums.com/t/op-xy-project-file-xy-reverse-engineering-efforts/29850

The official backup guide calls for preserving the project and its version folder. Dependencies also matter; a dependency report or lone `.xy` download is not a complete backup: https://teenage.engineering/guides/op-xy/how-to

## Application review and implemented first pass

Existing work: React sample editors, an IndexedDB library, a Tauri/MTP bridge, device storage, and an initial project inspector. The checkout already contained a substantial uncommitted desktop migration; this work extends it without reverting it.

- Replaced fixed-depth device scans with full subtree discovery, retaining nested relative paths for projects, presets and samples. Version/history projects remain visible under their relative folder paths.
- Decode recognized project path segments as UTF-8; reject unterminated and invalid segments.
- Added a desktop project workspace with local `.xy` import, project/reference search, deduplicated dependency results, unresolved filtering and JSON reports.
- Match full paths rather than ambiguous filenames. Offline references remain unchecked; unresolved device references are not automatically called missing.
- Fixed hidden project read failures and stale results when selections resolve out of order.
- Added dated firmware guidance and native device-version reporting.
- Replaced destructive preset rename and unstructured binary byte replacement with a non-destructive preset copy. The operation rejects existing destination names, copies nested files, and compares uploaded file bytes with their originals. Source content and project links remain intact. Failed copies can leave a clearly reported partial destination.
- Device refresh failures are visible; disconnect returns to a valid offline tab.

## Remaining work for the continuous goal

1. Add restore conflict preview and verified recovery for the native snapshots now implemented. Hardware backup/restore testing remains required.
2. Audit transfer/export paths, device identity selection, concurrent UI operations and preset deletion. Existing preset export reconstructs metadata; it should preserve original bytes. Existing deletion lacks dependency protection.
3. Add local library folders/workspaces, sample usage lookup and duplicate discovery. Any cleanup recommendation must account for incomplete parser coverage.
4. Add batch conversion and sample slicing workflows using existing audio utilities, with undo and a preview of size/audio changes.
5. Expand `.xy` fixtures across firmware versions. The checked-in `cracked_clay.xy` is useful evidence, not comprehensive format validation. Do not infer tempo, sequencer offsets or safe path rewrites from one fixture.
6. Finish native save/open dialogs, keyboard focus behavior, packaging and visual consistency across editor/library/device views.
7. Physical OP-XY testing on the latest firmware: nested Unicode folders, reconnect, interrupted transfers, copies, and backup restore to a test device.

## Validation

First pass: 433 Vitest tests passed (35 files), including 11 new dependency, selection and connection regression tests. TypeScript/Vite production build and offline native Cargo check passed. Existing bundle-size, Sass deprecation and some React test `act` warnings remain. The headless UI smoke check opened `cracked_clay.xy`, rendered 62 unique references, downloaded the JSON report and reported no browser errors; this does not establish hardware compatibility.

## September 5 — native library snapshots

Implemented `src-tauri/src/backup.rs` and the Projects view's `BackupPanel`. Creating a backup uses a native folder picker and creates a unique subfolder containing the complete `projects`, `presets`, and `samples` trees, including empty folders and history files. Original file bytes are streamed from MTP directly to disk; metadata is not reconstructed. The device mutex remains held during capture to prevent this app from interleaving writes or disconnects.

The manifest records device identity, reported firmware, file paths, sizes and SHA-256 checksums. The backup is read back from disk and verified before success is reported. Existing snapshots can be verified offline through a native folder picker. Verification rejects missing or corrupted content, untracked additions, duplicate manifest paths, unsupported paths and symlinked content. Transfer failures leave a reported incomplete folder and attempt to drain any active MTP transfer. No existing local backup or device content is overwritten by snapshot creation.

Five native regression tests cover history preservation, same-length corruption, missing/untracked files, path validation and symlinks. Six focused UI tests passed, including offline verification, dialog cancellation and visible failure behavior. The frontend production build passed. Physical USB transfer, dialog behavior in a packaged Mac application, and restore execution are still unverified or unfinished. Checksums establish consistency with captured bytes, not the musical validity of a project or the authenticity of an externally modified manifest.
