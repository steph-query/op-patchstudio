# Fieldwork — Mac hardware testing

**Filling this in:** [`docs/hardware-results-sheet.md`](hardware-results-sheet.md) is the form — every check below as a line you can write on, plus the six timed comparisons with Fieldwork's half already measured. Copy it, date it, and work through it. This file is the reasoning behind each check; the sheet is what you carry to the bench.

The build under test and how it was made are at the end, out of the way of the path.

This build is a hardware-test candidate. Automated tests use a virtual MTP device and browser fixtures; these do not establish firmware compatibility or real USB reliability.

## Build and install

Prerequisites: Node/npm, Rust, Xcode command-line tools, and the Tauri CLI (`cargo install tauri-cli --version '^2'`). `npm run tauri -- --help` uses the installed Cargo CLI. `npm run build:mac` builds the frontend and packages the native app. The local test build uses `CI=true cargo tauri build --bundles dmg --no-sign -- --offline` after dependencies are installed. The CI environment flag skips Finder automation (the CLI's `--ci` flag alone does not); no Finder automation permission is needed.

The Apple Silicon DMG is under `src-tauri/target/release/bundle/dmg/`. It is unsigned for local testing, not a notarized public release. The DMG contains the app and an Applications shortcut. No device files are changed by installing or launching the app.

### Native startup diagnostic

After building, this opt-in diagnostic launches the actual packaged app hidden, waits for its connection controls, checks real IPC under the production CSP, then exits. It expects the disconnected-device error and never opens a USB session. Normal launches do not run the diagnostic. A native watchdog reports failure if the handshake never arrives.

```sh
mkdir -p .maestro
open -g -j -W --env DOXY_SMOKE_TEST=1 \
  --stderr "$PWD/.maestro/native-smoke-stderr.log" \
  src-tauri/target/release/bundle/macos/Fieldwork.app
```

Require `DOXY_NATIVE_SMOKE PASS` in the log; the exit status of `open` alone is not an assertion. Quit an already running Fieldwork or doxy instance before this check so Launch Services starts the diagnostic process. The legacy internal identifier and diagnostic names are retained for compatibility.

## First connection

1. Close Field Kit and other MTP transfer apps. Stop recording/playback before enabling transfer mode.
2. Connect USB and enable transfer mode. These are the same hints the app shows beside the device, from `transferHint` in `src/utils/teDevices.ts` — if they ever disagree, the app is right and this file is stale:
   - **OP-XY:** com › m4. Some firmware labels that key **t4**; it is the same slot.
   - **OP-1 field:** shift + com › t4. Disk mode, if you want it instead, is shift + com › shift + t4.
   - **TP-7:** stop recording first, then use **Prepare TP-7** with exactly one TP-7 connected in audio/MIDI mode and wait for it to switch. Holding ■ while powering on over USB is the manual route.
3. Select Find devices. Choose the intended device/serial number and Connect device. Multiple devices require an explicit selection. Only one active session is supported.
4. Check the displayed model and free space. A missing-root notice is meaningful; do not treat an incomplete inventory as a complete library.
5. Open Storage → Create backup. Retain the new folder and its manifest together. Run Verify backup before experimenting with uploads or recovery.

## Swapping instruments

One transfer session at a time, so this is the sequence a studio actually performs. Load a pad in the **Drum lab** while a TP-7 is connected, then disconnect and connect the OP-XY. You must stay in the Drum lab with the pad still loaded — no jump to another tab — and the tab set must change to the OP-XY's, with `recordings` gone rather than lingering as a dead option. Disconnecting *from* a device-only tab should hand you to its offline counterpart: `recordings` and `tapes` to **takes**, `install` and `storage` to the **library**.

Note the builder tabs read "drum (op-xy)" while a non-OP-XY instrument is attached, and plain "drum" once an OP-XY is. That is intentional labelling, not a glitch.

## Device checks

| Device | Read-only checks | Optional writes after backup |
| --- | --- | --- |
| OP-XY | Preset search/filter, bounded sample preview, original-byte ZIP export, nested projects and dependency reports, **check all projects** (confirm it names real sharers; that unreadable projects are reported as unknown rather than skipped; that **Stop reading** in the busy banner abandons it without publishing a partial answer; and that leaving the tab and returning does not re-read everything), storage, duplicate/unreferenced space review | Send a small newly named kit or multisample through the send review; make a copy. Try an existing name and confirm refusal. Install a sample into `samples/`; type a subfolder name and confirm the app stays responsive throughout (it used to rescan the device per keystroke). |
| OP-1 Field | Drum/synth patches; tapes and album sides; tape preview starts all recognized tracks together; per-track preview levels; select/export original tracks and tape.json | Additive restore of missing files only. Install a `.aif` sample into `drum/` or `synth/` — converted to 44.1 kHz/16-bit. **Each file arrives as its own file:** this app does not assemble a 24-key drum patch, because the OP-1 slice format is not established well enough to write (see `docs/te-companion-feature-research.md`). Whether the field loads a bare `.aif` from those folders at all is unverified. OP-XY builder sends are not available on Field. |
| TP-7 | Recordings/memos by capture date; search/filter; bounded WAV preview; original export; per-track stems streamed to disk with no size cap; import into the Takes library; **name a take** and confirm the device's own file is untouched (the recorder still lists the original name) | Additive restore of missing files only. Writing a wav into `recordings/` via Install samples (this firmware refuses new folders). |

## Capture workflow checks

These exercise the local library, which works with everything unplugged. Press `?` at any point for the full list of keyboard shortcuts; `⌘1`–`⌘9` move between the tabs, numbered as they appear.

**Checks 1, 4, 5 and 7 need no device at all.** Use **add files…** on the Takes tab to put a few recordings you already have into the library, and the audition, region marking, hand-off to a pad and loop check all work from there. Doing those first is worth it: anything awkward you find costs you nothing but your own time, and you arrive at the connected checks with the interface already familiar.

1. **Takes** opens a library at `~/Music/Fieldwork Library` on first launch with no dialog. Confirm the path shown is where you want it; use Change location if not. Then press **add files…** and choose a couple of recordings from this Mac: they should appear as takes, the originals should stay untouched where they were, and each take should record the path it came from. Add the same file twice and it must report *already in your library* with the file count unchanged.
2. With a recorder connected, press `import N new`. Confirm the count matches what you expected, then unplug and relaunch — the takes must still be listed with the device and capture time they came from. On an OP-1 field the count should cover `tape/` and `album/` only: your drum and synth patches are not takes and must not be offered here.
3. Import the same takes again. They should report as *already in your library*, not as errors or duplicates, and the file count must not grow.
   On an OP-1 field, check the harder case: import one tape side, then look again. **Every other side and track must still be offered**, even though the field names them all `track_1.aif`. A field whose tape reports "nothing new to import" after one import is the bug this check exists for.
4. Audition a long take: the waveform should appear without a wait, and playing from a late position should start promptly. Do this once with a TP-7 recording (WAV) and once with an OP-1 field tape track (AIFF) — the AIFF path converts byte order on the way out, so a Field take that plays as noise or draws a flat waveform is a real failure worth reporting. Mark in/out with `i`/`o`, save a named region, relaunch, and confirm the region is still there. Then **mark several hits in a row without touching the frame fields** — `i`, `o`, name, save, and straight on to the next. The waveform must stay drawn, the transport must stay live, and each save must leave your marks where you put them; the panel used to reset itself on every save, which is only obvious when you work this way rather than typing frame numbers.
5. Send a region to the Drum lab, check it landed on a free pad with its audio intact, **then quit and reopen the app**: the kit must still be there. Session saving stores sample audio in the browser database, and a WebKit build that refuses one of the shapes it used to store would lose the kit silently. If a kit built from regions is empty after a restart, that is the bug to report. `src/test/e2e/session-restore.e2e.ts` now covers this round trip in WebKit and fails if the stored shape regresses, so a failure here on hardware would point at something the browser suite cannot see — most likely the packaged app's storage origin rather than the shape.
   Continue: then send that kit to an OP-XY through the send review. Confirm the review names the right device and folder before you approve it, and that the Takes tab's history records the result.
6. Try a send whose name already exists on the device. It must be refused, and the refusal must be recorded as a failure in history rather than reported as success.
7. **Loop points.** The seconds-to-frames conversion and the inclusive end are now covered by tests (`patchGeneration.test.ts` asserts 0.5 s → 22050 and 1.5 s → 66149 at 44.1 kHz, and `aiffExport.test.ts` checks the writer agrees with the WAV writer frame for frame), so what remains unverified is narrower than before: whether the instrument reads that convention the same way. Build a multisample preset with a loop well inside a sustained sample, send it, and hold the key past the loop boundary. It should loop cleanly. If it clicks, or the loop is audibly one frame short or long, say so — the writers now treat loop points as *inclusive* frame indices, which is what the WAV `smpl` chunk and AIFF `MARK` markers specify, but whether TE's firmware reads the end as the last frame played is a firmware question. It is one line in one place if the answer is no.
8. Interrupt a send on purpose — unplug mid-write on a kit with several samples. Then press **Check the device**: it should list which files arrived and which did not. If it says *can complete*, reconnect and press **add the N missing files**, and confirm afterwards on the instrument that the kit plays every pad. This is the one path that writes into an existing folder, so it is worth watching closely the first time: nothing already there should change, and the file count in that folder should end up exactly the number of files in the kit.

## Restore semantics

Preview restore verifies the local snapshot and compares it with the connected device. It shows missing, identical, and conflicting files, required space, and the backup/destination serials. Nothing is written during preview.

Restore missing files and verify is available only without conflicts and with sufficient free space. The app rechecks the backup and device session before writing, skips byte-identical existing files, adds missing files, and verifies uploaded SHA-256 hashes. A disconnect invalidates the plan. A failed restore may leave newly created partial files; it never removes or overwrites existing content. Refresh and inspect any reported path before retrying.

This is additive recovery, not a destructive factory restore. Existing conflicting content blocks the entire operation. There is no automatic merge, overwrite, or project relinking.

Checksum comparison reads all matching device files during preview and again before restoring. This intentionally detects changes after preview, but large libraries can take a long time. Cancel preview stops checksum work at the next file/chunk boundary; it does not interrupt an outstanding USB response. Start hardware validation with a small library; byte-level progress reporting and cancellation during the write phase are not available yet.

## Interrupted sends and copies

Sending or copying creates a new `.preset` folder and verifies its contents. Failure may leave that new folder partially populated; the error identifies its path. Use **Check the device** in the send review to see exactly what that folder holds: each file is reported identical (bytes compared), different, or absent, and anything unexpected in the folder is listed. The verdict says whether the folder is already complete, can be completed, or is blocked because something differs.

When the verdict is **can complete**, the review offers **add the N missing files** — it writes only the files the device does not have, into the folder already there, and reads each one back. Files already on the device are never rewritten or replaced, and if that folder changes between the check and the press, the write is refused and you are asked to check again. Sending the same name as a *fresh* preset stays refused, so that button is disabled once a check has found the folder; the alternative is to cancel and use another name. The app still never deletes a partial folder automatically — remove one with your usual transfer tool if that is what you want. Preset sends are limited to 128 MB; audio bytes travel as binary IPC, not JSON number arrays.

## Current boundaries

- **Renaming and deleting files on the device are available, and both are verified rather than assumed** — each re-reads the object afterwards, so firmware that accepts a command and ignores it is reported as a failure instead of leaving the list showing something untrue. They were disabled until 2026-09-27; the owner asked for both while testing a TP-7, where a recording is named after the moment it was made and nothing points at it.
  - A **write** still never replaces anything: a name already in use is refused before the transfer.
  - A **rename** is refused where the name *is* the reference: an OP-1 field tape track (`track_1.aif` … `track_4.aif`, where the number is the track) and any change of file extension.
  - A **rename of an OP-XY sample is allowed**, and can orphan a project reference — projects reference samples by path, and this app does not rewrite them. Use *check all projects* first. Deleting has the same caveat, and dependency inspection is still partial: an unresolved or absent reference does not mean a file is unused.
  - **Deleting is irreversible.** There is no device-side trash. The confirmation names which of the selected files are already in your takes library and which exist nowhere else; take it seriously, because it is the only thing standing between a mis-click and a lost recording. Folders are refused — select the files inside instead.
- **The sample-usage sweep narrows that question without closing it.** *Check all projects* reads every `.xy` on the device and names which projects share each sample, and it reports unknown rather than unused whenever a project could not be read. Three gaps remain, and each is enough on its own to keep deletion disabled: path inspection is heuristic, so a reference in a form the reader does not recognize is indistinguishable from no reference; only the connected device is covered, not copies of the same projects on a Mac or another card; and the sweep reads projects, so it is not evidence about what a preset holds. Treat it as *"no project on this device names this file"* — which is what it says — rather than as permission to remove anything.
- **WAV and AIFF are the only containers this app opens.** Anything else — an mp3 or flac someone copied onto a card — is listed as "other" rather than offered as a recording, and is named as unreadable rather than blamed on a broken WAV. **Create backup still copies it byte for byte** — a backup walks every file under the library roots regardless of type, so nothing on the card is left out of a snapshot. What it will not do is offer that file in the recordings or tapes list, so it cannot be selected there for a one-off export. Sample depths are likewise limited to what the decoder handles (8/16/24/32-bit integer, 32/64-bit float), because accepting a 48-bit file meant playing it as silence.
- WAV/AIFF previews load up to 30 seconds from the entered starting position. Devices without partial-read support return a visible error; original exports stream to disk. Non-audio synth patches may not have playable audio.
- Stem export is derived audio: samples keep their exact bit depth and sample rate, but non-audio container metadata is not copied. Splitting streams to disk, so length is bound by free space rather than memory.
- Firmware notices are dated research snapshots, not live update checks.
- No live audio/MIDI routing, transcription, destructive restore, or general waveform editor is promised by this device-management build. Existing sample builders retain their waveform editing.

## Failure checks

Start with disposable newly named content and a verified backup. Check duplicate-name rejection, cancel native dialogs, confirm no success message follows a failed transfer, and confirm refresh/disconnect cannot interrupt an active operation through the UI. Report device model, firmware, macOS version, operation, and full error text. Do not deliberately disconnect during the first restore test on valuable content.

## Verified test build

| | |
| --- | --- |
| Version | 0.19.0 (frontend, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json` all agree) |
| Artifact | `src-tauri/target/release/bundle/dmg/Fieldwork_0.19.0_aarch64.dmg` |
| Size | 4,912,431 bytes |
| SHA-256 | `9f24a2d0b3dc39be1f9d309189ec1c9abf4e1781ef1dfe67efcae73bddcf360d` |
| `hdiutil verify` | checksum VALID |
| Packaged startup diagnostic | `DOXY_NATIVE_SMOKE PASS: Rendered connection UI; native device IPC returned: No device connected` |

Built 2026-09-25 in two steps, which is the reliable route in this environment:

```sh
npm run tauri build -- --bundles app        # builds Fieldwork.app, no DMG step
stage=src-tauri/target/release/bundle/dmg-stage
mkdir -p "$stage" && cp -R src-tauri/target/release/bundle/macos/Fieldwork.app "$stage/"
ln -s /Applications "$stage/Applications"
hdiutil create -volname Fieldwork -srcfolder "$stage" -ov -format UDZO \
  src-tauri/target/release/bundle/dmg/Fieldwork_0.19.0_aarch64.dmg
```

`--bundles app` is not a workaround for a broken build; it simply stops before the step that cannot run here. The bundler's own DMG step cannot complete in this environment. Its final act is a cosmetic AppleScript that arranges the Finder window, and that needs Automation → Finder permission for whichever process sends the Apple event; without it the script fails with *"Not authorized to send Apple events to Finder. (-1743)"* and `bundle_dmg.sh` aborts **after** the `.app` has been built successfully. The `hdiutil` route produces the same installable disk image — drag the app to Applications — without the arranged icon layout.

**If `hdiutil verify` reports "Resource temporarily unavailable", the image is still attached from a previous run.** It happens when a mount is left half-open: `hdiutil info` lists the image with no mount point, and the file stays held so nothing can read it. `hdiutil info | grep -A12 Fieldwork` gives the `/dev/diskN` entry; `hdiutil detach /dev/diskN -force` releases it and verification then succeeds. Worth knowing because the failure looks like a corrupt image and is not one. Granting that permission in System Settings → Privacy & Security → Automation restores the bundler's own path if the layout is wanted. Failed bundler runs also leave `rw.*.dmg` scratch images in `bundle/macos/`; they are safe to delete.

Unsigned and not notarized: macOS will require an explicit right-click → Open, or Privacy & Security → Open Anyway, on first launch. This is now the only DMG in `bundle/dmg/`: the bundler removes earlier artifacts on each run, so there is no older build to install by mistake.

**This is the build to test**, and the only one available. It carries everything in the current pass: AIFF reading for field takes, the capture-folder and deduplication fixes, the keyboard layer, completing a partly written preset, the loop-point corrections, the dead-end fixes, the sample-usage sweep, the error-message and count-agreement fixes, naming a take, and the responsiveness fixes — all recorded in `docs/tp7-capture-validation.md`.

The diagnostic was run on the app **extracted from this DMG**, not on the build directory. Mount the DMG, copy `Fieldwork.app` out, run the diagnostic against the copy, and clear `.maestro/native-smoke-stderr.log` first. Testing the artifact rather than the build tree is the point, and it also avoids a trap that has produced a false pass here before: on the bundler's own path `Fieldwork.app` is deleted after packaging, so a run against that path reads a stale log from an earlier build and reports its result. (On the `hdiutil` path the app survives, because the bundler aborts before that step.)

Also confirmed present in **this** artifact, by `strings` on the packaged binary: `complete_preset_send`, `reconcile_preset_send`, the AIFF reader's refusals (`not a WAV or AIFF recording`, `compressed (`), the completion guard (`changed since you checked`) and the install path's corrected collision message (`does not replace or delete device content`). The frontend is embedded compressed and cannot be grepped inside the binary, so the `dist/` bundle that was embedded was checked instead: it contains `Keyboard shortcuts`, the audition's `reading this take`, the capture-folder explanation (`Takes come from there`), the zoom editor's `audio is not loaded`, the project sweep's `check all`, `sharing unknown`, `check the only project` and `does not establish that any file is unused`, the install preflight's `could not be read:`, and the take-naming control's `Nothing on the device is renamed` beside the native `catalog_label_asset`. Pluralization now built from a ternary does not appear as a literal, so it was confirmed as the minified `"item":"items"` pair instead. The icon fonts were checked the same way: `fa-solid-900-…woff2` is present in the binary and `fa-brands`, `fa-regular` and `fa-v4compatibility` are gone, which is where 304 KB of this DMG went. Every non-test source file predates both `dist/` and the compiled binary, so nothing in the current pass is missing from it.

The diagnostic result is the meaningful part: it ran the **packaged** app under the production CSP, the webview rendered the connection controls, and a real IPC command reached the native layer and returned the expected disconnected-device error. That is the one property no unit test can establish — a CSP or `withGlobalTauri` mistake would ship a DMG whose device features are silently dead. No USB session was opened.
