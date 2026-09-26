---
type: research
title: "What field-system owners actually want from a companion app"
tags: [fieldwork, research, op-xy, op-1-field, tp-7, macos]
created: 2026-09-25
---

# What field-system owners actually want from a companion app

Community reports and vendor documentation gathered 2026-09-25 to decide what Fieldwork builds next. These are qualitative signals from public posts, reviews and official guides — not a survey, and not hardware verification. Every constraint below is marked **documented** (vendor guide), **community** (consistent third-party reports) or **assumed**. Fieldwork must fail closed on anything not documented.

## Demand, ranked by how often and how bitterly it comes up

| # | What owners want | Evidence | Fieldwork today |
| --- | --- | --- | --- |
| 1 | **File transfer and backup that works on Apple Silicon at all.** Field Kit is reported as not launching on M-series Macs, crashing, and leaving owners unable to back up a $1,499 recorder; several describe running Windows or Android File Transfer instead. | [Field Kit Mac reviews](https://apps.apple.com/us/app/field-kit/id1612653346?mt=12), [TP-7 review coverage](https://www.gearnews.com/teenage-engineering-tp-7-review-studio-tech/), [OP-1 field MTP thread](https://op-forums.com/t/no-tape-or-album-folders-when-i-connect-op-1-field-to-my-macbook-in-disk-mode/23843) | **Solved.** Native `mtp-rs` session, no Field Kit dependency; verified checksum backup + additive restore. This is the app's strongest claim. |
| 2 | **Get samples onto the device without fighting formats and folders.** Sound-pack installation is "drag the folder onto `samples/`" or onto `drum/`/`synth/`; owners hit duration caps, wrong rates, and names that fail to transfer. | [OP-XY sound packs](https://teenage.engineering/downloads/op-xy/sound-packs), [OP-1 field preset install](https://soundghost.net/how-to-install-op-1-field-presets/), [OP-XY sample guide](https://teenage.engineering/guides/op-xy/sample) | **Shipped this pass.** An Install samples tab for all three devices: files or folders in, per-file preflight, conversion only where required, verified non-overwriting writes. Field kit/patch *encoding* is **not** attempted, and the reason is recorded below. |
| 3 | **See and prune what is on the device without fear.** Owners find the same audio in `samples/` and inside preset snapshot folders and do not know what is safe to delete. | [OP-XY files thread](https://op-forums.com/t/op-xy-files-loading-samples-presets-backing-up-naming-editing/28445), [storage thread](https://op-forums.com/t/op-xy-storage-and-file-structure/28915) | **Answered this pass.** The Storage tab now names every file that exists in two places, the bytes that go beyond one copy of each, and the library samples no readable preset points at — with an exportable report and its own limits printed beside the numbers. Deletion stays disabled on purpose. |
| 4 | **Rename and organize.** The OP-XY cannot rename recorded samples on the device; owners want categorized parent folders for snapshots. | Same OP-XY threads as #3 | **Half answered.** Device rename stays disabled. But a take in your *own* library can now be named — `2026-02-23_112713_000.wav` becomes "yard door slam" — as a **label, not a file rename**, so deduplication and provenance both survive. Categorized parent folders for device snapshots remain out. |
| 5 | **Turn long recordings into usable samples.** TP-7 multitrack takes are split by hand in Audacity; owners want per-track stems and clips without a DAW round trip. | [TP-7 Utility thread](https://op-forums.com/t/tp-7-utility-convert-multitrack-recordings-with-drag-drop-on-macos/29597) | **Improved this pass.** Stem splitting now streams natively, so length is bound by free disk rather than memory and the 128 MB cap is gone. The capture library and regions remain playbook phases 02–04. |
| 6 | **Predictable pitch and root notes for multisamples.** The multisampler mis-tunes name-pitched samples (a `c0` file arriving at `+60.00`); building 24-zone sets by hand is the usual complaint. | [OP-XY files thread](https://op-forums.com/t/op-xy-files-loading-samples-presets-backing-up-naming-editing/28445), [multisample automation thread](https://op-forums.com/t/automated-creation-of-multi-samples-for-op-xy/28808) | **Closed this pass.** The multisample builder now warns when a filename's note disagrees with the assigned root note, naming both values and the fix, because the device falls back to the filename when a sample carries no pitch metadata. |
| 7 | **Basic sample surgery the devices lack** — trims on zero crossings, fades, normalization. | [OP-1 field owner threads](https://www.modwiggler.com/forum/viewtopic.php?t=261954&start=375) | **Solved for builders.** `findNearestZeroCrossing` / waveform editors already ship; playbook phase 04 extends them to long takes. |
| 8 | Tape and album handling for OP-1 field: browse, audition four tracks together, export, and build a tape from finished audio. | [Studio Field thread](https://op-forums.com/t/studio-field-a-macos-companion-app-for-the-op-1-field/31801) | **Solved for reading; partly for writing.** Tape/album views with synchronized bounded preview and original export, plus Build a tape: up to four files become `track_1.aif`–`track_4.aif` at 44.1 kHz/16-bit stereo, exported to a folder. No device write — replacing a tape is destructive and the format is unverified. |
| 9 | Cloud sync, community sharing, mobile apps, marketplaces. | Studio Field's roadmap | **Out of scope** — personal tool. |

The recurring theme is not features, it is **trust plus speed**: owners want to know the transfer worked, and they want the boring steps gone. That is why this pass adds a preflight that states exactly what will be written and what will change before anything is written.

## Documented device constraints this app must honor

Sources: [OP-XY sample guide](https://teenage.engineering/guides/op-xy/sample), [OP-XY sound packs](https://teenage.engineering/downloads/op-xy/sound-packs), [OP-1 field preset install](https://soundghost.net/how-to-install-op-1-field-presets/), [Field Kit guide](https://teenage.engineering/guides/fieldkit), [MTP guide](https://teenage.engineering/guides/mtp), [TP-7 CLI research](https://github.com/totocaster/tp7/blob/main/docs/spec.md).

| | OP-XY | OP-1 field | TP-7 |
| --- | --- | --- | --- |
| Sample formats | aiff and wav — **documented** | `.aif` — **documented** | wav; mp3 playback added in 1.1.9 — **community** |
| Duration cap | 20 s for all samplers — **documented** | drum kit 12 s mono / 20 s stereo at 44.1 kHz/16-bit — **community** | n/a (recorder) |
| Slot limits | 24 one-shots per drum kit; 24 zones per multisample — **documented** | 24 slices per drum kit — **community** | n/a |
| User sample location | `samples/` (recordings land in `samples/user/`); subfolders allowed — **documented** | `drum/` and `synth/`, with `user` or any custom subfolder — **documented** | `recordings/`, `memo/` — **community** |
| Pack install | drag pack folder onto `samples/` — **documented** | drag pack folder into `drum/` or `synth/`; firmware ≥ 1.2.9 — **documented** | drop multitrack wav into `recordings/` to edit on device — **community** |
| Folder creation over MTP | works | works | **rejected by firmware 1.1.9** — plan writes into existing folders only |
| Transfer mode | `com` then `M4` per Field Kit guide; TE's sound-pack page says `T4`. The app now shows both labels until hardware confirms. | `shift` + `com` then `T4`; disk mode `shift` + `com` then `shift` + `T4` | SysEx mode switch from the app, or hold ■ while powering on |
| Pitch detection | wav metadata first, then the note in the filename (`a3`) — **documented** | root note from AIFF `INST` — **community** | n/a |

Unknowns to resolve on hardware, not by guessing: exact OP-XY sample rate/bit-depth acceptance beyond wav/aiff, whether the OP-XY COM label is M4 or T4 on current firmware, Field behavior for nested pack folders, and whether TP-7 accepts arbitrary wav rates in `recordings/`.

## What this research changed

1. Built `src/utils/sampleTargets.ts`: one documented profile per writable sample destination across the three devices, plus a pure planner that reports per-file conversions, renames, duplicates, slot limits, folder-creation refusals and space use **before** any write. Every limit carries its evidence class in code.
2. Confirmed the playbook's priority order: capture library (#5) and local install/preparation (#2) are the two real gaps; rename/delete (#3, #4) stay conservative on purpose because the community's own confusion about snapshot duplicates is evidence that automatic cleanup would be dangerous.
3. Added the filename-pitch warning to the planner's remit, because the device reading `c0` from a name is documented behavior and a silent mis-tune is indistinguishable from a broken transfer.

## Install samples — what shipped for gap #2

A working **Install samples** tab, present for all three device profiles (`src/utils/teDevices.ts`), wired in `MainTabs.tsx` / `TabNavigation.tsx`:

- `src/utils/sampleTargets.ts` — one profile per writable destination (OP-XY `samples/`, OP-1 field `drum/` and `synth/`, TP-7 `recordings/`) and a pure planner that reports renames, conversions, warnings, refusals, slot use and space **before** anything is written.
- `src/utils/samplePreparation.ts` — probes a file with the existing `readAudioMetadata`, then either passes the **original bytes through untouched** when the target already accepts them, or converts with the builders' own `audioBufferToWav` / `audioBufferToAiff`. An unnecessary re-encode is a silent quality loss, so it is avoided by default.
- `src/components/device/SampleInstallPanel.tsx` — drop or choose files, pick the destination folder (and an optional subfolder where the device allows one), review every row, then send. Each row shows what it will be saved as, what will change, and why it was skipped. The batch stops at the first failure and says exactly how many files were written; writes go through the verified, non-overwriting `mtp_upload_at_path`, and the device's own duplicate refusal remains the backstop when the inventory scan fails.

Behavior worth noting: the panel reads the destination first so it can rename around collisions (`kick.wav` → `kick 2.wav`) rather than relying on a refusal; a TP-7 subfolder is refused up front because that firmware rejects folder creation; and the OP-1 field's two folders are offered as an explicit choice rather than guessed.

## Why Fieldwork does not write OP-1 field drum patches

Gap #2 previously listed "kit/patch encoding for Field" as playbook phase 05, still to come. It should not come, and this is the evidence.

A field drum patch is not a folder of samples. It is one `.aif` holding every slice end to end, plus an `APPL` chunk whose payload begins `op-1` and carries JSON with `type: "drum"`, a `drum_version`, and `start`/`end` arrays of 24 slice positions. This app already *reads* that format in `src/utils/op1DrumPresetParser.ts`, which is what made it worth checking whether it could also write it.

**It cannot, because the reader does not know the units of `start` and `end`.** It guesses: a heuristic treats values more than ten times the frame count as byte offsets rather than sample frames, and if the largest value still exceeds the audio present, every position is **rescaled proportionally to fit**. That is a reader coping with an unestablished format, and it works for reading because a human hears immediately whether the slices landed in the right places.

Writing has no such feedback. Emitting the wrong unit, or the wrong `drum_version`, produces a file that looks correct, transfers correctly, verifies byte for byte — and plays its slices in the wrong places on the instrument, with nothing in the app able to tell the user why. So the app does not write it.

What it does instead is state that plainly. The field drum and synth targets used to read *"load as a drum patch from the drum snapshots"*, which a bare `.aif` cannot be. They now read *"keep a sample alongside your drum snapshots"*, and the note says each file arrives as its own file, that this app does not assemble a 24-key patch, and why.

**A false refusal fixed in the same place.** The field drum target carried `maxItems: 24` — but 24 is the number of keys in a *patch*, not the number of patches a folder holds. Because the planner compares it against the files already in the destination, installing into a folder that held two dozen patches refused **every** file with *"op-1 field drum folder holds 24 items and is full"*, which is not true of any field. None of these devices documents a per-folder item limit, so no profile sets one now; the mechanism is kept for a limit that is genuinely established, and its test uses a synthetic profile rather than asserting a false fact about real hardware.

## Multitrack stems — what shipped for gap #5

`src-tauri/src/stems.rs` splits an interleaved multichannel take into per-track stems **as it streams off the device**, so a full-length 96 kHz/24-bit TP-7 recording is limited by free disk, not by memory:

- Parses the RIFF header incrementally, asking for more bytes rather than guessing, and refuses compressed, extended or self-inconsistent files instead of reinterpreting them as PCM.
- Carries partial frames across chunk boundaries, so the output is byte-identical whatever size the USB chunks arrive in. Sample values, bit depth and sample rate are copied verbatim; only the canonical 44-byte header is written.
- Stops at the declared data length (trailing `LIST` chunks never become audio) and discards an incomplete final frame rather than padding it into a click.
- Groups channels into stereo pairs with a mono stem for an odd final channel, refuses a take with nothing to separate, writes into a new folder it creates, and deletes that folder if the transfer fails.

The old in-memory path, its 128 MB ceiling and the whole-file read in `DeviceMediaPage.tsx` are gone; the button now reports which tracks were written, where, and at what format.

## Space review — what shipped for gap #3

`src/utils/deviceRedundancy.ts` plus a new Storage section answer the question the forum threads keep asking — "the same audio is in `samples/user/` and inside a preset, what can go?" — without answering the part it cannot prove:

- Groups device audio by name and size, so a library sample and a preset's snapshot copy are shown side by side with their full paths and the bytes used beyond a single copy.
- Lists library samples that no readable preset region names, labelled "not the same as unused".
- Prints its own limits next to the findings: name-and-size is a likely match rather than a certain one, a preset snapshot is *meant* to be a second copy, preset-only analysis is incomplete without project references, and none of it is a deletion recommendation.
- Exports the whole thing as JSON with the device identity, scope and caveats inside the file.

There is deliberately no clean-up button. The community's own uncertainty about snapshot duplicates is the evidence that an automatic sweep would destroy work.

Transfer-mode hints now come from the device profiles instead of a hardcoded sentence, and the OP-XY hint carries both labels (`com › m4`, "labelled t4 on some firmware") because teenage engineering's own pages disagree — a wrong hint is a first-connection dead end.

## Filename pitch warning — what shipped for gap #6

`src/utils/pitchNaming.ts` finds the note a device would read out of a filename and compares it with the root note the builder assigned. A notice above the multisample table names the offending files, both values and the remedy. It compares note *spellings* under the app's active C3/C4 convention rather than asserting the device's own mapping, ignores files with no note in the name, and never treats a bare number (`snare 024.wav`) as a pitch. Deliberately dependency-free so it works in components whose tests replace the audio utilities.

## Capture library — playbook phases 02 and 03

`src-tauri/src/catalog.rs` is the durable local library imported takes live in, so a recording survives unplugging the recorder and quitting the app:

- **Identity is the SHA-256 of the bytes**, never a filename or an MTP handle. Reimporting the same audio under a different name records a second *occurrence* — device, serial, source path, capture time — instead of a second copy. Importing the exact same file twice adds nothing.
- **Different audio with the same name is stored beside it** (`take.wav`, `take 2.wav`); an existing original is never overwritten.
- **Every index write is atomic**: written to `fieldwork-catalog.json.writing`, flushed, fsynced, then renamed, so an interrupted import cannot leave a half-parsed library.
- **Refuses rather than damages**: a foreign index, an unreadable one, or one written by a newer version of the app is reported and left untouched. Names containing path separators are refused rather than silently flattened into a different file.
- **Imports stream** through the same verified path as backups, hash-checking every file before it is published; a failure mid-batch keeps the takes that already landed.
- Default location is `~/Music/Fieldwork Library`, created without a dialog, with an explicit "choose a folder" command for anyone who wants it elsewhere — per the experience contract's "sensible defaults instead of prompts".

A **Takes** tab now sits on top of it, reachable with nothing plugged in and with any of the three devices connected:

- Opens the library at `~/Music/Fieldwork Library` on first run with no dialog, shows where it is, and offers Change location for anyone who wants it elsewhere.
- Lists each take with its stored path, the device and device path it came from, its capture time, and a note when several sources hold the same audio.
- Search covers take names, source paths and device names.
- One **import new** action offers only the device takes not already held — labelled "matched by name", with content verification during the import itself — and reports the outcome as *imported / already in your library / failed*, with the reason for each failure. Duplicates are a normal result, not an error.
- Import sources differ per device: the OP-XY's sample library, the OP-1 field's and TP-7's scanned trees.

## Audition and regions — playbook phase 04

`src-tauri/src/localaudio.rs` makes a long take usable without loading it, reusing the same validated WAV reader as the stem splitter so there is one definition of what counts as readable audio:

- **Describe** a take — rate, depth, channels, frames, duration — from its header alone, never its audio.
- **Read a window** of frames as a playable WAV with the source's samples byte-for-byte intact, so the last ten frames of a 900 MB take cost the same as the first ten. Windows clamp to the end of the file rather than failing, refuse a start past the end, and cap a single read at 32 MB.
- **Summarise** a whole take into per-channel min/max peaks by streaming it once in 1 MB chunks, carrying partial frames across chunk boundaries. Peaks cache to `peaks/<asset>-<buckets>-v1.json` through an atomic rename; a cache that is stale, truncated, from another asset, from another resolution, or simply corrupt is recomputed rather than trusted, and a cache that cannot be written is not an error the user sees.
- Empty and very short takes summarise as silence rather than leaking `f32::MAX` sentinels into a waveform.
- Stored paths are resolved inside the library only: an asset whose recorded path climbs out with `..` is refused, as is a symlink.

Every sample encoding the app accepts — 8/16/24/32-bit PCM and 32/64-bit float — is decoded under test at known values.

On top of that, the Takes tab now auditions a take and marks named spans in it:

- The waveform is drawn from cached peaks and the header alone; a 900 MB / 26-minute take renders **without reading its audio at all** (asserted in test).
- Play from the playhead reads a bounded 30-second window, not the file. Double-click the waveform to play from that point; play region plays just the marked span.
- Keyboard: space plays or stops, `i` marks in, `o` marks out — suppressed while a field has focus.
- Marks optionally snap to the nearest zero crossing, reusing the builders' own `findNearestZeroCrossing` over a 2048-frame neighbourhood rather than a second implementation. A failed snap read leaves the mark where it was instead of blocking.
- Regions are **metadata**: name plus frame positions, saved in the catalog, recalled after relaunch, with the audio provably untouched (a test compares the original bytes before and after). Region names default to the take name plus a number, so marking never stops to ask for typing.
- A library written before regions existed loads with none rather than failing — the field is optional in the schema.

## Region to builder — playbook phase 05.2

`src/hooks/useRegionHandoff.ts` closes the loop from field recording to playable kit without a Finder round trip. A saved region's *to drum lab* / *to sample lab* buttons render the marked span to a real WAV and hand it to the **builders' existing upload path** — the same `useFileUpload` handlers a file dragged from Finder goes through — so a capture gets the same metadata reading, waveform editing and preset generation as any other sample. Nothing about the take on disk changes.

- Lands on the **first free pad** rather than overwriting a loaded one, and refuses with "All 24 drum pads are in use" instead of touching the builder when there is no room. Same for the sample lab's 24 zones.
- Switches to the builder tab so the clip is visibly where it went, and names the pad or zone it landed on.
- Refuses a region longer than one bounded read (30 s) before reading anything, and separately *warns* when a clip exceeds the OP-XY's documented 20 s playback limit while still handing it over — the builder can trim it.
- A failed read reports itself rather than loading an empty pad.

## Reviewed sends and transfer history — playbook phase 06.1, 06.5, 06.6

Both builders used to upload the moment their send button was pressed. They now describe the write, and it happens only after one confirmation:

- `src/components/common/SendReview.tsx` names the device and its serial, the exact destination folder, every file with its size, and what the audio will be (`44.1 khz · 16-bit · mono · .wav`). It states that an existing preset of that name is refused rather than replaced and that bytes are read back before anything is called sent. There is no second dialog — this is the one step the send costs.
- `src/hooks/useConfirmedSend.ts` is shared by the drum and sample builders, so neither can bypass the review through an older path. The upload's own safety properties are untouched: still non-overwriting, still read back and compared.
- Every write is recorded in the library's transfer history — device, serial, destination, files, outcome — **including failures, with their reason**. A history write that itself fails never turns a successful send into an error, and never turns a failed one into a silent one.
- The Takes tab shows that history, so a sound on an instrument traces back to the take it came from. If history cannot be read, the library still works.

## A testable Mac build

Packaged and checked on 2026-09-25 so the work can actually reach hardware:

- Version bumped to **0.18.0** across `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock` and `tauri.conf.json`, leaving the older 0.17.0 DMG intact.
- `Fieldwork_0.18.0_aarch64.dmg` built offline, `hdiutil verify` reports a valid checksum, SHA-256 recorded in `docs/hardware-test-guide.md`.
- The **packaged app's** startup diagnostic passed: `DOXY_NATIVE_SMOKE PASS: Rendered connection UI; native device IPC returned: No device connected`. That exercises the production CSP and real IPC in WKWebView — the one risk the round-2 review flagged as never executed, where a mistake would ship a build whose device features are silently dead. No USB session was opened.
- The four new native commands are present in the shipped binary, and the packaged frontend contains the new surfaces.

Still unsigned and not notarized, so first launch needs right-click → Open. Signing remains one of the four places `docs/companion-app-comparison.md` records Fieldwork losing to Studio Field.

## Several regions into a kit at once

Marking eight hits in one take and placing them one at a time was the slow part of building a kit, so the region list takes a selection and `sendMany` places them together:

- Regions go out in **start order**, filling consecutive free pads, and the tab switches once.
- Free pads are chosen **up front**. Re-scanning per region looked correct and was not: the builder's state does not update between awaits, so every region in a batch targeted the same pad and would have overwritten the previous one. A test caught it.
- What does not fit is **named**, not dropped: "2 did not fit (c, d); make room and send them again."
- A batch with no room reads nothing at all, and the first failure stops the run and says how many arrived — a half-filled kit is never reported as complete.

## Build a tape — the one creative gap Studio Field had

`src/utils/op1Tape.ts` plus a Build a tape panel in the tapes tab turn up to four finished files into an OP-1 field tape set:

- Files fill `track_1.aif` … `track_4.aif` in order, converted to 44.1 kHz / 16-bit stereo through the builders' own AIFF exporter. Empty slots are **not written**, so whatever sits in those slots on the device is left alone.
- Every conversion is stated before anything is produced; a fifth file is refused rather than silently dropped; a non-audio file is refused with its reason; unknown metadata warns instead of being assumed.
- A source longer than the six minutes an OP-1 tape held **warns** ("the device may truncate it") rather than blocking, because the field's actual limit is not vendor-documented.
- Output goes to a folder the user picks, and the panel says why: **replacing a tape is destructive and the format is not vendor-documented, so this app will not write it over USB.** Copying the folder in is one drag and stays the user's decision.
- It says outright that slice markers are not produced, because the `tape.json` schema is unverified — the tape will play, it will not show segments.
- A file that cannot be decoded stops the export and reports how many tracks were already saved; existing files are never overwritten.

## Naming a take — gap #4, the half that carries no device risk

The least-served demand in the table above, and the reason was a good one: renaming on the instrument is refused because project-dependency coverage is partial, and that refusal is not moving. But the demand is not really about the device. A TP-7 hands you `2026-02-23_112713_000.wav`, and in a studio that recording is "yard door slam". Naming *your own copy* carries none of the device's risk and had simply never been built.

**It is a label, not a rename, and that is the whole design.** The library is content-addressed: a take's identity is the SHA-256 of its bytes, and those bytes live at `stored_path`. Renaming the file on disk would mean a filesystem operation that can fail halfway, a `stored_path` that no longer matches what the catalog recorded, and the loss of the name the recorder gave the file. A label costs none of that, is reversible by clearing the field, and leaves re-import deduplication — which keys on the hash — untouched. `original_name` is never written again after import; once a take has a label the list shows *"filed as 2026-02-23_112713_000.wav"* beneath the chosen name, because that is still what the device calls the file.

- `catalog_label_asset` writes one field. Names are capped at 120 characters and refuse `/`, `\`, `:` and control characters **by name** — a take name ends up in a filename downstream, so the characters that would break that are rejected with the reason rather than silently stripped.
- Two native tests pin the invariant: labelling leaves id, `stored_path`, `original_name`, byte count and occurrences all unchanged; and a library written before labels existed loads unchanged and does not gain an empty field (`skip_serializing_if` keeps the absent case absent).
- Search matches **either** name, because the owner thinks "yard" and the device still says `112713`.
- Enter saves, escape abandons, and a rejected name keeps what was typed — retyping a rejected name from scratch is the annoying part, not being told. Blur deliberately does nothing: committing on blur means a save button's own mousedown fires before its click, which is exactly how one multisample zone's key ended up applied to another earlier in this work.
- The panel's accessible name follows the label, so a screen reader announces the take the way its owner refers to it. A test asserts this by watching a locator built from the old name stop matching.

Two mistakes of mine, both caught by tests rather than by reading:

**`takeStem` turned "take 2.1 rough" into "take 2".** It stripped a file extension from whatever `takeName` returned — but only `original_name` is a filename. A typed label has no extension, and a dot inside one is not the start of one. Fixed to strip only the filename branch.

**I created `src/components/library/library.css` and nothing imported it**, so every rule in it was dead on arrival; the audition panel is styled from `device-media.css`. Moved and the stray file deleted. Worth recording because nothing would have failed — the feature worked, unstyled, and a new stylesheet that no component imports is invisible to every check in this repo.

## Verification of this pass

Run 2026-09-25 on this checkout; logs in `.maestro/tp7-capture-validation/`.

- `npm test` — **604 tests in 53 files pass** (`full-tests.log`): 22 planner tests, 8 conversion tests against a real synthetic WAV, 10 install-panel tests (send path, rejected over-length file, collision renaming, mid-batch failure, failed inventory scan, OP-1 field folder choice, TP-7 folder refusal), 3 stem-export tests including a 900 MB take, 14 redundancy-analysis tests, 4 Storage space-review tests, a connection-bar test asserting the hints come from the profiles, 13 pitch-naming tests including the reported `c0` case, 8 Takes-tab tests (default-location first run with no dialog, provenance display, search, candidate filtering, duplicate and failure reporting, OP-XY import source, refusal of a newer library, cancelled picker), and 8 audition tests (header-only rendering, bounded window playback, keyboard marking, region save/recall/remove, suggested names, disabled zero-length save, surfaced read failure), and 9 handoff tests (first free pad, full pads and zones refused without a read, over-long refusal, device-limit warning that still hands over, failed read, remaining capacity), and 11 confirmed-send tests (nothing written before confirmation, cancel leaves the device untouched, one write on confirm with a verified history entry, a failure recorded as a failure with the review left open, history failure not masking a good send, refusal without an OP-XY, refusal of an empty preset, and the review dialog's contents), 14 tape-planning tests and 7 tape-panel tests (track order, stated conversions, cancelled picker writing nothing, a mid-export failure reporting what was saved, a refused fifth track, and the no-USB-write statement), 9 describeError tests, and 9 batch-handoff tests (start order, consecutive free pads, partial fit naming what was left out, no-room refusal reading nothing, first-failure stop, sample-lab batch, empty selection).
- `cargo test --offline` — **70 native tests pass**, including 9 for the stem splitter: header parsing, incomplete prefixes, refusal of compressed and inconsistent files, channel grouping, byte-identical output across seven different chunk sizes, verbatim channel copying, declared-length truncation, partial-frame discard, and RIFF/data length patching; plus 10 catalog tests covering reload, hash dedupe, name collision, path-separator refusal, foreign/newer index refusal and atomic commit; plus 10 local-audio tests covering header description, late-window reads with verbatim samples, window clamping and refusals, per-channel peaks, chunk-boundary invariance over a 400,001-frame file, silence for empty takes, cache staleness, path-escape refusal and every supported sample encoding; plus region tests covering legacy libraries without the field, persistence across a reload with the audio byte-identical afterwards, refusal of an empty name or a zero-length span, transfer history keeping failures with their reason, and a library without history still loading.
- `npm run build` and `npx tsc -b` — clean; `cargo clippy` clean for the new modules (two pre-existing warnings remain in `backup.rs`).
- `npx eslint` over every new and modified source file — zero problems.
- The 35 remaining eslint errors in `src/test/setup.ts` and `src/test/utils/smplChunk.test.ts` are pre-existing `no-explicit-any` debt on untouched lines.
- Capability comparison against Field Kit, Studio Field, DigiChain and the tp7 CLI recorded in [[companion-app-comparison]], including the four capabilities where Fieldwork loses.

Two defects were found and fixed in this pass, both in code written here: a filesystem charset that would have stripped hyphens out of TP-7 timestamp filenames, and a block message that said "mono limit" for a device with no separate mono cap.

**Latent issue resolved.** An earlier pass recorded this as an open hardware question: `src/utils/wavExport.ts` wrote both SMPL loop points one frame earlier than requested ("subtract 1 to match reference"), and `src/test/utils/smplChunk.test.ts` asserted 200 for the start and 799 for the end — mutually inconsistent — passing only because jsdom lacked `Blob.arrayBuffer`, so the assertion read a buffer that was not the emitted file.

It turned out not to need hardware, because the app was **contradicting itself in three places**:

- **The start subtraction was indefensible.** A loop start is a 0-based frame index, and two callers in `patchGeneration.ts` pass `loopStart: 0`. `0 - 1` written with `setUint32` wraps to **4294967295** — a loop beginning past the end of any file.
- **The two callers disagreed about the end.** The drum and ZIP paths passed `framecount - 1`, an inclusive last frame. The multisample path passed a value clamped to `framecount`, an exclusive end. One blanket `- 1` in the writer was right for at most one of them.
- **The two writers disagreed with each other.** `wavExport` subtracted 1 from both points; `aiffExport` subtracted 1 from the end only. So the same preset exported as WAV and as AIFF carried **different loop points**, and the OP-XY reads both containers.

Both writers now document their loop points as inclusive 0-based frame indices — which is what the RIFF `smpl` chunk and the AIFF `MARK` markers store — and write what they are given, clamped so a bad value cannot become an enormous unsigned one. The one caller whose value was exclusive converts it at source, so the emitted `dwEnd` for multisample presets is unchanged. What changed is that a loop start of 0 is now 0, the drum path's loop reaches the last frame instead of stopping two frames short, and the two formats agree frame for frame — asserted by a test that exports the same audio both ways and compares.

**What is left for hardware** is narrower than before: whether TE's firmware reads `dwEnd` as the last frame played, as the format specifies. That is now a single line in one place rather than three conventions disagreeing, so an answer from the instrument is a one-line change instead of an investigation.
