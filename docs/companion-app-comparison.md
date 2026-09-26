---
type: research
title: "Fieldwork against the other field-system companions"
tags: [fieldwork, research, comparison, op-xy, op-1-field, tp-7]
created: 2026-09-25
---

# Fieldwork against the other field-system companions

Compiled 2026-09-25 to answer one question honestly: where does Fieldwork actually lead, where does it merely match, and where does it lose? Sources are each tool's own documentation, store listing or repository, plus the owner reports in [[te-companion-feature-research]].

**What this is not.** No side-by-side run happened. Competitor rows are *published claims*, not behavior I observed; Fieldwork rows marked "unverified on hardware" are code with automated tests and no device behind them. A "best app" claim needs a musician doing the same job in each tool on real hardware — that judgment is the owner's to make, and this document exists to make it checkable rather than to assert it.

## The field

| Tool | Platform | Scope |
| --- | --- | --- |
| **Field Kit** (teenage engineering) | macOS | Official MTP file access for OP-1 field, OP-XY, TP-7 |
| **Studio Field** (independent, App Store) | macOS, iPadOS, iOS | Library, backups, tape player, sound packs, iCloud, community; TP-7 support announced 2026-09-24 |
| **DigiChain** (brian3kb) | Web / desktop builds | Sample chains, slicing, OP-1/OP-Z/OP-XY kit export |
| **tp7 CLI** (totocaster) | macOS terminal | Direct TP-7 MTP: ls, pull, push, rm, rename |
| **op1.fun / Drum Utility / TEOperator** | Web | Patch building and sharing for the OP-1 family |
| **Fieldwork** (this app) | macOS (Tauri) | Device management + sample authoring for all three devices |

## Capability matrix

Legend: ● shipped · ◐ partial · ○ absent · ? undocumented. Fieldwork's column reflects code in this checkout with passing automated tests — 732 frontend and 90 native as of 0.19.0 — and nothing in it has been run against hardware.

| Capability | Fieldwork | Field Kit | Studio Field | DigiChain | tp7 CLI |
| --- | --- | --- | --- | --- | --- |
| Runs at all on Apple Silicon | ● | ○ reported not launching on M-series | ● | ● | ● |
| Works without Field Kit installed | ● own `mtp-rs` stack | n/a | ● | n/a | ● |
| All three devices in one app | ● OP-XY, OP-1 field, TP-7 | ● | ● since 2026-09-24 | ○ file tools only | ○ TP-7 only |
| Explicit device choice when several are attached | ● serial-level selection | ? | ? | n/a | ● `--device` |
| Puts a TP-7 into MTP mode from the app | ● SysEx switch | ● | ? | n/a | ● |
| Checksummed backup with independent verification | ● SHA-256 manifest, re-read and verified | ◐ copy only | ● backup/restore claimed | ○ | ○ |
| Restore preview before writing | ● conflicts, space, serial binding, cancellable | ○ | ? | ○ | ○ |
| Refuses to overwrite or delete device content | ● by design, delete disabled pending dependency coverage | ○ Finder semantics | ? confirmation claimed | n/a | ◐ staged overwrite |
| Project → sample dependency inspection (OP-XY `.xy`) | ● nested paths, unresolved report, JSON export | ○ | ○ | ○ | ○ |
| Storage breakdown, and listing samples outside any preset | ● | ○ | ? | ○ | ○ |
| Name a take in your own library without renaming the file | ● label, provenance and deduplication all preserved | ○ | ● its own library | ○ | ◐ `rename` renames on the device |
| Which projects reference a given sample (reverse lookup) | ● every project read in one action; refuses to call anything unused while one is unreadable | ○ | ○ | ○ | ○ |
| Sample install with per-file format preflight | ● documented caps, renames, refusals, conversion stated up front | ○ drag and drop, failures discovered on device | ◐ sound-pack install | ◐ export to disk, then drag | ◐ `push` |
| Drum kit / multisample authoring with waveform editing | ● 24 slots / 24 zones, zero-crossing, ADSR | ○ | ◐ trim and fade | ● chains and slices | ○ |
| Send a built preset straight to the device | ● verified, byte-compared | ○ | ? | ○ | ○ |
| Multitrack take → per-track stems | ● native streaming, disk-bound, verbatim samples | ○ | ? | ◐ manual slicing | ○ |
| Local take library that outlives the cable | ● content-addressed by SHA-256, records which device and path each take came from, WAV and AIFF, and fills from a device **or** from files already on the Mac | ○ | ● its own library | ○ | ○ |
| Long take → named regions → straight into a kit | ● bounded audition, `i`/`o` marking, zero-crossing snap, batch hand-off to pads or zones | ○ | ? | ◐ chains and slices | ○ |
| Recover an interrupted transfer without renaming | ● reads the folder back, byte-compares each file, writes only what is missing under a single-use approval | ? | ? | n/a | ◐ `push` again |
| Keyboard-driven operation | ● ⌘1–⌘9 tabs, `?` lists every shortcut, list and audition keys | ? | ? | ? | ● it is a CLI |
| Tape browsing with all four tracks auditioned together | ● bounded synchronized preview, per-track levels | ○ | ● tape player with mute/solo/bounce | ◐ tape.json slicing | ○ |
| Original-byte export (no re-encode) | ● streamed to disk | ● | ? | ○ re-encodes | ● |
| OP-1 field tape assembly from audio files | ◐ four tracks exported to a folder, no device write | ○ | ● Stem Maker, into its own library | ◐ | ○ |
| Sound-pack store / community sharing | ○ | ○ | ● Tape Club, packs, forum | ○ | ○ |
| iCloud sync and mobile apps | ○ | ○ | ● | ○ | ○ |
| Scriptable / automatable | ◐ nothing exposed yet | ○ | ○ | ○ | ● JSON output |
| Signed, notarised, installable build | ○ unsigned local DMG | ● | ● | ● | ● Homebrew |

## Reading the matrix

**Where Fieldwork genuinely leads.** Safety and inspection: a verified checksummed backup with a restore preview that names conflicts and binds to the device serial; project dependency inspection for `.xy`; a sample install that states every conversion, rename and refusal *before* writing; and stem splitting that streams instead of buffering. No other tool in this list claims the combination, and the owner reports in [[te-companion-feature-research]] say this is exactly the part people do not trust today.

**The `?` marks in the four newest rows mean *unresearched*, not absent.** The take library, region marking, interrupted-transfer recovery and keyboard coverage were added after the research pass that produced this matrix, so where I have no evidence about an alternative I have left `?` rather than `○`. Where a mark *is* given — Studio Field's own library, DigiChain's chains and slices, the tp7 CLI being a CLI — it follows from the scope already documented in the table above. Converting my own newer features into other tools' gaps by default would flatter this column for free.

**Where it merely matches.** Basic browse, preview and original-byte export. Field Kit and the tp7 CLI do these; Fieldwork's advantage there is only that it works on Apple Silicon and covers all three devices.

**Where it loses today.** Studio Field ships things Fieldwork does not have and mostly should not chase: a sound-pack store, community sharing, iCloud, and mobile apps. Tape assembly is now partly closed — Fieldwork builds the four tracks and writes them to a folder, but deliberately will not write them onto the device, because replacing a tape is destructive and the format is not vendor-documented. Studio Field is also *signed and installable*; Fieldwork is an unsigned local build whose DMG is verified but needs right-click → Open. For a personal tool those are acceptable losses — see [[fieldwork-personal-tool-scope]] — but they are real, and "best available" would not survive a comparison that weighted them.

**The honest verdict.** On trust, verification and format preflight across three devices, Fieldwork is ahead of what the alternatives document, and the newest rows extend that in the same direction rather than a new one: a take library that records where each recording came from, and recovery from an interrupted write. On polish, distribution and breadth of creative features, Studio Field is ahead. Neither statement is settled until the hardware checks in `docs/hardware-test-guide.md` run against a real OP-XY, OP-1 field and TP-7.

**What this pass did not change.** The two losses that would decide a fair comparison are untouched: Fieldwork is still unsigned, so installing it means right-click → Open, and it still has no sound-pack store, no sharing and no mobile app. Signing needs Apple Developer credentials that are not mine to use; the rest is deliberately out of scope for a personal tool. A comparison that weighted distribution and breadth would still go the other way, and no amount of internal correctness changes that.

## What would substantiate "best" for your studio

Timed, same-task comparisons are the only evidence that counts. Run each of these in Fieldwork and in whichever alternative you already have, on disposable content, and note actions and elapsed time:

1. Back up a device, then verify the backup detects a single corrupted byte.
   *Fieldwork's half has been rendered end to end* — the native check now flips **exactly one bit** of one byte and leaves the length identical (`rejects_corruption_even_when_length_matches`), so a verifier that compared sizes, or hashed only when the size changed, would fail it; the failure names the offending file. `src/test/e2e/backup-verify.e2e.ts` then drives the panel for both outcomes, and its load-bearing assertion is that success wording **cannot** appear when verification failed — a checksum mismatch shown quietly, or next to the words "Backup verified", is a corrupted backup the user will trust. Verification runs with nothing plugged in, which is what the panel promises.
2. Put twelve mixed-format samples (one 25 s, one named `c0`, one duplicate name) onto the OP-XY and see which tool tells you what will happen before it happens.
   *Fieldwork's half of this has been rendered and checked* — with those exact twelve files it reports **"2 of 12 files will not be written"**, renames the duplicate to `kick 2.wav` and says why, skips the 25 s file with *"25 s is longer than the 20 second limit. trim it first."*, warns that `c0.wav` will be read as a pitch, strips characters the device refuses, and refuses a `.txt` by name — all before anything is sent. That establishes what this column claims, and nothing about the other tools or about elapsed time; the comparison still needs the alternative run beside it.
3. Split a full-length TP-7 multitrack take into per-track stems.
   *Fieldwork's half has been rendered end to end* — `src/test/e2e/stems.e2e.ts` connects a TP-7 from cold, finds a 900 MB five-channel take and exports it in **one press**, reporting *"3 stems written to … track-1, track-2, track-3 (mono) · 5 source channels at 96.0 khz / 24-bit kept exactly"*. The existing component test covered the three outcomes but rendered the page directly with a mocked context, so it began one step after the interesting part: nothing had checked the control was *reachable*. The test also asserts the whole 900 MB is handed to the native streamer with no cap applied in the UI, and that splitting called neither an upload nor a preset scan.
4. Find every project that references one sample, then decide whether it is safe to delete.
   *Fieldwork's half has been rendered end to end* — `src/test/e2e/sample-usage.e2e.ts` answers it in **one press**: *check all N projects* reads every `.xy`, inverts the references, and labels each row in the inspector with the other projects that use it, by name. Building this is what exposed the overstated matrix row above. The half that matters more is the refusal: with one project unreadable, the app reports *"sharing unknown — 1 project could not be read"* rather than "used by this project only", because the unread project is as likely as any other to be the second user. It never says "safe to delete" in any state, and the exported JSON report carries either the sweep or the words `not checked`. Seventeen unit tests and the rendered flow cover it.
5. Build a 24-pad kit from field recordings and load it on the instrument.
   *Fieldwork's half has been rendered end to end* — `src/test/e2e/kit-from-take.e2e.ts` drives one four-second take to three marked regions, three loaded pads and a verified send, in **24 discrete actions** from the takes tab to the confirmation, with no step that leaves the app. Nine of those 24 are typing frame numbers, which is what a test can drive deterministically; in use the `i` and `o` keys replace them while the take plays. The comparison-relevant property is the absence of detours: no export to disk and re-import, no renaming, no second tool. That is what to time the alternative against — DigiChain reaches a kit but by way of exporting and dragging, and Field Kit has no authoring step at all.
6. Unplug the cable in the middle of sending a preset, then get that preset complete on the device **without renaming it**. This is the task I expect the widest margin on, and therefore the one most worth timing honestly.
   *Fieldwork's half has been rendered end to end* — `src/test/e2e/send-review.e2e.ts` pulls the cable mid-write and recovers in **two presses**: *check the device*, then *add the 1 missing file*. The review never closes, nothing is re-selected, nothing is renamed, and the test asserts exactly one upload attempt, one reconcile and one completion, so checking provably writes nothing. A plain resend is not merely discouraged but disabled, with the reason on screen. Only the elapsed time and the rival's action count need the instruments.

Record the results in [`docs/hardware-results-sheet.md`](hardware-results-sheet.md), which carries all six tasks with Fieldwork's half already filled in and blanks for the clock and the other tool. It also holds the hardware checks, so one form covers the whole session; the findings then go into `docs/tp7-capture-validation.md` under a dated heading.

**All six** now have Fieldwork's half established in the rendered app — each by a test that fails when the behaviour it describes is removed. That is worth stating precisely, because it is easy to overread: it fixes what *this* column costs in actions and proves the path runs without detours, and it says nothing whatever about elapsed time, about the other tools, or about how any of it behaves against a real instrument over a real cable. Rendering them produced a defect every single time: five across tasks 1, 3, 4 and 5. None was visible to the unit and native suites, because in each case the surface under test was reached through a stub of the thing that was broken.

Until the comparisons are run, the defensible claim is narrower than the goal's wording: **Fieldwork is the most careful and the most cross-device of these tools on paper, its own half of all six tasks is measured, and all of it is unproven on hardware.**
