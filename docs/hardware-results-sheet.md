<!-- A form to fill in, not a document to read. The reasoning behind every check lives in
     docs/hardware-test-guide.md; the reasoning behind the six tasks lives in
     docs/companion-app-comparison.md. Copy this file, date it, and write in it. -->

# Fieldwork — hardware results sheet

**Build under test:** `Fieldwork_0.19.0_aarch64.dmg` · SHA-256 `9f24a2d0b3dc39be1f9d309189ec1c9abf4e1781ef1dfe67efcae73bddcf360d`
**Tested by:** ……… **Date:** ……… **macOS:** ……… **Instruments and firmware:** ………

Everything in this app is verified against the code and the browser it renders in. None of it is verified against an instrument. This sheet exists because the step that closes that gap had no form to fill in — the procedure said what to check and left you to invent a way to record it.

**Before starting:** make a backup and verify it, and use disposable, newly named content for anything that writes. The app never overwrites, renames or deletes device content, but that is a claim you are here to test rather than one to rely on.

---

## Part 1 — Does it work at all

One line each. `—` if not reached.

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 1 | DMG mounts; app opens; no Gatekeeper dead end (right-click → Open on first launch) | | |
| 2 | Each instrument reaches transfer mode using the hint the app shows beside it — OP-XY `com › m4`, OP-1 field `shift + com › t4` | | |
| 2b | **TP-7: use Prepare TP-7 in the app.** It needs exactly one TP-7 attached, in audio/MIDI mode, not recording — then wait for it to switch. Holding ■ while powering on is the manual route. This is the likeliest reason a TP-7 does not appear at all | | |
| 3 | **OP-XY's COM label is `m4` or `t4` on your firmware** — the app shows both because the sources disagree | | |
| 4 | Find devices lists the right instrument and serial; connecting shows the right model and free space | | |
| 5 | No missing-root notice (or, if there is one, it names a folder that is genuinely absent) | | |
| 6 | Create backup completes; Verify backup passes on it | | |
| 7 | Corrupt one byte of one backed-up file, then Verify backup — it must fail and name that file | | |

## Part 2 — Per instrument

| # | Instrument | Check | Result | Notes |
| --- | --- | --- | --- | --- |
| 8 | OP-XY | Presets list, search, preview, original-byte export | | |
| 9 | OP-XY | Projects inspector; **check all projects** names real sharers, reports unreadable ones as unknown, **Stop reading** abandons without publishing, and leaving the tab does not re-read | | |
| 10 | OP-XY | Send a small newly named kit; then try an existing name and confirm refusal | | |
| 11 | OP-XY | Install a sample into `samples/`; type a subfolder name and confirm the app stays responsive throughout | | |
| 12 | OP-1 field | Drum/synth patches; tapes and album sides; all four tracks preview together | | |
| 13 | OP-1 field | Install a `.aif` into `drum/`; **does the Field load a bare `.aif` from there at all?** (unverified) | | |
| 14 | OP-1 field | Nested pack folders — does the Field see them? (unverified) | | |
| 15 | TP-7 | Recordings by capture date; preview; original export | | |
| 16 | TP-7 | Per-track stems from a long multitrack take | | |
| 17 | TP-7 | Name a take in your library; confirm the recorder still lists the original filename | | |
| 18 | TP-7 | Write a wav into `recordings/`; **does this firmware accept arbitrary sample rates?** (unverified) | | |

## Part 3 — The capture loop

| # | Check | Result | Notes |
| --- | --- | --- | --- |
| 19 | Import takes; unplug; relaunch — takes still listed with device and capture time | | |
| 20 | Import the same takes again — reported as already in your library, count unchanged | | |
| 21 | Audition a long take: waveform appears without a wait; playing from a late position starts promptly | | |
| 22 | Do 21 with **both** a TP-7 WAV and an OP-1 field AIFF — a Field take that plays as noise is a real failure | | |
| 23 | Mark several hits in a row with `i`/`o` **without touching the frame fields** — waveform stays drawn, marks stay put | | |
| 24 | Send regions to the Drum lab, then **quit and reopen** — the kit must still be there | | |
| 25 | **Loop points: the one thing I could not settle by reading.** Send a looping sample and confirm the loop sounds where the editor put it | | |
| 26 | Interrupt a send by unplugging; then *check the device* and *add the missing files* — two presses, no renaming | | |
| 27 | Build a kit while a TP-7 is connected, then swap to the OP-XY — you stay in the Drum lab with the kit intact | | |

## Part 4 — The comparisons

This is the part that would substantiate "best". Fieldwork's half of each task is already measured and pre-filled below — what is missing is the clock, and the same task in whichever tool you already have.

Run each task on disposable content. Record **actions** (discrete presses, clicks and keystrokes) and **elapsed time**, and note anything you had to leave the app to do.

| # | Task | Fieldwork (measured, no clock) | Fieldwork actions/time | Other tool | Its actions/time |
| --- | --- | --- | --- | --- | --- |
| 1 | Back up a device, then detect a single corrupted byte | Verify names the file; success wording cannot appear on failure | | ……… | |
| 2 | Twelve mixed-format samples onto the OP-XY | "2 of 12 files will not be written", stated before anything is sent | | ……… | |
| 3 | Full-length TP-7 take → per-track stems | One press; 900 MB streamed, source depth kept exactly | | ……… | |
| 4 | Find every project referencing one sample | One press; names sharers; reports unknown rather than guessing | | ……… | |
| 5 | 24-pad kit from field recordings onto the instrument | 24 actions, no step that leaves the app | | ……… | |
| 6 | Unplug mid-send, then complete without renaming | **2 presses**; the widest expected margin | | ……… | |

**What counts as a fair comparison:** the same content, the same starting state, and the rival tool's own best path rather than its worst. If a tool cannot do a task at all, write that — it is a more useful result than a time.

---

## What you found

Anything that went wrong, in your words. A defect described loosely is worth more than one described precisely and never written down.

1. ………
2. ………
3. ………

**Verdict on the goal's wording.** The claim is that this is the best and slickest companion app available. Before these runs it is unproven, and the honest statement is the narrower one: most careful and most cross-device on paper, with its own half of all six tasks measured. Write what these runs actually support:

> ………

When this sheet is filled in, copy the findings into `docs/tp7-capture-validation.md` under a dated heading, and update the capability matrix in `docs/companion-app-comparison.md` where a `?` becomes a fact.
