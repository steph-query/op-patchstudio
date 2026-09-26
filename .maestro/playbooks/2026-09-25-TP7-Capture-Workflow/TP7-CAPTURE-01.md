---
type: playbook
title: "TP-7 capture workflow — 01: contract and baseline"
tags: [fieldwork, tp-7, samples, macos, autorun]
created: 2026-09-25
---

# TP-7 capture workflow — 01: contract and baseline

Task-based, sequential playbook. Each checkbox must be executable in a fresh context. Authoring this playbook does not launch it. Run phases 01–07 in order; do not run dependent documents concurrently.

## Outcome

Make Fieldwork a personal, local-first Mac workspace for **TP-7 capture → verified import → organized library → nondestructive sample regions → destination-aware preparation → verified instrument transfer**. “Capture” means recordings already made on the TP-7, not new live multichannel recording in the app.

The everyday success case: import new takes, disconnect the recorder, find and name several useful moments, collect them into a kit or melodic sample set, connect the OP-XY or OP-1 Field, review what will be written, and send without managing device folders manually. Originals remain unchanged and the library remains usable offline.

## Execution contract — applies to every task in every phase

- Workspace: `/Users/nick/projects/side-projects/op-patchstudio`. Read applicable repository instructions and inspect current Git changes before editing. Preserve the existing dirty worktree, Fieldwork branding, legacy app/storage identifiers, backups, and upstream attribution. Do not commit, push, publish, install, or change unrelated files.
- Search with `rg` before adding any helper, hook, component, parser, store, or transfer implementation. Extend existing code where appropriate; file paths proposed below are targets, not proof those files exist. Record any justified substitution in `docs/tp7-capture-workflow.md`.
- Keep each implementation task to 1–3 files and under 500 changed lines. If a task proves larger, split remaining work into explicit adjacent checkbox tasks before dependent work; do not hide incomplete acceptance criteria by checking it off. Keep implementation, test authoring, and test execution separate.
- Agent-created data, test fixtures, logs, temporary files, and build outputs must stay inside this workspace. Use isolated generated fixtures, never a real personal library. Do not connect to, prepare, scan, record from, or write to physical hardware during Auto Run. Native dialogs in automated tests must be injected/mocked. Actual user-selected library folders are application behavior, not permission for an agent to access personal files.
- No device content is overwritten, renamed, deleted, or automatically cleaned up. Import copies originals. Derived clips never replace sources. Transfer requires an explicit destination and confirmation; the native layer must enforce validation independently of UI checks. Do not loosen existing backup or session safeguards.
- Maintain a single active USB session. Persist device identity/provenance, not MTP object handles across sessions. Re-scan/re-resolve and revalidate after reconnect. A missing root, unknown device, or incomplete scan is not an empty safe destination.
- Distinguish copied, verified, failed, cancelled, and incomplete outcomes. Never promise rollback or resumable USB writes when the transport cannot provide them. No automatic retry of uncertain writes. Record partial destination paths and preserve existing user content.
- Automated checks establish software behavior only. Hardware/firmware compatibility remains unverified until the user performs the manual follow-up in phase 07. Unknown format constraints must fail closed or visibly disable that target, not be guessed.
- New documentation and evidence use YAML front matter (`type`, `title`, `tags`, `created`) and wiki-links to related artifacts. `docs/tp7-capture-workflow.md` holds decisions and schemas; `docs/tp7-capture-validation.md` holds commands, outcomes, baseline failures, and remaining limitations.

## Experience contract — applies to every user-facing task

The execution contract protects the user's files. This one protects the user's attention, and it is equally binding. A task that satisfies every safety rule while making the workflow slower or more confusing than exporting to Finder by hand has not met its acceptance criteria. This is a personal tool for one musician: fewer decisions beats more options.

- **Step budget.** Connected TP-7 to imported takes: connect, then one action. Imported take to a saved named region: select, audition, mark, name. Region to a playable kit on the instrument: choose target, review once, send. No step may exist only to satisfy an internal state machine or to collect data the app could infer. Record the achieved counts in `docs/tp7-capture-ux.md` and re-measure them in phase 07.
- **Plain language only.** No internal state name (`awaiting_confirmation`), MTP/PTP code, object handle, hash, schema version, or absolute path is ever the primary text in the interface. Internal states collapse to at most five user-facing statuses. Every error names the cause and the next action in the user's words, and a device error repeats the transfer-mode hint for that specific model. Technical detail belongs behind a disclosure or in the validation log, never in place of an explanation.
- **Never freeze the workspace for background work.** Imports, hashing, peak building, and transfers report progress on the affected row or panel only; browsing, auditioning, and editing stay usable throughout. Only an in-flight device write may restrict device actions, and it must name the operation holding the device. Do not extend the global device busy gate to local library work — a previous review already found that pattern making the builders unusable during ordinary local loading.
- **Keyboard first, mouse optional.** The audition → mark → name → next loop is completable from the keyboard without leaving the list. Shortcuts come from one documented map, never fire while a text field or slider has focus, are discoverable in the UI where they apply, and do not shadow macOS or existing builder shortcuts.
- **Sensible defaults instead of prompts.** The library has a default location and is created without asking. Names are suggested from the source take and its position; no dialog blocks on an empty required field. The last used destination profile, output type, folder, and naming pattern are remembered. Remembering a choice never replaces the explicit confirmation before a device write, and a remembered device is still shown for confirmation rather than silently reused.
- **No dead ends.** Every prepared output can also be written to a folder the user chooses, including when a device route is unproven, disabled, or no device is connected. Every take, region, and transfer shows where it came from and where it went, so the user can trace a sound on the instrument back to the recording. Local files can be revealed in Finder.
- **Reversible in the library, careful on the device.** Local metadata edits, removals, and region changes are undoable or explicitly confirmed, and removing an item from the library is clearly distinct from deleting audio from disk. The device-side no-overwrite, no-delete, no-rename rules in the execution contract are unchanged by this section.
- **Empty states teach the next action.** Every new view states what it holds and offers both device import and local-file import when empty, so the app is useful before a recorder is ever plugged in.

## Scope and sequence

| Phase | Deliverable |
| --- | --- |
| [[TP7-CAPTURE-01]] | Baseline, reusable-code map, data and compatibility contract, written experience reference |
| [[TP7-CAPTURE-02]] | Durable Mac catalog and verified TP-7/Finder ingestion |
| [[TP7-CAPTURE-03]] | Offline sample library, names, tags, favorites, collections |
| [[TP7-CAPTURE-04]] | Long-take audition, waveform regions, channel selection, clip rendering |
| [[TP7-CAPTURE-05]] | OP-XY and OP-1 Field output profiles and compatibility preflight |
| [[TP7-CAPTURE-06]] | Persistent, confirmed, verified transfer queue |
| [[TP7-CAPTURE-07]] | Cross-device workflow QA, experience audit, Mac package, hardware-test handoff |

Out of scope: cloud sync, accounts, marketplace/community, iOS/Android, automatic deletion, destructive sync/restore, transcription, AI source separation, live audio/MIDI routing, arbitrary format conversion, and Studio Field-style tape assembly. Automatic onset slicing and direct TP-7 cue-marker import are deferred; preserve source bytes/metadata so these remain possible later. Reuse Fieldwork's identity; do not copy another app's assets or UI.

## Current starting point

`src/utils/tp7Library.ts` classifies recordings/memos and capture dates. `src/components/device/DeviceMediaPage.tsx` offers search, folder filter, multi-select, per-row bounded preview with per-track levels, original export, and in-memory stereo-pair stem export (128 MB limit); it has no per-row progress, keyboard audition, or import. `src/utils/deviceAudio.ts` performs partial reads; `src/utils/wavDecode.ts` parses/splits WAV. `src-tauri/src/backup.rs` contains streaming and checksum-safe file operations. `src/utils/audio.ts` already provides `findNearestZeroCrossing` and `applyZeroCrossingToMarkers`. `src/components/drum/DrumSampleTable.tsx` and `DrumKeyboard.tsx` already accept dropped audio and internal drag payloads for pad assignment. Existing OP-XY builders send presets, but the TP-7 media page has no direct sample handoff and OP-1 Field sample upload has no UI. `mtpUploadAtPath` is a transport primitive, not a complete compatible-sample workflow. Re-inspect all of this: the checkout may evolve before execution.

## Tasks

- [ ] **01.1 — Record the execution baseline.** Apply the execution contract above. Inspect `package.json`, `playwright.config.ts`, `src-tauri/Cargo.toml`, `docs/hardware-test-guide.md`, and the current Git diff. Run `npm test`, `npm run build`, `npm run test:e2e`, and `cargo test --manifest-path src-tauri/Cargo.toml --offline` with hardware access excluded. Record exit codes, actual test counts, tool availability, and existing failures in `docs/tp7-capture-validation.md`; record the current lint baseline without repairing unrelated lint debt. Keep logs under `.maestro/tp7-capture-validation/`. Completion means a reproducible baseline exists, not that pre-existing failures were relabeled as passes. Halt dependent implementation if a baseline failure prevents meaningful verification and record the exact blocker.

- [ ] **01.2 — Define the capture-library and audio contract.** Apply the execution contract above and inspect existing `indexedDB.ts`, `libraryUtils.ts`, `sessionStorageIndexedDB.ts`, `tp7Library.ts`, `deviceOperation.ts`, the waveform components, native streaming/backup helpers, and existing audio tests. Create `docs/tp7-capture-workflow.md` with the chosen native catalog persistence approach and rationale, source/occurrence/region/render/collection/transfer identities, schema migration strategy, atomic writes, source hash/provenance, and local-library root selection. Define source-rate integer frame positions, channel ordering, half-open region bounds, render recipe versions, cache invalidation, and explicit supported formats. Include a narrow-file implementation map for phases 02–06 and a path from existing IndexedDB preset data that does not migrate/delete it unnecessarily. The schema must carry the provenance and forward links the experience contract requires — which take a region came from, which outputs used it, and where each output was sent — so the UI can show them without a second store. Completion means later phases can share one schema and reuse map without inventing competing stores or parsers.

- [ ] **01.3 — Document device compatibility evidence and acceptance fixtures.** Apply the execution contract above. In `docs/tp7-capture-workflow.md`, research current official TE documentation for TP-7 recordings and OP-XY/OP-1 Field sample import; cite exact URLs, retrieval dates, and applicable firmware. Separate documented import formats/paths/duration/channel/sample-rate rules from assumptions and hardware-only checks. Specify raw sample versus playable patch/kit outputs; generic AIFF is not proof of a valid TE patch, and OP-XY JSON must never be sent to Field. Define generated fixtures for mono, stereo, multichannel, supported PCM/float formats, malformed/truncated headers, duplicate content, and recordings above 128 MB. For every target, state the user-visible consequence of each unsupported case — which control is disabled, what the explanation says, and which local-export fallback remains — so no unsupported path becomes a silent dead end. Completion means unsupported outputs have a stated fail-closed behavior and the hardware checklist can verify every remaining assumption.

- [ ] **01.4 — Write the experience contract into a usable reference.** Apply both contracts above; inspect `src/components/device/DeviceMediaPage.tsx`, `src/components/library/`, `src/utils/teDevices.ts` transfer hints, `docs/design-system.md`, and `docs/hardware-test-guide.md` for the existing voice and control vocabulary. Create `docs/tp7-capture-ux.md` containing: the happy path as numbered user actions with the target step count per the step budget; the single keyboard map for audition, mark in/out, save, rename, and next, checked for collisions with existing builder and macOS shortcuts; the mapping from every internal state defined in phase 06 to at most five user-facing statuses with their exact copy; error-copy rules with one worked example per device family, reusing the transfer-mode hints already shipped in `teDevices.ts` and `docs/hardware-test-guide.md`; the default library location and its relocation copy; first-run and empty-state copy for each new view; and naming defaults for takes, regions, and prepared outputs. Choose the new local library tab's label so it cannot be confused with the preset library, the on-device recordings browser, or the Sample lab builder, and record the label with its rationale. Do not introduce a second voice or a second design token set. Completion means every later UI task can be checked against written copy, a documented shortcut map, and a step count instead of inventing wording per component.

## Research context, not a compatibility specification

- Studio Field's TP-7 announcement: https://www.reddit.com/r/OP1users/comments/1wpbjsq/say_hello_to_tp7/
- Its published Mac features/release history: https://apps.apple.com/se/app/studio-field/id6790190192?platform=mac
- Official starting points: https://teenage.engineering/guides/tp-7 and https://teenage.engineering/guides/mtp

These references motivated the workflow; another app's claims do not establish Fieldwork's hardware support. Where that app is faster at the same job, treat its speed as the bar for the step budget, not its feature list as a checklist.
