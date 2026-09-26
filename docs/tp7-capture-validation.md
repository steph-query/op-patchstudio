---
type: validation
title: "Fieldwork capture workflow — validation and experience audit"
tags: [fieldwork, validation, qa, macos]
created: 2026-09-25
---

# Fieldwork capture workflow — validation and experience audit

Evidence for the work recorded in [[te-companion-feature-research]], against the experience contract in `.maestro/playbooks/2026-09-25-TP7-Capture-Workflow/TP7-CAPTURE-01.md`. Software behavior only: no OP-XY, OP-1 field or TP-7 was connected, so nothing here establishes firmware compatibility.

## Automated checks — 2026-09-25

| Check | Result |
| --- | --- |
| `npm test` | **791 passed** (74 files) |
| `cargo test --offline` | **95 passed** |
| `npm run build`, `npx tsc -b` | clean |
| `npm run test:e2e` (webkit + chromium) | **36 passed** — WebKit first, the engine Tauri uses on macOS |
| `cargo clippy` | clean for modules added here; two pre-existing warnings remain in `backup.rs` |
| `npx eslint` over files added or changed here | zero problems |
| Full-repo eslint | pre-existing debt unchanged (`LibraryPage.tsx`, `setup.ts`, `smplChunk.test.ts`, the builders' `(window as any)` lines) |
| DMG | `Fieldwork_0.19.0_aarch64.dmg`, `hdiutil verify` VALID, rebuilt after the visual pass; SHA-256 in `docs/hardware-test-guide.md` |
| Packaged app diagnostic | `DOXY_NATIVE_SMOKE PASS` — run on the app extracted from the 0.19.0 DMG |

## Step counts against the budget

Measured by walking the shipped code paths, counting user actions (not keystrokes within a field).

| Segment | Budget | Actual | Note |
| --- | --- | --- | --- |
| Connected device → takes imported | connect, then one action | **1** action once on the Takes tab (`import N new`); 2 including the tab switch | Connecting itself is three deliberate actions — Find devices, choose the serial, Connect — because an earlier review required explicit device selection rather than auto-connecting the first device found. That cost is accepted for safety. |
| Imported take → saved named region | select, audition, mark, name | **5**: audition, place playhead, `i`, `o`, save | Name is suggested, so typing is optional. Keyboard-only is the same count (space instead of the playhead click). One over budget; the extra is placing the playhead, which is the audition step in practice. |
| Eight marked regions → kit | not budgeted | **2**: select them, send to drum lab | Was 16 (eight regions × two actions) before batch sending. |
| Browse takes and open one | keyboard-reachable without leaving the list | **0 mouse actions** — `↑`/`↓` then space | The list is a single tab stop, so reaching it from the search field is one Tab. |
| Region → kit on the instrument | choose target, review once, send | **3**: to drum lab, send to device, confirm | Meets the budget. The tab switch is automatic, and there is exactly one confirmation. |

## Contract sweep — what was found and fixed

- **Raw error stringification at 34 sites.** `String(error)` renders an `Error` as `Error: message`, and `String(undefined)` as the literal text `undefined`. Added `src/utils/describeError.ts`: it strips stacked `Error:` / `TypeError:` prefixes, reads a message off a plain rejection object, replaces an empty or meaningless value with "Something went wrong, and no reason was reported.", and closes the sentence. Applied across all eleven surfaces that showed errors. Nine tests cover it, including the `undefined` case that the first version got wrong.
- **Absolute home paths in UI text.** The library location, tape export result and stem export result showed `/Users/<name>/…`. They now read `~/Music/…` via `shortenHomePath`, which leaves non-home paths such as `/Volumes/Field/…` untouched.
- **The takes list was mouse-only.** It is now a listbox with one tab stop: `↑`/`↓` walk it, `Home`/`End` jump, space or enter opens a take for audition and closes it again, `aria-activedescendant` follows the focused row, and the focused index is clamped when a search filters the list. The shortcut hint sits in the toolbar where it applies, per the contract's "discoverable in the UI where they apply".
- **Device free space read as "3814.7 mb".** `formatFileSize` in `audio.ts` deliberately stops at megabytes — an existing test documents that, and the sample builders want it — so rather than change a shared helper or add a fourth copy, the two gigabyte-aware formatters the Storage view already had moved into `src/utils/formatBytes.ts` and are now used by both it and the send review. Storage lost two local copies in the process.
- **Checked and found clean** (one claim here was later found false — see the local import section above; the takes library's empty state offered only the device route until this pass): no internal state identifier reaches the interface (the queue's ten states map to five user-facing words, asserted in tests); no MTP or PTP code is surfaced as primary text; every empty state offers both device and local import; disabled controls carry a reason (`nothing new to import`, `all four tracks filled`, `no free pad`); every device error repeats the transfer-mode hint from the device profiles.

## Accepted as-is

- Device-relative paths (`presets/drum`, `originals/take.wav`, `recordings/…`) are shown as secondary text. They are the user's own vocabulary for where a file lives and are not absolute.
- The three-action connect flow, per the safety reasoning above.
- The region loop is one action over budget. Removing the playhead placement would mean marking from a default position, which is worse.
- Pre-existing `no-explicit-any` debt in files not touched here.

## Reviewed sends are bound to the device reviewed

Playbook 06.2–06.3. `preflight_preset_send` checks a send against the connected device without writing anything — name collision, free space, missing `presets` folder, wrong device kind, duplicate or missing `patch.json` — and returns a single-use token bound to the device serial, the session generation and a digest of the file names and sizes. `mtp_upload_preset` now requires that token and takes it, so:

- Swapping instruments between review and confirm is refused: *"A different device is connected than the one reviewed. Nothing was written."*
- Reconnecting between review and confirm is refused, because the session generation moved.
- Changing the preset after reviewing it is refused, because the manifest digest no longer matches.
- One approval authorises exactly one write; the plan is consumed when it is used.
- The review now shows device-checked facts rather than guesses: real free space, and whether the category folder will be created.

Six native tests cover the rules as a pure function: matching plan accepted, different serial, moved generation, changed payload, changed destination, wrong token, and digest sensitivity to names, sizes and order.

## After a failed send, the device is readable — playbook 06.4

An interrupted send leaves a partly written `.preset` folder, and until now the hardware guide's only advice was to inspect it with another transfer tool. **Check the device** in the send review now answers it in the app, read-only:

- Each file in the preset is reported **identical**, **different** or **absent**. Identical means the bytes were compared, not that the sizes matched — a same-size file is downloaded and compared before it earns that word.
- Files in that folder which the preset does not describe are listed as "not part of this preset".
- The verdict is one of four plain phrases with its reasoning: *nothing on the device* (a fresh write), *already complete* (every file matches byte for byte — nothing to send), *can complete* (some match, some missing; only the missing ones would be written), or *blocked* (something differs or something unexpected is there — nothing will be changed).
- Checking writes nothing. Its tests assert no second upload and no extra history entry.

**And when it can be completed, it can be completed from the app.** A *can complete* verdict returns a single-use token, and **add the N missing files** spends it on exactly those files:

- Only files the device does not have are written, into the folder that is already there. Nothing present is rewritten, replaced or deleted, and each new file is read back and compared before the send is called whole.
- The token is bound to the device serial, the session generation, the destination and a digest of the missing set — so the write is refused if the instrument changed, the cable was replugged, or that folder changed between the check and the press. The message for the last case says the folder changed, not that the preset did, because that is what happened.
- A stale or already-spent check cannot authorise anything: the report is cleared whether the completion succeeded or failed, so finishing a second time means checking again.
- Sending the same name as a *fresh* preset is still refused outright — completing is only safe for files the device lacks. The review therefore disables **send to device** once a check has found the folder, and states why rather than letting the press fail. This was the one remaining dead end in the send flow.
- History records a completion as a verified transfer listing the files it added, not the whole preset, so the record matches what was written.
- A completion that would not fit is reported rather than raised: the check keeps returning its report, with the verdict turned to *blocked* and the reason given as space, instead of failing a read-only question with an error toast.

Five native tests cover the verdict rules and the completion guard as pure functions, including the case where content differs *and* unexpected files are present. Three hook tests and one component test cover the completion: what it sends, that a blocked verdict offers nothing, and that a failed attempt cannot be retried on the same check. A bridge test pins the command name, the raw body and all four headers, because the hook tests mock the bridge — a mistyped header would otherwise have waited for hardware to show itself.

With this, every phase of the TP-7 capture playbook that does not require hardware is implemented: 02 catalog, 03 library, 04 audition and regions, 05.2 builder handoff, 06.1–06.6 reviewed sends, history, plan binding and reconciliation.

## A take's identity is where it came from, not what it is called

Two bugs in the same filter, both invisible on a TP-7 and both serious on an OP-1 field. TP-7 filenames are unique timestamps (`2026-02-23_112713_000.wav`), which is exactly why neither showed up while the feature was built against one.

**Every field tape track is called `track_1.aif`.** The import filter matched candidates by *basename* against names already in the library. So after importing one tape side, every other side — and the album, and the other three tracks of each side — was filtered out as "already known", **silently**, with the button reporting *nothing new to import*. There was no way to get the rest of a tape into the library at all.

Matching is now on **where a file came from**: its path on the device, with the serial as a discriminator. `src/utils/takeOrigins.ts` holds it as pure logic:

- `knownOrigins` maps each device path the library has seen to the serials it saw it on. `alreadyImported` answers the question for one candidate.
- The serial discriminates **only when both sides have one**. If the library recorded no serial, or the connected device reports none, the same path counts as the same take. Offering a duplicate is a smaller error than hiding a recording — but a missing serial must not turn every take into a new one on every scan either, and that asymmetry is deliberate and tested.
- Two different TP-7s with recordings at the same path are correctly two takes.
- Content hashing during the import still decides what is actually copied; this only decides what is worth offering. An identical file already present is recorded as another source rather than copied twice — which is now *more* useful, because a take found at a second path gains that provenance instead of being hidden.

**The second bug was recorded provenance that was simply false, and it had a twin.** The OP-XY branch fabricated `samples/user/${name}` while the scan had already reported each sample's real path. Since `name` is itself a relative path, a nested sample was recorded as `samples/user/user/kick.wav`, and a sample sitting directly in `samples/` gained a `user/` folder it was never in.

The same fabrication appeared twice more in `deviceRedundancy.ts`, where the consequence is worse: those paths are what the **space review** shows, and what goes into the exported `device-space-report.json`. That report exists so someone can decide what to remove — with another transfer tool, since this app never deletes device content. A path that does not exist sends them looking in the wrong folder for a file they were told is duplicated.

All three sites now share one rule, `deviceSamplePath`: use the path the scan reported, and otherwise add only the `samples/` root — never a subfolder that was not there. It lives in `teDevices.ts` rather than in `tauriBridge.ts`, which a failing test argued for convincingly: pure logic in the IPC module means every test that mocks the bridge has to re-provide it.

While moving this out of the component (pure logic in a component file breaks fast refresh, and the linter was right to say so) `importCandidates` was narrowed from the whole app state to the four fields it actually reads — which is why it is now testable without rendering anything. Seventeen tests cover the module.

## The end-to-end suite had not been run, and could not be

`npm run test:e2e` is in `package.json`, and the browser binaries for the installed Playwright version were **not present** — so the suite failed to launch rather than failing an assertion. Whatever it was meant to protect, it had not protected anything for some time. Chromium and WebKit are installed now and all five existing specs pass in both.

**The documented command now works.** `playwright.config.ts` declared five projects — firefox and two mobile viewports among them — left over from this project's PWA days. Nothing ships to Gecko or to a phone, so those runs could only produce false alarms, and firefox's binary is absent, which is why `npm run test:e2e` failed before asserting anything. It now runs webkit first and chromium second: 18 tests, all passing. The responsive widths that do matter are covered explicitly at 1440 and 800 in `branding.e2e.ts`.

**WebKit is the one that matters here.** Tauri renders in WKWebView on macOS, so the WebKit run is the closest thing to the shipped environment short of the packaged app — much closer than Chromium, which is what a default Playwright setup would have exercised.

## The disabled operations are genuinely disabled, and now stay that way

A sweep for exported helpers with no caller in the app turned up 53, most of them harmless — helpers a test uses and nothing else. Two were worth chasing: `mtpDelete` and `mtpRename` in the bridge, untested and uncalled, against a guide that says deletion and in-place rename are disabled. A registered Tauri command that deletes a device object by handle, with none of the token machinery every other write goes through, would have been the worst kind of gap.

It is not one. Both native commands are deliberate stubs that always refuse, with the reason and the alternative: *"Deletion is disabled: project dependency coverage is incomplete…"* and *"In-place rename is disabled because it may break project links. Use Make a copy instead."* Registering them is the right call — the interface gets a clear answer instead of an unknown-command error.

What was missing is anything holding them that way. There is no UI path and no test, so implementing either for real would have silently contradicted the documented policy. A native test now reads both command bodies and asserts each still returns an `Err`, still explains why, and calls none of the APIs a real implementation would need. Verified by implementing deletion properly and watching it fail.

## A validator that contradicted the loader, and had no caller

`isValidAudioFile` in `audioFormats.ts` said mp3, m4a, ogg and flac were valid. `readAudioMetadata` — the only function in the app that actually loads audio — handles `wav`, `aif` and `aiff` and **throws "Unsupported audio format"** for everything else. So the validator's answer was wrong wherever it disagreed, and saying yes to an mp3 only moved the failure further along.

It had **no caller in the app**: the only thing importing it was its own test, which asserted the wrong answers with conviction. That combination is the trap — dead code that looks authoritative, tested, and ready for whoever reaches for it first.

It now agrees with the loader, and its tests assert the refusals with the reason attached. This also confirmed the accept-list change above was right rather than a lost capability: the builders genuinely cannot open an mp3, so a dialog offering one was offering a dead end.

## Dragging a field sample onto a pad did nothing, and said nothing

Dragging a file onto a pad is how most people load one, and it had never been exercised. A `.wav` drops fine. A **`.aif` does not**, and nothing appears to explain it.

All four drop targets in the drum builder — the pad rows, the two halves of the keyboard, and the sample table — tested the same expression: `file.type.startsWith('audio/') || name.endsWith('.wav')`. A `.aif` dragged from the desktop usually arrives with an **empty** MIME type, so every one of them rejected it. The rest of the app reads AIFF without complaint, the install panel accepts it, and an OP-1 field's entire library is `.aif`.

They share one predicate now — `isReadableAudio`, the same definition that settled the five competing ideas of "audio" earlier in this pass — with the MIME check kept as a fallback for files whose name says nothing. Four tests cover it, including the old rule shown alongside the new one so the difference is on the record rather than in a commit message.

**The open question was then settled.** A genuine AIFF — FORM/AIFF with a real COMM and SSND, big-endian samples, no MIME type — was loaded through the file chooser instead, which the harness does drive reliably: **1 / 24 loaded**, the name shown, no error. So AIFF decoding in the builder is fine, and the earlier zero was the synthetic drop harness rather than the app. The filter gap was real and is fixed; the thing it appeared to break was not.

**And the dialog itself was hiding them.** Five file inputs offered `audio/*,.wav` and never named AIFF, leaving it to a wildcard to cover a format the app reads everywhere. Two others offered `.mp3`, `.m4a`, `.ogg` and `.flac` — containers this app cannot open, so choosing one leads straight to a failure, which is the dead end the takes import used to have. Every input now offers `.wav,.aif,.aiff,audio/*`, with one deliberate exception: the OP-1 preset importer keeps `.aif,.aiff`, because a preset is always AIFF. A test sweeps the component tree and fails on any input that drifts from those two lists.

## The native tests were swept too, and are clean

The same three questions were put to the 94 Rust tests: is there a test with no assertion, an assertion that can be skipped by a condition, or a test asserting against a copy of what it claims to check. None of the three appears. Every test asserts; there are no conditional skips; the handful of `assert!(…is_ok())` calls are each paired with a test of the rejecting case, so they check the thing they mean to rather than merely that a function returned.

That is worth recording as a result rather than passing over in silence: the class that produced four hollow tests in the frontend suite does not exist on the native side.

## Twelve tests that asserted a copy of the thing they tested

The sweep continued into the unit suite, and `DrumKeyboard.test.tsx` was the largest find of the session in this class. It declared **its own literal copy** of the drum key map at the top of the file and then asserted facts about that literal: that `G` in the upper bank is `LT2` at index 19, that no label repeats, that every index is unique. Twelve assertions, none of which could fail however the component's real mapping changed.

They read the real mapping now, and it is verified: renaming `LT2` to `LT9` in the component makes two of them fail, and restoring it makes them pass.

The map moved to `src/utils/drumKeyMap.ts` on the way. Exporting it from the component file to reach it from a test is what the fast-refresh lint rule objects to, and rightly — it is data, not a component, and the same argument moved `takeOrigins` out of the capture panel earlier in this pass. `DrumKeyboard.tsx` lost one lint problem in the process.

The same file also held the suite's only test with no assertion at all: *"should render without crashing"*. A render that throws does fail it, so it was not hollow, but it said nothing about what arrived. It now asserts the pads are there.

A sweep for the same pattern elsewhere — a constant defined in a test that shadows one the app exports — found nothing further.

## Sweeping for tests that cannot fail

One test that could never fail is a reason to look for others, so the suite was swept for the patterns that allow it: assertions swallowed by a `catch`, assertions inside a condition that can silently be false, assertions inside a loop over a possibly empty list. Two turned up, both written in this pass, both guarded by `if (await …count())`.

One of them was checking that `?` does not open the shortcut list while a person is typing — by looking for a searchbox **that does not exist on the tab it runs on**. There are zero searchboxes there, so the condition was never true and the test had asserted nothing since it was written. It now types into the preset name field, which is the field someone is most often in when they reach for a punctuation key, and asserts unconditionally.

Making it honest immediately taught something. Typing `kick?snare` leaves `kicksnare`: the `?` is stripped, because a preset name becomes a folder name on the device and that character is not one those accept. The app was right and the expectation was wrong. The test now asserts the claim it is actually about — the sheet does not open — with the surrounding letters as proof the keystrokes reached the field, and says why the `?` is absent.

Both rewritten tests were then verified by breaking the code: removing the typing guard from the shortcut layer makes the first fail, and removing one label makes the accessible-name sweep fail. The other conditional skip, over the tab list, now asserts each tab exists rather than quietly covering less.

## Six controls that did not say what they were

The modal sweep suggested a second one: ask the browser which controls have no accessible name at all. Six did.

Five were Carbon toggles — normalize, cut at loop end, loop enabled, loop on release — whose `labelA`/`labelB` gave them the accessible name **"off"**. A person using a screen reader heard "off", with no indication of what was off; the visible label sits in a separate element above each switch. The sixth was the library's select-all checkbox, and the per-row checkboxes with it, which the sweep had only half caught because the fixture library was empty.

All six now carry names, and the sweep itself is a test that walks every tab and asserts nothing on screen is unnamed.

**The test was wrong the first time, in the way that matters most.** It passed — and it passed just as happily with a label deliberately removed. The `page.evaluate` call had been given a function as its argument, which cannot be serialised, and a `.catch(() => [])` turned that failure into an empty list of problems. A test that could never fail, asserting a property I had just fixed. It was only caught by breaking the code on purpose to watch it fail. It does now: removing one label reports `<input class="">` on the library tab.

## The modal conventions, swept rather than sampled

Finding one panel that was not a dialog raised the obvious question, so every modal in the app was checked at once instead of one at a time. Three more predated the convention: **ConfirmationModal**, **RecordingModal** and **DrumBulkEditModal** had no `role="dialog"`, no accessible name and no escape handling.

The confirmation is the one that matters. It is what asks *"loading a preset will overwrite your current session"* — the guard on a destructive action — and escape is the answer a person reaches for without thinking. It cancels now, and a test asserts it cancels rather than confirming.

Then the sweep found one the manual pass had missed. The audit that started this searched files whose names look like modals, which excluded `SendReview.tsx` — **the send confirmation, the most safety-critical dialog in the app, had no escape either**. It does now, with the rule the Cancel button already followed: not while the write is running, because by then the bytes are already going. Two tests hold both halves of that.

The rule is asserted across all eight modals as a file sweep. Each one individually is easy to fix and easy to forget; asserting the rule is what stops the next modal being added without it.

**On flakiness:** two intermittent failures were seen across this session's full runs — one unit test, one browser test — each of which passed alone and on re-run. Both look like contention under parallel workers rather than defects. Recorded rather than chased, since neither reproduced.

## The panel a person spends the most time in was not a dialog

Per-pad **sample options** — playmode, direction, trim markers, transpose, gain, pan — is the panel most used in the drum builder, and it is well made. Three things were missing, all of them conventions this app already follows elsewhere.

It carried **no `role="dialog"`**, no `aria-modal` and no accessible name, where the send review and the shortcut sheet all do. Assistive technology met an unlabelled box of sliders. Its three sliders had **no accessible names** either — "slider" and nothing else — while the app labels sliders in the media view and the auditioner. And **Escape did not close it**, though the shortcut sheet promises that escape closes what is open, and both the zoomed waveform and the sheet itself honour that.

All three are conventions the app had already chosen; this panel predated them. Four tests cover the role and name, the three labelled sliders, escape, and that nothing is listened for while it is closed.

**Auto-saving was measured rather than assumed** while looking at this. Now that session saving works at all, a twelve-sample kit of 6.4 MB takes **20 ms** to write, behind a deliberate one-second debounce — so the cost that was previously hidden behind an immediate failure turns out not to be a cost.

## Closing the class rather than waiting for a third instance

Having found the same storage failure twice, the remaining question was whether anything else writes to that database. Every store was checked: sessions hold only a `sampleId` pointing into the samples store, which was the first fix; samples and presets were the two instances; metadata holds plain values. The class is closed.

What is left is the next one. If a record ever regains a Blob, the engine reports *"Error preparing Blob/File data to be stored in object store"* — accurate, and useless to whoever reads it, which is how this took two separate discoveries to notice. Failed writes are now described in terms of the cause and the fix, naming the store and keeping the original text: *"Could not save to presets: this browser will not store a Blob or File in its database. Store the bytes instead (see audioBytesToFile in libraryUtils). Original error: …"*. Everything else passes through unchanged, named by store.

## The same failure was in the preset library, and there it was visible

Finding that WebKit refuses Blobs in IndexedDB raised an obvious question: what else goes through that store? **Save to library** does, and it failed in exactly the same way — *"Failed to save preset: UnknownError: Error preparing Blob/File data to be stored in object store"*. Unlike the session save, this one at least told the user: the interface said **save failed** and the preset was simply absent from the library afterwards.

Two things were being stored that could not be: the rendered audio as a Blob, and the sample's original `File` object carried along by a `{ audioBuffer, ...rest }` destructure. Neither is needed. The bytes *are* the audio, the name is kept beside them, and the reader already rebuilds a `File` when a preset is opened.

The round trip was then run rather than assumed: save, see it listed, press **load preset**, confirm the *"loading a preset will overwrite your current session"* prompt — which is the right question to ask — and the pad comes back as **1 / 24 loaded**.

Removing those two fields also let a pre-existing lint complaint go with them: destructuring to discard now happens through a small `omit` helper, so nothing is bound to a name it never uses, and that file went from seven problems to three.

## Two chains run and found sound

**Download a preset**, the app's oldest offline path and never exercised this session: a sample in, a name typed, `download preset` pressed. The archive is `studio kit.preset.zip` holding `kick.wav` and a `patch.json` with the OP-XY schema — `platform: OP-XY`, `version: 4`, the region on pad key 53 with `sample.start` 0 and `sample.end` 22050, which is the whole half-second sample. Nothing to fix.

**Escape closes the zoomed waveform** in WebKit. That was added earlier in this pass and tested only in jsdom, which has no real key handling or focus; confirming it in the engine the app ships on closes that gap.

A residual hazard from the bug below was also closed. `editingNotes` is keyed by row index, and dragging to reorder changes what each index means. Blur normally commits before a drag can begin — the input stops mousedown propagation, so the drag has to start elsewhere on the row — but relying on that ordering is exactly how one zone's key reached another. Uncommitted edits are now dropped when a reorder happens.

## Pressing Enter gave a different zone the same key

The multisample chain was the last one never run: files in, zones mapped, keys set. Loading `pad c2.wav` and `pad c3.wav` mapped them correctly to C2 and C3 from their own names, which is the behaviour demand gap #6 is about. Then one zone's key was changed to G5 — and **both** zones became G5.

The mechanism is worth stating exactly, because nothing about it is visible in the code at a glance. Changing a root note re-sorts the list, in the reducer. The key field committed on Enter *and* then blurred, and the blur committed a second time from a closure React had not yet re-rendered — so the stale typed value dispatched again, against an index that now pointed at whichever sample had just moved into that row.

For a person that is: set one zone's key, press Enter, and a different zone silently takes the same key. A multisample set that plays wrong and looks right, from the single most ordinary action in the builder. Enter now only blurs, and the blur commits once.

The end-to-end test was verified by putting the old handler back: it fails with *"2 files have a note… pad c2.wav says C2, mapped to G5; pad c3.wav says C3, mapped to G5"* — the second zone being dragged along, in the assertion's own words — and passes again once restored.

The warning itself read **"2 files have a note in the filename that differs from its root note"**. Both the verb and the possessive now follow the count.

## Every session save was failing in WebKit

Comparison task 5 — *build a 24-pad kit from field recordings* — has a first half that needs no instrument now that files can be added from the Mac. Running that chain end to end in WebKit for the first time worked: three saved regions, selected together, arrived as **3 / 24 loaded** in the drum lab. The console said something else:

> Failed to save session: UnknownError: Error preparing Blob/File data to be stored in object store

A direct probe settled what it meant. In this WebKit build, IndexedDB **refuses a Blob or a File outright** and accepts an ArrayBuffer without complaint. Session saving stores each sample's audio, and stored it as a Blob — so under that engine every save failed, the error was swallowed into a console line, and a kit built from an afternoon of regions would not have survived a restart. Nothing in the interface said so.

**The fix was then proved rather than assumed.** A sample was loaded into the drum lab, the page reloaded as quitting and reopening would, and the session offered itself back: *"a previous session was found … with 1 drum sample and 0 multisample files"*. Pressing restore returned **1 / 24 loaded**. Under the previous storage the save had failed outright, so nothing would have been offered at all. That is the round trip, in the engine where it was broken.

That modal also said **"1 drum samples"**. It is the first sentence someone reads when they reopen the app with work saved, and a count that disagrees with its noun reads as a fault in the app rather than a fact about their work. Third instance of this class found by looking; all three are now fixed and tested.

**What is established and what is not:** this is Playwright's WebKit, which is not WKWebView, and I cannot run the probe inside the packaged app without changing production code. So whether Tauri's own webview shares the limitation is unknown. What is no longer in question is whether the app depends on the answer — it does not. Writes are ArrayBuffers now, which both engines accept, and the app already held the bytes: it was wrapping them in a Blob only in order to store them.

Reads still accept the Blobs that sessions written by earlier versions contain, discriminated the way they always were, with the new explicit `encoding` field taking precedence when it is present. Three tests pin both shapes and the precedence. After the change the same chain runs with no console error at all.

## Comparison task 4 runs without hardware, so it was run

*"Find every project that references one sample, then decide whether it is safe to delete."* A `.xy` is read in the browser through **Open .xy from Mac**, so this task needs no instrument — and the inspector had never been rendered with anything in it.

It does its job: three references from a synthetic project, the one pointing at a sample not on the device counted as unresolved, each reference badged **on device** with its size, a search and an unresolved-only filter, and an exportable report. The caveat under the numbers is the important part and it is right there: *"Path inspection is partial… This report does not establish that other files are safe to delete."* That is the honest answer to the second half of the task, and the reason device deletion stays disabled.

The summary read **"1 unresolved references"**. A count beside a noun that does not agree with it reads as a fault in the reader rather than a fact about the project — and one unresolved reference is the ordinary case, not an edge one. All three counts now agree with their number.

A first attempt at the fixture produced no references at all, and the app said so accurately: *"No recognized paths found. This can be a synth-only project or a format this reader does not support."* The fixture was wrong — paths are framed as one null-terminated string, not split on separators — and the message was exactly what a person with an unreadable project should see.

## The benchmark task, rendered

Comparison task 2 in `docs/companion-app-comparison.md` specifies its own fixture: *twelve mixed-format samples, one 25 s, one named `c0`, one duplicate name*. That is a written-down test with an expected outcome, and it had never been run against the interface. It was, with exactly those files plus a `.txt` and a name full of characters the device refuses.

It does what the matrix claims. The plan reports **"2 of 12 files will not be written"** before anything is sent: the duplicate becomes `kick 2.wav`, the 25 s pad is skipped with *"25 s is longer than the 20 second limit. trim it first."*, `c0.wav` carries *"this device reads the note in the filename as the sample pitch — rename it if that is not the root note"*, the illegal characters are stripped, and the `.txt` is refused by name. That is Fieldwork's half of the task established; the timed comparison still needs an alternative run beside it, and the comparison doc now says exactly that rather than implying more.

**One flaw showed up in the doing.** A renamed file stated its new name three times: *"saves as kick 2.wav"*, then *"renamed to kick 2.wav so nothing on the device is replaced"* — and for a character rename, *"saves as tombadname.wav"* beside *"renamed to tombadname.wav"*, which added nothing at all. The name is already shown; the notes now carry only what it cannot say — *"a file of that name is already on the device, so this one is renamed rather than replacing it"* and *"renamed for characters this device will not accept"*. Same defect as the field target's duplicated note, on the screen someone reads before writing to an instrument.

## The connection bar said the same thing in four different situations

The other documented first-contact state is a **TP-7 on the bus but still in audio mode** — which is what every TP-7 owner meets before anything else, since it cannot be opened until it re-enumerates. Rendering it alongside a ready OP-XY showed the device list handling it well: both are listed, the TP-7 is marked *(enable transfer mode)*, and the one that can actually be opened is selected automatically.

The sentence underneath was the problem. It read **"Select a device in file-transfer mode."** whenever anything was found at all — including when a device had *just been selected for the user*, which is telling someone to do something already done. And for the owner of a TP-7 waiting in audio mode, the one message that would have helped — *use prepare tp-7*, a button sitting inches away — was never said.

There are four situations, and they now read as four:

- one ready device: **"OP-XY is in file-transfer mode. Connect device to open it."**
- several: **"2 devices are in file-transfer mode. Choose which one to open."**
- a TP-7 waiting in audio mode: **"A TP-7 is attached but still in audio mode. Stop any recording, then use prepare tp-7."**
- something else not in transfer mode: what to enable, and to look again.

Five tests cover them, including the nothing-found case that was already right.

## A missing folder was explained on a different screen from the one showing nothing

`docs/te-companion-feature-research.md` cites an owner thread titled *"no tape or album folders when I connect OP-1 field"*. That is a real, documented state, and it had never been rendered.

The connection bar handles it well: *"Folders not found: tape, album. Backup requires all library folders."* But the **Tapes & albums** tab is still offered — correctly, since the folders may appear after reconnecting — and going there showed **"0 items · 0 mb"** and an empty list, with nothing to say why. The answer was on a different screen, above a scroll, attached to an action the user took several steps ago. Someone in exactly the situation that forum thread describes would learn nothing from the view that is meant to show their tapes.

`missing_roots` never left `DeviceConnectionBar`; it was a local message, so no view could know. It is in app state now, and each media view knows which folders it reads — `tape`/`album`, `recordings`/`memo`, `drum`/`synth` — so an empty list can distinguish *the folder is not there* from *the folder is empty*:

> There are no tape or album folders on this device.
> Some transfer modes and firmware versions do not expose them. If you expect them to be here, reconnect in the other transfer mode and use refresh device.

The advice is deliberately limited to what the app already knows — the field has two transfer modes, and the profile's own hint names both — rather than guessing at a cause. Four tests cover it, including the singular wording, the genuinely-empty folder that must **not** get this explanation, and a missing folder some other view reads, which is not this view's business.

## A cancel button that named the wrong thing and did nothing

Busy states were the next set never built a fixture for: what a person looks at while a transfer runs. Starting an import and holding it there showed the banner working as intended — *"Copying 2 takes into your library. Keep the device connected."*, the workspace dimmed and `inert` behind it — beside a button reading **Cancel preview**.

There is no preview in an import. And `deviceOperation`'s options required a `cancel`, so all five callers that cannot be cancelled passed an empty function to satisfy the type; the banner showed its button whenever any options existed. Pressing it during a copy, a send, an install or a stem export did **nothing**, while telling the user they had cancelled something that was never running. Only the restore preview — one caller in six — had a real cancel behind it.

`cancel` is now optional, the five empty functions are gone, and the button renders only when an operation actually supplies one. Its label comes from the operation (`Cancel preview` for the restore comparison) and falls back to plain `Cancel`. An operation that cannot be stopped no longer offers to stop.

## Error states, rendered rather than asserted

Error *text* had been tested all along; no error had ever been looked at in place. Two were rendered: a library that cannot be opened, and an import where one file of three fails.

The failure messages themselves are in good order — *"This library was written by a newer version of Fieldwork (index version 2). Update the app rather than risk its contents."* in red beneath the toolbar, and *"1 imported · 1 already in your library · 1 failed: recordings/c.wav (Device file changed or transfer was truncated)"* naming the file and the reason.

What was wrong sat **above** the error. The panel header still read **"opening your library…"** — permanently, because the open had failed and there was nothing to replace it with. A person would have read a progress claim directly above the sentence explaining that it would never finish. The header now has three states rather than two: opening, open, and *no library open* with "Choose a different folder, or fix the one below and refresh." The **add files…** button is disabled in that state too, since without a library it could only fail.

That is the same shape as the preset panel's misplaced caveat: nothing computed the wrong answer, and the interface still told a person something untrue.

## Empty states, which is where a new owner starts

Every fixture up to this point had content in it. Rendering the empty ones — a fresh library, a connected instrument holding nothing — was the last thing left, and it produced the largest finding of the pass as well as a smaller one.

The **preset library on an empty device said only "no presets"**. That is a dead end at the exact moment someone has just plugged in a new or wiped OP-XY and is looking for what to do. It now reads *"No presets on this device yet. Build a kit in the Drum lab or a set in the Sample lab and send it, or use Install samples to put audio in `samples/`."* — both routes, each one tab away. A test also pins the case that must **not** get that advice: a library filtered down to nothing is not an empty device, and telling someone to go build something would be answering a question they did not ask.

Projects was already right: it offers **Open .xy from Mac**, a search, and a panel explaining what the inspector is for. Storage on an empty device shows the backup actions and no space review, which is correct — there is nothing redundant to report and it does not pretend to have checked.

## A recording already on your Mac could not reach the library at all

Looking at the empty states — the one view every new user sees first — turned up something larger than a layout problem. The takes library's empty state read *"Connect a device and import its recordings"*, and that was the only route there was. **Every part of the capture workflow was reachable only through a cable.** A bounce sitting on the desktop, a file exported from a DAW, a recording pulled off a card by some other tool: none of them could be auditioned, marked into regions, or sent to a drum pad, because none of them could get into the library.

This document had claimed, in an earlier pass, that "every empty state offers both device and local import". That was not true of this one, and finding the claim is what turned a wording question into a feature gap. The catalog itself had always expected local files — `Occurrence.source` has been documented as `"device"` or `"local"` since it was written — but nothing ever created a local one.

`catalog_import_local` does now. It opens a file chooser, **copies** what it is given, and publishes each file through the same `publish` the device import uses, so:

- Originals are never moved or altered; the file stays exactly where the user put it, and its path is recorded as the take's provenance.
- Identity is the same SHA-256 as everything else, so a file already held from a device gains a **second occurrence** rather than a second copy — the take now knows both places it came from.
- Each copy stages under its own name and cleans up after itself on failure, the lesson the device import learned the hard way.
- One unreadable file reports as failed and the rest still arrive.
- A cancelled chooser says nothing at all, rather than reporting a transfer that never happened.

The button sits beside the device import and is live with nothing connected. The empty state now names both routes. Four native tests, four component tests and one end-to-end test cover it, including the cancelled dialog and the already-held file.

**It also changes what can be validated before the instruments are involved.** Checks 1, 4, 5 and 7 in `docs/hardware-test-guide.md` — the library, the audition, region marking, the hand-off to a pad and the loop question — now run entirely on files already on the Mac. Anything awkward found there costs nothing but time, and the connected checks begin with the interface already familiar. The guide says so at the top of that section.

**The preset panel opened with a sentence about a feature it does not have.** The OP-XY library and its detail panel were the last surfaces to look at. The table, its filters, the expandable sample rows and the keyboard hints along the bottom are all in good order. The detail panel, though, began with *"Removal is disabled while project dependency coverage is incomplete. Copies preserve existing links."* — above the preset's own name, before anything about the preset itself. The first thing a person read when opening a kit was a negative statement about something the panel does not offer.

The constraint is right and stays; only its place was wrong. It now sits after the actions, where a delete button would be if there were one, and it is only rendered when deletion is in fact unavailable. A test pins the order — the name precedes the note — and a second asserts the note disappears if deletion is ever offered, so the explanation cannot outlive the absence it explains.

**The two remaining device views were rendered and found healthy.** Tapes + album on a field shows each side with its track count, its size and its own export, and Build A Tape's four slots each say that leaving one empty means anything in that slot on the device stays. Recordings on a TP-7 lists takes newest first with capture time, folder, size, preview and stems. Their rows are the six-column `.media-row` the template was designed for, which also confirms the container rule above did not disturb them.

One judgement call was left deliberately: **export stereo stems** is offered on memo files too, because the button is gated on the page rather than on the file's folder. A memo is a single-track note, so splitting one yields a single redundant stem. Hiding the button would be tidier, but nothing establishes that a multitrack file can never sit in `memo/`, and offering an occasionally pointless action is a smaller harm than withholding an occasionally useful one. Recorded here rather than changed.

**The auditioner reads in one unit now.** Rendering it was the last of the visual pass, and it was largely right: the waveform draws from cached peaks, the playhead, the marks, the save field and the saved regions with their hand-off buttons all present and legible. One inconsistency stood out at a glance and would not have shown up in any assertion. The in and out fields showed raw **frames** — `0`, `44100` — while five lines below, the same region read `0:30.00 → 0:31.00`, and the selection length, the take's duration and every saved region were all in minutes and seconds. One panel, two units for the same quantity.

The fields still take frames, because marking and zero-crossing snapping are frame-exact and a musician nudging a boundary wants that precision. Each now shows its time beside it, using the `formatTime` helper the rest of the panel already used. Writing the test for it caught an assumption of my own: the fixture is 96 kHz, not 44.1, so my first expectation was wrong and the component was right — the conversion uses the take's own sample rate, and the test now says so.

**The space review had it too — the third instance, and the second time my own fix was too narrow.** Putting the template on `.take-row` fixed the list I was looking at; moving it to `.install-row` fixed the install plan as well but still missed the storage page, whose rows carry neither class. The rule belongs on the container every one of these lists uses, and that is where it is now: `.install-rows .media-row`. Two rounds of fixing the instance in front of me, when the rule was the same each time.

The corrected space review also shows the `deviceSamplePath` fix doing its job in the interface: the duplicate reads `samples/user/kick.wav · sample library`, where before it would have said `samples/user/user/kick.wav` — a folder that does not exist, printed on the screen people use to decide what to delete.

**The install plan had the same broken row, and my fix had only covered half of it.** Rendering Install samples with a field attached showed the queued file as `m…` / `sa…` / `co…`. The template belongs on `.install-row`, which both the install plan and the takes list use — putting it on `.take-row` fixed the list I happened to be looking at and left the other one broken. That is worth recording as its own lesson: a fix aimed at the instance I could see, rather than at the rule, left an identical defect one tab away.

The same screenshot showed a second problem that is not layout at all. The target line prints a machine-readable format summary and then the profile's note, and the note I wrote for the field restated the summary: *"drum · .aif · 44.1 khz · 16-bit · 12 s mono / 20 s stereo · **.aif at 44.1 khz / 16-bit. 12 seconds mono, 20 seconds stereo.** each file arrives as its own file…"*. Two correct sentences that say the same thing read as carelessness, and there is no test that catches it — so the regression test now counts: the rate and the depth must appear exactly once in that line.

**The send review was rendered and found sound.** It is the one confirmation before anything is written to an instrument, and this pass added a whole block to it without ever seeing it. Driven the way a person reaches it — connect an OP-XY, load a sample, name the preset, press send — it reads correctly: the instrument and its serial, the destination folder, every file with its size, the free space, and the safety note. After a failed send and a check, the verdict, the per-file statuses, the reason a fresh send is now refused, and a prominent **add the 1 missing file** all render as designed, with **send to device** greyed out beside them. Nothing needed changing.

That flow is now a test rather than a one-off look. It walks connect → load → name → send → fail → check → complete against the real dialog, and finishes by counting the calls: exactly one upload attempt, one check, one completion. The count is the point — it is how "checking writes nothing" is held true in a browser, not just in jsdom.

**And then the takes list itself, which was unreadable.** Rendering the Takes tab with a field attached showed every take truncated to a single character — `2…`, `tr…` — with the size and date crammed beside it. `.media-row` is a six-column grid built for the device media page (checkbox, play button, name, date, size, export), and a take row has three children, so the name was being laid out in the 24-pixel checkbox column. The list that the whole capture workflow feeds had been illegible since it was built, and nothing in 750 tests could see it.

Take rows now have their own template. The screenshot afterwards also shows the thing the deduplication fix depends on actually working: `track_1.aif` reads `from OP-1 field · tape/side-1/track_1.aif`, which is what tells two identically named tape tracks apart.

The regression test measures what a person would notice — `scrollWidth <= clientWidth`, so the name is not clipped by its column — and it was verified by reverting the CSS and watching it fail with *"the take name is not clipped by its column"*, then restoring and watching it pass.

**Looking at it found two defects no test had.** Having built visible UI all session without once seeing it, I captured the tab bar and the shortcut sheet from WebKit and read the images. The sheet **opened scrolled past its own title**: focus was placed on the Close button, which sits at the bottom of a scrollable panel, so the browser scrolled it into view and the list began mid-sentence with no heading. My own end-to-end test asserted that the Close button was focused, so it passed — the test had encoded the bug. And the key groups wrapped, splitting `a s d f g h j` across two lines in a 104px column.

Focus now goes to the dialog itself, scrolled to the top, and the assertions were rewritten to pin the property that actually matters: the heading is in the viewport and `scrollTop` is zero. The key column is sized once per group from its widest entry — the `<dl>` is the grid and its rows are `display: contents` — so nothing wraps and every description in a group starts in line. The first attempt at that fixed the wrapping but made each row size its own column, leaving the descriptions ragged; the screenshot caught that too.

**The take library is covered end to end now, with a field attached.** The existing fixture already described an OP-1 field whose tree mixes `tape/studio/track_1.aif`, `track_2.aif` and `album/side_a.aif` with `drum/user/kit.aif` and `synth/user/pad.aif` — the exact scenario behind the capture-folder fix. A real browser now confirms the Takes tab offers **three** imports rather than five, and that the request handed to the native side contains only the tape and album paths. The second spec walks the takes listbox with the keyboard: one tab stop, `aria-activedescendant` following the focused row, arrows and `Home`/`End` moving it, and pressing past the end staying put rather than wrapping or dropping focus. That focus behaviour is precisely what can pass in jsdom and misbehave in a browser.

Four specs were added for the keyboard layer, because it is the part jsdom genuinely cannot speak to: whether a command chord reaches a window listener in a real engine, whether focus lands on something usable when the shortcut sheet opens, whether the sheet closes by every route it offers, and whether each visible tab really carries the number that reaches it. One honest limit is written into the spec: inside a browser tab the browser may claim ⌘1–⌘9 before the page sees them, so the chord assertions dispatch on `window` the way the app listens. The packaged app has no browser tabs competing for those keys, and the startup diagnostic is what covers the packaged path.

## The AIFF encoder that writes to a field had never been run by a test

Found by listing which modules have no test file, largest first, rather than by hunch. `aiffExport.ts` is 439 lines and the only test that mentioned it **replaced it with a mock**. Its output is what gets written onto an OP-1 field, and a malformed AIFF is a file the instrument will not load — so the earlier note in this document that "Field targets encode real AIFF" was resting on an unexercised module.

It is exercised now, and against an independent reader: every assertion parses the produced file with `aifParser.ts`, which was written from the other direction, so agreement means the encoder and the reader share an understanding of the spec rather than one confirming its own output. Eight tests cover the container and its declared size, the COMM description, the 80-bit sample rate at all three rates the app writes, big-endian sample order (asserted by also reading it the wrong way round, which is the failure that makes a file play as noise rather than not play at all), channel interleaving, even-length chunk padding for an odd byte count, AIFC with `fl32` for float audio, and refusal of a bit depth or rate it cannot write. All eight passed first time: the encoder was right, and nothing was holding it that way.

`op1Library.ts` — the module the entire OP-1 field view is built on — also had **no test file**, and it has sixteen now. The ones worth naming are about firmware variation, which is the reason that module matches by name rather than position: tracks sitting directly in `tape/` as older firmware wrote them, all four track spellings (`track_1`, `track 2`, `track-3`, `track4`), root names in any case, patches nested any number of folders deep, and the refusal to invent a `track_0` or `track_5`. One of my own expectations was wrong there and the code was right — a patch directly under a root sorts ahead of subfolders because its folder key is empty — so the test now records why.

Its `TRACK_NAME` pattern also independently corroborates the tape naming that the deduplication fix above depends on: four tracks per folder, named `track_N.aif`. That is corroboration from the same codebase, not from hardware.

## Five definitions of "audio", three of them wrong

`CLAUDE.md` names duplicated helpers as this codebase's first source of maintenance burden. Here it was literal: **five** definitions of which files count as audio, in one app.

| Where | Extensions |
| --- | --- |
| `is_audio_file` (`main.rs`) | wav, aiff, aif |
| `takeOrigins.ts` | wav, aif, aiff |
| `op1Library.ts` | aif, aiff |
| `op1Tape.ts` | wav, aif, aiff, **mp3, flac, m4a, ogg** |
| `tp7Library.ts` | wav, aif, aiff, **mp3, flac** |

The last two listed containers nothing in the app can decode. A `.mp3` in `recordings/` was counted as a **recording** — offered with preview and export affordances that could only fail — and a `.flac` handed to the tape assembler was planned as a track, behind a refusal message that read *"This is not an audio file this app can read."* while the code accepted exactly that file.

There is now one definition, `READABLE_AUDIO` in `teDevices.ts`, tied by comment and by test to the two containers `parse_audio_header` actually reads. `op1Tape`, `tp7Library` and `takeOrigins` all use it.

**`op1Library` keeps its stricter rule on purpose**, and is renamed `PATCH_EXTENSION` to say so: an OP-1 field patch is always AIFF, so a `.wav` sitting in `drum/` is not a patch even though the app can read it. That distinction was previously indistinguishable from a fourth inconsistent copy.

The extension list is pinned across both languages by the same parity approach as the roots, and `tp7Library.ts` — the module the whole TP-7 view is built on — **had no test file at all**. It has twelve now: recording versus unreadable classification, folders that are not the recorder's own, case-insensitive folder names, dotted file names, the timestamp fallback to the device's own modified date, newest-first ordering with same-second takes by name, and durations that cross into hours. All twelve passed on the first run, so that module was already right; what it lacked was anything to stop it becoming wrong.

## The two halves of the app disagreed about what an OP-XY is

Recognising a device also happens twice — `detectDeviceKind` in the frontend, `classify` in `src-tauri/src/te.rs` — and unlike the root lists, this pair is *logic*, so it could drift in a way no data comparison would catch. It had.

Both look for `xy` as a word. Rust splits the model string on anything that is not alphanumeric. The frontend used `/\bxy\b/` — and a regex word boundary treats `_` as **part of a word**. So a device reporting `OP_XY`:

- was an **OP-XY** to the native side, and would be backed up as one;
- was **unknown** to the interface, which then offered it the unknown profile — four tabs instead of seven, no library, no install, no projects, no transfer hint and no firmware notice.

Whether any firmware reports that exact string is speculative. What is not speculative is that the two halves of the app answered the same question differently, and that the dash-normalisation sitting one line above exists precisely because vendors are inconsistent with punctuation. The frontend now splits on non-alphanumerics like the native side does; a word split is the deliberate rule, `\b` treating `_` as a word character is a regex accident.

**Both classifiers now assert against one fixture.** `fixtures/device-models.json` holds 24 model strings and the kind each must produce, with a `why` on the ones that exist for a reason. `src/test/utils/deviceClassification.test.ts` runs it as a table, and `te.rs` reads the same file in its own test — so a change to either classifier fails on its own side, naming the case that broke.

The harness was verified by breaking each side in turn, not by trusting it:

- Restoring the old frontend regex fails with *"underscore: a regex word boundary would miss this, a word split does not: expected 'unknown' to be 'op-xy'"*.
- Dropping the `tp7` spelling from the native classifier fails with *"model \"tp7\" with product id None"*.

Both files were restored and both suites re-run afterwards. The fixture also pins the deliberate negatives: `OP-1` without "field" stays unknown, because the original OP-1 has no MTP transfer mode and claiming the field profile for it would be a guess; `Galaxy S21` contains `xy` but not as a word; an unrelated USB product id is not guessed at.

## The same device knowledge lives in two languages, and now cannot drift

`roots` in `src/utils/teDevices.ts` drives the inventory scan. `backup_roots` in `src-tauri/src/te.rs` is the authority for backup, restore and path validation. They are the same knowledge written twice, in two languages, and no test compared them — because each side is internally consistent, so nothing failed.

Drift would be silent and costly in both directions:

- A root added only to the frontend means the app lists a folder that **backups never save**. The user would have no reason to suspect it.
- A root added only to Rust means `backup.rs` requires that folder in every manifest, so restoring an **older backup fails** with *"Backup is missing a library root"*.

`src/test/utils/deviceRootsParity.test.ts` reads the Rust source, extracts each match arm, and compares it with the real frontend profile — every device, in the same order — plus the reverse direction: every device the frontend claims roots for must have a Rust arm. `unknown` deliberately has none on either side, because nothing is assumed about a device this app has not been taught.

The test was checked by injecting drift rather than by trusting it: adding a `voice` root to the Rust file alone fails with *"tp-7: teDevices.ts roots vs te.rs backup_roots"* and both lists shown. It also pins concrete parsed values, so a regex that matched the wrong thing cannot pass by having nothing left to compare.

## One failed download used to poison the rest of the batch

Traced deliberately after the fix above, because making eight same-named files importable is only safe if the code beneath it can hold eight same-named files.

The good news first: the library itself was already correct. Identity is the file's SHA-256, and `available_name` stores colliding names as `track_1.aif`, `track_1 2.aif`, `track_1 3.aif` — three different tape tracks keep their own audio, and the name the user knows them by is unchanged. That behavior had **no test**, though, despite now being the common case on an OP-1 field rather than an edge case, so it has one: three recordings, same name, verified byte for byte on disk afterwards.

The defect was one level down, in staging. A download is written to `staging/` before it is verified, the staged name was unique only *per second*, and `stream_object_to_file` opens with `create_new` — it refuses to write over an existing path, correctly. Nothing removed a partial file when a download failed. So on a field:

1. `tape/side-1/track_1.aif` fails mid-transfer — a USB glitch is enough — and its partial bytes stay in `staging/`.
2. `tape/side-2/track_1.aif`, in the same second, resolves to the same staged path.
3. It fails too, with the operating system's words rather than ours: *File exists (os error 17)*.

Every same-named file after the first failure failed, for a reason that had nothing to do with them. Two changes:

- **The staged name now includes the object's own handle**, so two files named alike in the same second cannot collide at all.
- **A failed download removes its own partial.** Those bytes are ours, not the user's; leaving them behind littered the library and blocked the next attempt.
- **Opening a library sweeps stale partials**, for the case no error path can catch — a crash or a force quit mid-download. Only regular files directly inside our own `staging/` folder, at the one moment no import can be in flight. Nothing in `originals/` and nothing on a device is touched, and an empty staging folder is not an error.

## A depth it cannot decode is now refused instead of played as silence

The two WAV parsers — `parseWavInfo` in the interface and `parse_wav_header` natively — were compared for the same kind of drift as the classifiers. They agree on the things that matter, and the interface is deliberately the stricter of the two (it validates the extensible-format GUID tail, which the native side does not). That difference fails safe: it refuses rather than misreads.

One real hole showed up on the native side, though, and my own AIFF parser had inherited it. Both accepted **any** sample depth that was a multiple of eight. `localaudio::sample_at` decodes 8/16/24/32-bit integers and 32/64-bit floats and returns zero for anything else — so a 48-bit recording parsed cleanly, drew a flat waveform, and played as silence, with no error to explain why. A file that opens and is silent is harder to diagnose than one that refuses to open.

Both parsers now ask `decodable(tag, bits)`, which mirrors exactly what the decoder handles, and name the depth in the refusal. Writing its test caught a contradiction in one of my own earlier AIFF fixtures: it declared the `fl32` encoding with 16-bit samples, which cannot both be true — and which would previously have been read as silence rather than refused.

## A field take you cannot open is not a take

Directly downstream of the fix below, and the reason to look for it: making `tape/` and `album/` importable meant the library would now hold **AIFF**, and the local audio reader was WAV-only. `parse_wav_header` refuses anything that is not `RIFF`/`WAVE` outright, so every imported Field take would have imported cleanly and then failed to audition, draw a waveform, or produce a region — *"This file is not a WAV recording."* The import would have created the dead end itself.

The local reader now reads both containers:

- `parse_aiff_header` handles `AIFF` and `AIFC`: the `COMM` description, the 80-bit IEEE extended sample rate, and an `SSND` chunk whose data starts after its own offset field. Intervening chunks (a `NAME`, a marker) are skipped with the odd-length padding the format requires.
- **Byte order is read from the file, not assumed.** `AIFC`'s `sowt` is the same PCM with the bytes reversed; reading it as big-endian would turn a recording into noise. `NONE` is big-endian, `fl32`/`fl64` are floats, and a genuinely compressed encoding is named in the refusal — *"This AIFF is compressed (ima4) … Export it as uncompressed audio first"* — rather than producing garbage.
- A window still comes back as a playable WAV whatever the source was: big-endian samples are byte-reversed in place, and 8-bit is re-centred rather than reversed, because AIFF stores it signed where WAV stores it unsigned. The sample *values* are untouched.
- Peak scanning reads both byte orders, so waveforms are correct rather than merely present.
- A file that is neither container is now named as such instead of being reported as a broken WAV: an mp3 is not a damaged recording, and saying so sends the user looking in the wrong place. The import filter no longer offers `mp3`/`flac` at all — no TE device writes them, and offering a take the app cannot open is the same dead end in a different coat.

Fourteen native tests cover it. The one worth naming asserts **cross-container parity**: the same audio written as WAV and as AIFF yields byte-identical windows and identical peaks. That is the strongest statement available without hardware — a take's waveform does not depend on which container it arrived in.

Stem export stays WAV-only, which is correct rather than a gap: it is offered only for TP-7 recordings, and its button is already gated on both the mode and the `.wav` extension.

## A field's patch library is not a pile of takes

Found while extending the capture workflow past the TP-7, and worth stating plainly because it would have been a bad first experience: **"import N new" swept every audio file in the device tree.** The tree is scanned from each device's library roots, which on an OP-1 field are `drum`, `synth`, `tape` and `album` — so a Field owner's first press of that button would have offered to copy their entire drum and synth patch collection into a library meant for recordings. Hundreds of files, several gigabytes, one click, nothing in the label to warn them.

- Device profiles now carry `captureRoots` — the folders that actually hold recordings — separately from `roots`, the folders that make up the library. Field: `tape`, `album`. TP-7: `recordings`, `memo`. OP-XY: `samples`.
- `isCapturePath` matches on folder boundaries and ignores case, so `tape/` matches and `tapes-old/` does not, and a device that writes `RECORDINGS/` is read the same as one that writes `recordings/`.
- A test asserts `captureRoots ⊆ roots` for every device, because a capture folder outside the scanned set would silently find nothing — the invariant keeps the two lists honest as devices are added.
- When there is nothing new, the panel now names where it looked — *"Nothing new in tape/ and album/ on op-1 field. Takes come from there, not from your drum and synth patches — those stay in the patch library."* An empty result on a device whose other folders are full is otherwise just a mystery.

Ten tests cover it, including the Field tree that mixes patches with tape and album audio and must yield exactly the two recordings.

## The app has one keyboard layer instead of nine hidden ones

The contract asks for keyboard-first operation with shortcuts "discoverable in the UI where they apply". The second half was failing quietly: the app had grown keyboard support in nine components — pad playing, take marking, list walking, tab arrows, modal keys — each with its own listener and **nothing anywhere that said so**. Undiscoverable shortcuts are not a keyboard-first app; they are a secret.

- `src/utils/shortcuts.ts` is now the single table of every shortcut, grouped by where it applies. The help sheet renders it directly, so the documentation cannot describe a key the app does not have.
- `?` from anywhere opens that sheet; `?` or `esc` closes it; a `? shortcuts` hint sits beside the tabs for anyone who would never guess.
- **`⌘1`–`⌘9` jump to a tab**, numbered from the visible list — the tabs change with the connected instrument, so a fixed numbering would point at the wrong panel. Each tab shows its own number, which is what makes the shortcut discoverable rather than documented. Out-of-range numbers are left alone rather than jumping somewhere arbitrary, command chords still work while typing, `⌥⌘n` is left to the system, and nothing fires during a transfer, when the workspace is inert anyway.
- Writing the sheet turned up three claims that would have been **false**, all now fixed or corrected: the zoomed waveform had no `esc` at all (added, with a test), its `p` is hold-to-play rather than a toggle (described accurately), and the drum lab's upper row is `w e r y u` — `t` is not mapped — so it is listed key by key instead of as a range.
- `isTypingTarget` reads the `contenteditable` attribute as well as the computed property, because the property is not implemented everywhere and a shortcut that eats a keystroke mid-rename is a bug the user cannot work around.

Eighteen tests cover the layer, and two more cover the escape that the zoomed waveform had been missing.

## Dead ends: controls that cannot act, and advice the app refuses to take

Found by sweeping for documented policies that nothing enforces. Five instances, one shape: the user is told to do something, or invited to press something, and there is no way through.

**The install path told people to do what this app disables.** A filename collision on the device was refused with *"already exists in {folder}; rename or delete it first"* — and `mtp_delete` and `mtp_rename` are deliberate refusing stubs, disabled while project-dependency coverage is partial. The advice was impossible inside the app that gave it. It now names what actually works: send it under a different name (which the install plan does automatically on a collision), or remove the file with whatever transfer tool they use for that. A native test walks every string literal in `main.rs` and fails on any message telling the user to delete or rename on the device, so the next such message cannot be written; it builds its own needles from fragments so it does not trip on itself.

**The audition transport was live before the take had been read.** `play` needs the sample rate to size its window, so it began `if (!info) return` — and the buttons rendered enabled from the first paint. A click during the header read did nothing and said nothing about why. On a 900 MB take on a slow disk that gap is visible. Both transport buttons are now disabled until the header lands, next to the summary line that already said *"reading this take…"*.

The test that should have caught this was **waiting on something always present**: the waveform `<canvas>` carries `role="img"` from the first paint, so `findByRole('img')` resolved immediately and the click raced the read. It failed roughly one run in ten and passed on retry — the worst kind, because a retry reads as a fix. Six other tests in the file waited the same way; all now wait on the header line, which cannot appear before the read resolves. One of them asserts *"play region"* is disabled with no selection, and would have passed for the wrong reason once the new guard landed.

**The zoomed waveform editor opened with nothing to edit.** Two of its three call sites pass `sample?.audioBuffer || null`, so a restored session whose audio failed to decode still has its row and its zoom button — and opening it rendered the full editor around an empty canvas with every control inert. It now says the audio is not loaded and offers a close button, which is the honest answer.

**A preset with no audio still offered to play it.** The device preset grid derives its play control from `preset.samples[0]`, and a preset folder holding a `patch.json` and no audio is an ordinary state on a real device. The triangle rendered anyway, with a pointer cursor and a *"play first sample"* tooltip, and the click fell through `else if (firstSample)` into nothing. The control is now absent when there is nothing to play, which also makes the state legible: a card with no triangle has no audio. The keyboard path that walks presets already broke silently on the same condition and now says why.

**The test suite's canvas stub was a list that could fall behind.** jsdom has no 2D context, so `src/test/setup.ts` supplied one as a hand-written list of methods ending in *"add any other needed 2d context methods here"*. The failure mode was misleading: adding one drawing call to a component crashed a test file that never mentioned canvas, with `ctx.closePath is not a function` thrown from inside a mount effect. The stub now answers any method, memoising one spy per name so call assertions still work, and returning the shapes canvas methods actually return (`addColorStop`, `width`, `data`). The list cannot fall behind because there is no longer a list.

Verified by removing each guard and watching the matching test fail. 891 frontend tests, 103 native tests and 72 end-to-end tests pass.

## Which projects use this sample — and what the answer is worth

The inspector could only answer the forward question: what does *this* project need. The question a person actually has before tidying a library is the reverse — *what else is using this file* — and answering it meant opening every project and comparing by eye. The matrix claimed **"orphan sample surfacing"** for this; that was an overstatement I found by checking what the code does. `standalone_samples` is simply everything under `samples/`, which is a structural fact — not inside a preset folder — and says nothing about references. A standalone sample may be used by a dozen projects. Calling it an orphan would invite exactly the deletion this app refuses to make anywhere else. The row now says what it does, and a separate row claims the reverse lookup.

`src/utils/sampleUsage.ts` reads every project on the device and inverts the references. One press, each reference in the inspector labelled with the other projects that use it, by name.

The part worth stating carefully is what it refuses to say. **An unread project makes every negative answer provisional.** If one project out of forty cannot be parsed, a sample that appears in none of the other thirty-nine is not known to be unused — the unread one may be the only thing holding it, and it is no less likely than any other. So the sweep reports `indeterminate` rather than `unreferenced` whenever anything failed to read, and `unreferencedAmong` returns nothing at all rather than a partial list, because a partial list reads as *"these are the unused ones"* and would be acted on. A positive answer is still conclusive on an incomplete sweep — a hit is a hit. Nothing in any state says "safe to delete": the app does not delete device content, and a sweep of one device's projects cannot see a reference held in a copy somewhere else.

**I got this wrong once in the rendering, which is the interesting part.** The module guarded the `unreferenced` case correctly, and then the inspector recomputed the narrower question — *does anything other than the project on screen use this?* — by filtering the current project out of the reference list. An empty result reads as "used by this project only", and that is a definite claim which an unread project makes unfounded. The incompleteness rule had to be restated one layer up, and I did not restate it. The rendered test caught it: the fixture's shaker showed *"used by this project only"* while a project sat unread. The fix was to move the question into the module as `sharingWith`, so the caller cannot express it wrongly — the same lesson as the CSS template and the modal audit, arriving for the third time. **Where a rule can be re-derived by a caller, it will eventually be re-derived incorrectly; move it behind a function.**

Also found here: my first `.xy` test fixture separated paths with a single NUL byte and produced one reference with all three paths run together. A single NUL separates segments *within* one path — the format stores a path as pieces that concatenate, and `readPath` joins them — so a double NUL ends a path. The parser was right; the fixture was wrong, and it now says so where the next person will read it.

Seventeen unit tests and one rendered end-to-end flow cover this, including the four-way distinction between a definite sharer, a definite sole user, an unknown, and a record kind that names no file at all (`content` is factory material; `short-ref` names a preset — counting either would report phantom usage and make a deletable file look pinned).

## Errors that named themselves three times, and a reason that was thrown away

Found while rendering task 1 (back up, then detect a single corrupted byte). The native detection was sound; the way failures reached the user was not.

**A three-byte file named `.wav` produced this:** *"Failed to read audio metadata: Failed to read audio metadata: Failed to read WAV metadata: Unknown error."* Three layers each wrapped the one below, and each also replaced a non-`Error` throw with the phrase `Unknown error` — so the most specific thing in the sentence was discarded and the least useful phrase ended it. Every layer was reasonable on its own. `wrapError` now adds a prefix only when the message does not already state a failure, and the test for it stacks three wrappers and asserts the innermost wording survives alone. Matching on the prefix text was not enough: *"Failed to read audio metadata"* and *"Failed to read WAV metadata"* are different strings saying the same thing at different granularity, and the inner one is the better of the two.

**`describeError` had been written "in one place rather than at 34 call sites", and four call sites never got it** — including `BackupPanel`, where a verification failure names the backup's path. A corrupted backup was therefore reported as *"Error: Backup verification failed … in /Users/nick/Backups/…"*: machinery in front, the user's home folder spelled out. Those four are converted; the nine in `useAudioPlayer` are deliberately left, because they go to `console.warn` and `describeError` is about what a musician reads.

**A failed audio probe threw its reason away.** `probeSample` recorded `problem` on the returned object and **nothing anywhere read that field** — so the install plan received a candidate with no duration and no format, and described it as *"audio details are unknown until this file is read"*. That is advice to wait, and it is wrong for a file that has already been read and failed. The reason now travels on the candidate itself as `unreadable`, the plan says *"could not be read: …"* instead, and it no longer promises a length check that cannot happen. The plan's caps were never bypassed — an unknown duration always warned rather than silently passing — so this was a wording defect, not a safety one, but it was wording that told the user the opposite of the truth.

**And a fix of mine broke a test for the right reason.** Routing that reason through `describeError` added its trailing full stop, which turned a parenthetical into *"half written (no recognized OP-XY project header.)"*. The period is correct for a standalone message and wrong inside brackets; it is trimmed where the interpolation happens, which is where the decision belongs. Worth recording because the test failure looked like a regression and was actually an improvement arriving through a brittle assertion.

One deliberate non-fix: `probeSample`'s `problem` field still exists alongside `candidate.unreadable`, because `SampleInstallPanel` catches it separately during render. Two fields holding the same string is worth a second look if a third reader ever appears.

## "1 items" — a convention with nothing enforcing it

Found while rendering task 3 (a TP-7 multitrack take into per-track stems). The stem export was fine. The header above it read **"1 items · 858.3 mb"**.

The interesting part is the ratio. **Fifty-two places in the app already got this right** with an inline ternary, and `ProjectsPage` even carries a comment stating the rule — *"Counts and their nouns have to agree; '1 unresolved references' reads as a bug in the reader rather than a fact about the project."* The convention was established, documented in place, and widely followed. What was missing was anything that noticed when a new line broke it, so eight lines had.

Fixed in the idiom the other fifty-two use, rather than by introducing a helper: there is no pluralization utility in this codebase, and adding one that only eight of sixty sites called would be a second convention competing with the first. `src/test/utils/countAgreement.test.ts` sweeps every non-test source file for a count spliced straight into a bare plural, with an opt-out comment for counts that are structurally guarded — `TakeAudition`'s "N regions selected" sits behind `chosenRegions.length > 1` and can never read "1 regions". It also asserts that its own pattern still matches the shape it is looking for, because a regex that quietly stops matching would pass forever.

**It caught two more sites in code I had written earlier the same session** — the batch hand-off's *"1 of 1 regions reached the drum lab"* and the project sweep's *"0 of 1 projects read"*. That is the argument for the test over the eight fixes, made immediately and at my own expense.

One expectation of mine was also wrong rather than the app's: the recordings list shows a take's name **without** its extension and puts the format in the detail line beneath (`recordings · wav`). Asserting the filename with `.wav` failed, and the app's choice is the better one. The test now asserts both parts.

## A stop button that could be seen and never pressed

"Slickest" is the part of the goal I had served least: the defects found so far were correctness and wording, not speed. So I looked at the slowest thing in the app — the project sweep I had just built, which reads every `.xy` on the device one at a time — and found two faults in my own work.

**The result died on a tab change.** `MainTabs` renders each panel as `{state.currentTab === 'projects' && <ProjectsPage />}`, so the panel is unmounted whenever another tab is shown, taking its state with it. Reading forty projects, pressing ⌘1 to check something in the drum lab, and coming back meant reading all forty again. The index now lives in `AppState`, tagged with the serial of the instrument it was built on, and `SET_TAURI_PROJECTS` clears it on a rescan — a different project list makes an old index an incomplete answer. The field is optional like its sibling device fields, which is also why adding it did not break nineteen test state literals.

**And the stop button was unclickable.** I added one to the panel, and the end-to-end test could not press it: `<div role="tabpanel" aria-busy="true"> intercepts pointer events`. The workspace is deliberately inert during a device operation, so **a cancel rendered inside a panel is visible, enabled, and impossible to click.** The app already had the answer — `deviceOperation(work, { message, cancel, cancelLabel })` renders the cancel in the busy banner, the one surface above the blocked panel — and I had not used it. The sweep now runs inside it with *"Stop reading"*, and the rule is written into `deviceOperation`'s own doc comment, beside the related lesson already recorded there about not offering a cancel that does nothing.

Stopping discards the partial result rather than publishing it, which matters more than it sounds: a half-read sweep would report samples as unshared on the strength of projects nobody looked at — the same incompleteness rule as everywhere else in this feature, applied to the interrupted case.

A sweep for other in-panel cancels found none broken: `BackupPanel` and `SendReview` both disable theirs while busy, and the take-rename and preview-mixer cancels are not inside device operations at all. Mine was the only instance. The nesting also holds up by design — every bridge `invoke` wraps itself in `deviceOperation` without options, so the inner reads increment the pending count without displacing the outer cancel.

## A full device scan per keystroke

Continuing to look at the slowest things in the app, since that is where "slickest" lives. This one is the worst interaction defect found in the whole pass.

**Typing a subfolder name re-read the device once per character.** The effect in `SampleInstallPanel` that lists the destination folder — so the plan can warn about collisions before writing — was keyed on `[target, subfolder, state.tauriDevice]`. Every run did a full `mtp_scan_tree` of `samples/` (or `drum/`), and every one of those runs inside `deviceOperation`, which makes the entire workspace `inert`. So typing *"field kicks"* meant **eleven MTP scans and eleven freezes of the app, including of the very field being typed into.**

The scan never depended on the subfolder in the first place. `mtpScanTree([target.destination[0]])` reads the same bytes whatever is typed; only the *filtering* of the result uses it. The entries are now held raw, scanned once per destination, and filtered in a `useMemo` that follows the field keystroke by keystroke without touching the device. A rendered test types eleven characters and asserts the scan count is unchanged; restoring `subfolder` to the dependency list turns 2 scans into **13**, which is how the defect was confirmed rather than assumed.

## Ten operations that all said "Working…"

While an operation is pending the workspace is inert and the busy banner is the only thing the user can see, so that banner's `message` is the entire explanation for the freeze. **Ten of the seventeen call sites passed none**, falling back to *"Working… keep the device connected"* — connecting, rescanning, zipping a preset, auditioning a sample, copying a preset, reading a folder, and refreshing the library after a send were all described by that one sentence, despite taking wildly different amounts of time and meaning very different things if interrupted.

Each now says what it is doing and, where it matters, whether anything is at risk: a read says *"Nothing is being written"*; a write says *"Keep the device connected"*.

**The ordering was wrong too, in the one place it mattered most.** After a verified send, `mtpScanPresets()` ran — a full library rescan, unnamed — and only *then* did the success notification fire. The user's experience was: an informative message about the write, then an unexplained wait of unknown length, then finally "sent and verified". The write had already succeeded and been verified before that wait began. Success is now announced first, and the rescan explains itself as *"Refreshing the library so it shows what is now on the device. The transfer is already finished and verified — nothing is at risk here."* This also fixes a real misreport: a rescan that failed after a successful write used to surface as an error on the send.

`src/test/utils/operationMessages.test.ts` sweeps every call and fails on one that passes no message; it accepts inline, ES shorthand and a named constant, asserts its own detector still recognizes the bare form, and separately requires that any operation offering a cancel names it — `cancel` without `cancelLabel` renders a bare "Cancel", which is vague when the thing being stopped is a read rather than a dialog.

## Saving a region wiped the marks for the next one

The subfolder defect had a shape worth sweeping for: **a cheap derivation sharing an effect with expensive work, so the expensive work re-runs whenever the cheap thing changes.** A sweep for effects that perform device I/O found exactly two in the app — the install panel, already fixed, and the audition panel. The second was worse.

`TakeAudition`'s effect read the take's header and peaks, and its dependencies were `[asset.id, asset.regions]`. `asset.regions` is an array, handed back fresh by the parent after every save, so **every saved region re-ran the whole effect** — which also cleared `info`, `peaks`, `playhead`, `markIn`, `markOut` and the typed region name.

So the actual behaviour was: mark a hit with `i` and `o`, save it, and the waveform blanks, the header is read again, the transport goes back to disabled, the playhead jumps to 0 and **the marks are gone**. Marking one hit destroyed the setup for the next — in the loop this entire workflow exists for. Renaming a take did the same thing, because that also replaces the asset object.

The reads depend only on *which take is open*; the region list depends only on its regions. Split accordingly. The selection is now pruned rather than cleared, too: dropping only regions that no longer exist, because clearing it wholesale lost a batch mid-assembly.

**The existing flow test did not catch this**, and the reason is instructive: `kit-from-take.e2e.ts` re-types the frame numbers for each of its three regions, so it never depended on a mark surviving a save. A test can walk the entire workflow and still miss a defect in it by being more thorough than a person would be. The new test marks once, saves, and asserts the marks are still there and the take was not read again — with the old dependency array it fails with `Expected "1000", Received "0"`.

## Unplugging one instrument threw you out of your work

The goal's own scenario is "working with all of them in a studio on a Mac", and one USB session at a time means the cable moves constantly. So what survives a swap is a workflow question, not a detail.

**Disconnecting jumped to the library tab unconditionally.** Five tabs need no device at all — both builders, takes, the library and the project inspector — so unplugging a TP-7 to reach for an OP-XY took you out of the kit you were building. The kit itself survived; you simply had to find your way back to it, and from wherever you landed the work was invisible. Building a kit from recordings while the recorder is plugged in and then sending it to the OP-XY is the most natural cross-device sequence this app has, and it was interrupted at its midpoint every time.

`resolveTabForDevice` already existed for the connect direction and already preserved the current tab where it could. The disconnect path simply did not call it. It does now, so both directions go through one function and cannot drift — the same lesson as `sharingWith` and the count-agreement idiom: a rule that a caller can re-derive will eventually be re-derived wrongly, or skipped.

Where a tab genuinely cannot exist without the device, the landing is now related rather than fixed: the recorder's tabs hand you to **takes**, which is your own copy of the same material, and the device-management tabs hand you to the library. A test asserts the invariant across every tab against every device state — thirty-six cases — that whatever comes back is a tab that device actually has.

Two rendered tests cover the sequence: a half-built kit stays put and stays loaded across a full TP-7 → OP-XY swap, and the recordings tab hands over to takes. Both fail against the old unconditional jump.

One of my locators was wrong rather than the app: the drum tab is labelled **"drum (op-xy)"** while a non-OP-XY device is connected — the app saying which instrument that builder targets — and reads plain "drum" once an OP-XY is attached. That is a nice touch I had not noticed, and the test now asserts both forms.

## The one failure a component test cannot catch

`docs/hardware-test-guide.md` names this as the failure worth reporting: *"Session saving stores sample audio in the browser database, and a WebKit build that refuses one of the shapes it used to store would lose the kit silently."* It has already happened twice in this work — some WebKit builds reject a `Blob` or `File` in IndexedDB outright, and the engine's error names neither.

It is also the one scenario a component test is structurally unable to cover, **because the risk is the engine itself**: a jsdom fake-IndexedDB happily accepts shapes that real WebKit refuses. `SessionRestorationModal.test.tsx` and the storage-shape tests both pass with a `Blob` in place. So the round trip now runs in the browser Tauri actually renders in: build a two-pad kit, reload the page, take the offer back, and assert both pads and the typed preset name return — plus that no storage error reached the console on the way out or back in.

**Verified by reintroducing the historical bug.** Changing one line to store `new Blob([arrayBuffer])` instead of the bytes makes both tests fail in WebKit; restoring it makes them pass. That is a regression guard for a defect that has twice reached a build, on the one path where the existing suite is blind by construction.

**No app defect this round — the app was right both times my test disagreed with it**, and both disagreements were worth understanding:

The prompt did not appear, and the reason was my precondition. I waited for the session *row* to exist and reloaded immediately; the row is written before the sample bytes land, and on the next launch `clearCorruptedData` checks every referenced sample and discards the whole session when one is missing. That is correct — a session whose audio is gone would restore as a kit of silent pads — so the fix was to wait for a session that is genuinely restorable: the record plus every sample it references. Polling for a proxy instead of the thing, for the third time in this work.

I also suspected the prompt was slow to appear and measured it rather than assuming: reload to first paint 109 ms, prompt 39 ms after that, **305 ms door to door**. Nothing to fix, and now known rather than guessed.

## Six modals never took the keyboard, and none gave it back

The README calls this app keyboard-first, and `?` lists every shortcut. What none of that covered was focus. Eight modals had three different answers: two moved focus inside, two trapped Tab, and **none returned focus to whatever opened them**. Five took no focus at all.

The worst instance is the one that matters most. **`SendReview` took no focus whatever** — the single confirmation before anything is written to an instrument. Opening it from the keyboard left focus on the send button *underneath the layer*, so Tab walked controls the user could not see, a screen reader announced the page behind the dialog, and reaching *"send to device"* meant tabbing blind.

`src/hooks/useModalFocus.ts` is now the one answer, and all eight use it: remember what was focused, focus the dialog, trap Tab, restore on close. Two decisions are worth stating:

**It focuses the container, not the first button.** Focusing the first focusable is the usual shortcut and it is wrong here — several of these dialogs lead with a confirm, and arming Enter on a write as the layer appears is a way to send something to an instrument by reflex. A focused container is announced by name, and Tab moves inward from there.

**It handles every Tab rather than only the ends.** The first version intervened only at the first and last element and let the browser do the rest, which failed in a way I would not have predicted: **natural tab order is not DOM order.** In WebKit, Tab from a button inside this fixed overlay lands on the app header, so focus left the dialog and the trap yanked it back on the following keypress — visible as a flicker, and with a screen reader on the wrong element in between. Computing the next element from its own list and always preventing the default is both simpler and correct.

**I reintroduced the very defect while wiring it.** `SendReview` returns null until a send is pending, and I passed the hook a literal `true` — so the effect ran on the first render with no container to focus and, the flag never changing, never ran again. The dialog opened with focus behind it exactly as before. `KeyboardHelp` had the same mismatch. The rule is that the hook's flag must be the component's own idea of being open, and `modalConventions.test.tsx` now parses both the flag and the `if (!x) return null` guard from each modal and requires they agree — which is the only reason two wrong wirings did not ship.

The conventions sweep also asserts the ref handed to the hook is actually attached to an element, and that no modal keeps a hand-written trap. Twenty-eight assertions across the eight, plus a rendered test that presses Tab eight times through the send review and fails if focus ever lands outside it.

## 438 KB of webfonts for icons the app never draws

Auditing the README's claims turned up one that holds — "native offline typography": there are no remote URLs anywhere in the shipped source, FontAwesome comes from `node_modules`, and Vite emits its fonts as hashed local assets. Checking *how much* it emits was the interesting part.

`src/index.css` imported FontAwesome's `all.css`, which declares four families — solid, regular, brands and a v4 shim — and Vite bundles a woff2 **and** a ttf for each whether or not an icon from that family appears anywhere. That was **1.00 MB of webfonts in a 3.56 MB frontend**, 29% of the bundle.

Every icon this app draws is a solid one. Importing `fontawesome.css` + `solid.css` only took the fonts to 584 KB and the bundle to **3.11 MB** — 456 KB smaller, 12.8% off.

The saving creates a trap, which is the real reason there is a test: a missing `@font-face` is not an error, so adding a `fab fa-…` icon now renders an **empty box** and nothing complains. `src/test/utils/iconFonts.test.ts` reads the icon classes out of source and the imports out of `index.css` and requires they agree in both directions — every style used must be imported, and no family may be imported that nothing uses. It found the second saving itself: `regular.css` was imported and **no `far` icon appears in any className**, worth another 93 KB.

It also surfaced two **orphaned components**. `DonatePage` and `FeedbackPage` are imported by nothing — left behind when the desktop app dropped those routes, which is why their tests were deleted earlier. `DonatePage` holds the codebase's only brands icon, a Patreon logo. They are excluded from the icon scan rather than deleted, because a page crediting the upstream author is the owner's call and not a cleanup to make unasked; the exclusion list is itself checked, so if either is ever imported again the suite says so instead of shipping an empty box.

**One of my own assertions was hollow, and only breaking the code showed it.** The rendered check first used `document.fonts.check('900 16px "Font Awesome 6 Free"')`, which returns **true when the family is absent entirely** — fallback text can still be rendered, so the call answers a different question than the one I meant. Deleting the `solid.css` import left it passing: the unit test caught the break, the browser test did not. Enumerating the registered faces and looking for `Font Awesome 6 Free@900` is deterministic, and now fails when the import goes.

The remaining 584 KB is a woff2 plus a ttf fallback that WebKit will never request, so it costs disk in the DMG and nothing at load. Not worth overriding FontAwesome's own `@font-face` to shave.

## The frontend was 47% payload

Following the font finding, I measured the rest of the bundle rather than guessing at it. The frontend went from **3,564 KB to 1,896 KB** and the DMG from 5,731,507 to **4,911,692 bytes**, in three findings.

**587 KB of `public/` was referenced by nothing.** Vite copies `public/` verbatim, so everything in it ships whether or not anything points at it. Exactly one file — `fieldwork-mark.svg`, the window icon — was referenced from `index.html` or any source file. The rest were artifacts of the upstream web app: two PWA screenshots of the old interface at 520 KB, a full set of web favicons and PWA icons, and a `NimbusSanL-Reg-webfont.woff`. That last one is worth naming, because it is the opposite of a problem: the app declares **no `@font-face` at all** and `--font-ui` is the system stack `-apple-system, BlinkMacSystemFont, …`. That is what "native offline typography" in the README means, and it means the 30 KB webfont had been loaded by nothing for a long time. I removed the four large dead items and left the small icon set, which is trivially sized and plausibly wanted if a web build ever returns.

**`public/CHANGELOG.md` was newer than the repository's own.** The shipped copy carried `0.16.0` and `0.15.6` entries that the root `CHANGELOG.md` had lost — so the changelog nobody reads was more complete than the one everybody does. Merged the missing entries into the root file, then removed the shipped duplicate. Their version lists are now identical.

**836 KB of CSS for 61 selectors.** `main.tsx` imported `@carbon/styles/css/styles.css`, the entire library. Measured from inside the running app — walking `document.styleSheets` and testing each selector against the DOM across every offline tab — **3,854 `cds--` selectors were declared and 61 matched anything**. (An undercount, since `:hover` and state selectors cannot match a static DOM, but not by an order of magnitude.) The app imports ten things from `@carbon/react`; `src/theme/carbon-subset.scss` pulls in those component sheets and the theme layers instead, taking the stylesheet to **246 KB**. CSS is parse-blocking, so this is the item that mattered most for how quickly the window becomes usable.

**That change is exactly the kind that breaks layout invisibly, so I did not trust it.** Before and after, I captured the computed values of twenty-three properties across eighteen Carbon selectors — including with the sample-settings modal open, so `Modal` and `Slider` were live — and diffed them. One real difference came out: `.cds--form-item` lost `position: relative`, which is what absolutely-positioned descendants anchor to. Carbon declares that rule **inside its text-area component**, applying it to every form item; this app has no text area, so a whole component sheet would have been a heavy way to obtain one declaration, and the subset now carries that single rule with a note on where it came from. The diff is now identical across every selector and property captured.

Nothing about this was visible by looking, and nothing errored. `carbonSubset.test.ts` reads the `@carbon/react` imports out of source and the component sheets out of the subset and fails when they disagree, verifies each named sheet still exists in the installed Carbon, and refuses a return to `styles.css` — because a component whose stylesheet is missing renders as an unstyled control rather than an error.

## Two dependencies nothing imported, and what they were really costing

The 1,012 KB JavaScript chunk was the largest thing left, so I measured what was in it rather than assuming. The interesting result is a negative one, and worth recording as such.

**`react-icons` (84 MB installed) and `carbon-components` (14.9 MB — the Carbon v10 package superseded by `@carbon/react` + `@carbon/styles`) are imported by nothing.** I checked whether they reach the bundle before touching either, and they do not: `grep` for `react-icons` and `carbon-components` in the built JavaScript returns zero occurrences. Rollup had been tree-shaking them all along.

So this was never a size problem, and removing them **did not shrink the DMG by a single byte**. What it did was take `node_modules` from 1,246 MB to 1,137 MB, and remove a trap: a dead dependency is one an editor will auto-import without hesitation, and nothing in the project would have said it was never meant to be here.

`sass` and `@types/uuid` were also declared as runtime dependencies while being purely build-time. They are devDependencies now.

**`axios` is pinned by dead code, and that is a decision rather than a fix.** Its only consumer is `src/utils/patreonPosts.ts`, the Patreon feed for the orphaned `DonatePage` — imported by nothing, tree-shaken out of the bundle, but still type-checked and therefore still requiring the dependency to be installed. Removing `axios` means removing `patreonPosts.ts` and `DonatePage`, and a page crediting the upstream author is the owner's call. Recording it here so the choice is visible: **three orphaned modules (`DonatePage`, `FeedbackPage`, `patreonPosts`) are what keep `axios` in the dependency list.**

`src/test/utils/dependencies.test.ts` reads the imports out of every `.ts`, `.tsx`, `.css` and `.scss` file in `src` and requires every runtime dependency to appear among them, resolving `@scope/pkg/deep/path` back to `@scope/pkg` so an scss-only dependency counts. It also refuses a `@types/*` package or a build tool in `dependencies`, and asserts its own resolver still works — a specifier parser that quietly stopped matching would report every dependency as used.

## The linter was already pointing at the bug I had found twice by hand

Two of this pass's defects were dependency-array mistakes — the install panel rescanning per keystroke, and saving a region resetting the audition panel. Both were found by reading. So I asked what the linter already knew: **21 `react-hooks/exhaustive-deps` warnings**, none in code written during this work, all in the inherited web app, and nothing gating them (`npm run pre-commit` runs tests and the build, not lint). Two turned out to be real and user-visible.

**The preset size was stale whenever a sample was swapped.** `PatchSizeIndicator`'s effect was keyed on `audioBuffers.length`, so replacing one sample with another did not re-run it — the count had not changed. Swap a 0.2 s hi-hat for a 15 s pad and the figure stayed where it was. This indicator exists to warn about the OP-XY's **8 MB preset limit**, and `getPatchSizeWarning` is driven by the same number, so a kit could be pushed over the limit while still reporting a safe size and showing no warning. It is now keyed on a signature of each buffer's duration, sample rate and channel count — exactly what `calculatePatchSize` reads — because the array itself is rebuilt by `.filter().map()` on every render and depending on it would re-run the async calculation continuously. Restoring the old dependency fails the new test on the swap case only, which is correct: adding and removing always worked.

The figure also had no accessible name and nothing announced it, despite arriving asynchronously and changing as samples change. It is a `role="status"` labelled "preset size estimate" now, which is also what made it addressable in a test.

**Reopening the recording modal silently reset the input device.** `getAudioDevices` read `selectedDeviceId` with `[]` dependencies, capturing the initial empty string. On first open that is right — choose the first device. On every reopen the stale closure still saw empty and overwrote the choice with `audioInputs[0]`, so a selected interface reverted to the built-in microphone with nothing said. In a studio with an interface attached, the next recording simply came from the wrong input. Fixed with a functional update — `setSelectedDeviceId(current => current || …)` — which reads the value at call time and needs no dependency at all, so the warning is genuinely resolved rather than suppressed.

## Twenty-two labels that named nothing

Writing that test could not find the device picker by its own visible label, and the reason generalised: **22 labels across five files carried no `htmlFor` and wrapped no control**, while the Carbon components beside them were given `labelText=""` deliberately. The visible text was decoration; the control had no accessible name at all. A screen reader announced "combo box" with no indication of what it set, and clicking a label focused nothing.

Measured rather than assumed, because the fix depends on where Carbon puts the `id` it is given: **Select** puts it on the `<select>` and **Toggle** on its `<button>`, so `htmlFor` associates both with no visual change — sixteen sites fixed that way, including two in `RecordingModal` and seven plain controls in the drum modals that needed an `id` adding first.

**Sliders are a documented exception, not an oversight.** Carbon's Slider always sets `aria-labelledby="{id}-label"` on its `role="slider"` element, pointing at an element it renders itself from `labelText`; `htmlFor`, `aria-label` and `aria-labelledby` passed to the component are all overridden. I verified that by rendering four sliders with each approach and reading back the result. Naming them means moving the visible text into `labelText` and letting Carbon render it, which changes how those six rows look — a visual decision, so `controlNames.test.tsx` lists them explicitly and separately asserts they are still unattached, so the exemption cannot quietly grow to cover the next unattached label beginning with "volume".

## Why nobody read the 365 lint problems

Having found two real bugs in the `exhaustive-deps` warnings, I looked at the next-largest category: 56 unused variables. **Twenty-six were `_value`, `_channel`, `_destination` and friends** — mock parameters in one test file, named with a leading underscore by the standard "deliberately ignored" convention, used entirely correctly. The lint configuration simply had no `argsIgnorePattern`, so it reported every one.

That is the answer to why the output went unread, and it is a configuration fix rather than a code fix: teaching the rule the convention the codebase already follows took the total from 365 to 314 and unused variables from 56 to 6. Six is a number somebody will look at.

It immediately caught something of mine: the `eslint-disable-next-line react-hooks/exhaustive-deps` I had added to `PatchSizeIndicator` an hour earlier was **unnecessary** — the rule does not complain there, and the suppression was defensive rather than needed. Removed.

The six that remained were worth the read:

**Two `audioBlob` bindings existed only to omit a key**, the `const { audioBlob, ...rest } = file` idiom. I had added an `omit()` helper for exactly this earlier in the work, so I reached for it — and it broke the build in an informative way. `restoreMultisampleFiles` takes `any[]`, and `Omit<any, K>` resolves to a bare index-signature object that is no longer assignable to `MultisampleFile`, while destructuring `any` stays `any`. **The two forms behave identically at runtime and only one type-checks**, so the helper is the wrong tool here; both sites now use the destructure with `_audioBlob`, and a comment records that the real problem is the `any[]` — while that stands, neither form proves the restored files carry the fields the patch generator reads. Worth saying plainly: that is a lead I did not chase, not a bug I fixed.

**Four caught errors were discarded, and three of them should be.** A sample whose bytes will not read is unusable however it failed, and the browser's decode error is irrelevant when the response is to fall back to the manual AIF decoder. Those are now `_error` and `_decodeError` with the reasoning written down, which is the difference between a silence that was decided and one that just happened.

**The fourth mattered.** `validatePresetJson` returned a flat `'Invalid JSON format'` for any parse failure. Every validation branch above it returns its own specific wording, so only a genuine `JSON.parse` throw reaches that catch — the category was right. What it threw away was the position: *"Unexpected token } at position 412"* is the difference between finding the problem in a hand-edited `patch.json` and giving up on the file. The reason is carried through now, and a new test asserts the message says *where*, not merely *that* — it fails against the old flat string.

## Following up the lead I had named

I ended the previous pass saying the `any[]` in the library restore path was where a real defect could hide unseen, so I checked it rather than leaving it as a note.

`generateMultisamplePatch` reads exactly five per-file fields besides the audio itself — `rootNote`, `inPoint`, `outPoint`, `loopStart`, `loopEnd`. Storage keeps the whole record minus the buffer and the File, and restore spreads it back out, so **the fields do survive**. Downloading a multisample preset from the library produces a correct patch. No defect.

That is worth stating as a result rather than silence, because the reason it needed checking has not gone away: `restoreMultisampleFiles` takes `any[]`, so **TypeScript checks nothing across that boundary**. A field could be dropped from the stored shape and nothing would complain until a downloaded preset came out wrong — with no error, no warning, and a file that looks plausible.

So the unprovable typing is now backed by a test instead. It saves a fully populated multisample file, reads what reached the database, and asserts each of the five fields is present **and still carries its value** — existing is not the same as correct. It also asserts the buffer is absent and the bytes are present, since the audio is deliberately rebuilt rather than stored twice.

A second assertion keeps the list honest: it reads `generateMultisamplePatch` and extracts the per-file fields it accesses, then requires that set to match the list being checked. Without it the test would keep passing while a newly-read sixth field went missing — the failure mode the whole thing exists to prevent, reintroduced one level up. Dropping `loopEnd` from storage fails it with a message that says what reads the field and why it matters.

## The one remaining step had no form to fill in

The hardware runs are the only thing that would move the goal's actual claim, and they are not mine to do. What *was* mine is how easy they are to start, and that had a real gap: the procedure said what to check and left the tester to invent a way to record it. Worse, `companion-app-comparison.md` told them to write results into `tp7-capture-validation.md` — this file, now 700-odd lines of findings, which is a strange place to take notes at a bench.

`docs/hardware-results-sheet.md` is the form. Thirty-four numbered lines to write on, in the order a session actually runs: does it work at all, then each instrument, then the capture loop, then the six comparisons with **Fieldwork's half already filled in** so only the clock and the rival tool are missing. It ends with a blank for the verdict on the goal's own wording, because that sentence should be written from results rather than inherited from me.

Details worth keeping:

- Every pre-filled figure was cross-checked against `companion-app-comparison.md` rather than transcribed from memory, and the build's SHA-256 against the artifact on disk — sheet, guide and file all agree.
- A coverage check against the guide caught one genuine omission: **Prepare TP-7**. The TP-7 needs a SysEx switch from the app before it appears as a device at all, with preconditions that are easy to miss — exactly one attached, in audio/MIDI mode, not recording. It is the likeliest reason a TP-7 never shows up, and it was implied rather than stated. It has its own line now.
- The guide itself was reordered. Thirty-three lines of build provenance — hashes, the bundler's AppleScript failure, which strings are in the binary — sat **between "Build and install" and "First connection"**, in the middle of the path someone walks. Reference material belongs at the end, and now is.
- The unverified questions are marked as questions in the sheet rather than buried in prose: whether the OP-XY's COM label is `m4` or `t4` on current firmware, whether the Field loads a bare `.aif` from `drum/`, whether it sees nested pack folders, and whether TP-7 firmware accepts arbitrary sample rates in `recordings/`.

## Settings that could not be reached at all

I had left the six slider labels as "needs a visual decision from you". That turned out to be wrong, and chasing it properly found something far worse underneath.

**The visual decision did not exist.** Naming a Carbon slider means putting the text in `labelText`, which renders Carbon's own label — and the app already styles `.cds--label` at 12px in the secondary colour, against the custom labels' 14px / weight 500 / primary. So there *was* a difference, which made it specifiable rather than unknowable: one rule targeting `.cds--label:has(+ .cds--slider-container)` reproduces the old appearance exactly, verified in WebKit as 14px / 500 / `rgb(38, 51, 44)` / 8px margin. Correct names, nothing moved. I also tested the idea I had dismissed without testing — giving my own element the id Carbon points at — and it does produce **duplicate ids**, resolving correctly only by document order. Worth having checked rather than asserted.

**Then the test refused to pass.** It could not find a single slider, because the rows live in a collapsed section whose header is a bare `<div onClick>` — and that is the real finding. No `role`, no `tabIndex`, no key handler: **not focusable, not announced as interactive, impossible to activate without a mouse.** With `sound` collapsed by default, six sliders and three selects were unreachable by keyboard entirely. Naming them would have been decoration on top of that.

A sweep for the pattern found fifteen clickable divs. Most are legitimate — overlay backdrops where Escape is the keyboard path, the envelope's drag surface, list rows with their own navigation — but two were live defects:

- **The three section headers**, now `role="button"` with `tabIndex` and Enter/Space handling.
- **`ToggleSwitch`**, a `<div onClick>` styled as a pill, used for the **export audio format** (wav/aiff) and the **MIDI note mapping** (c3/c4). Two settings a keyboard user could not change at all. It is a `<button role="switch">` with `aria-checked` now, with the button defaults reset so it looks identical.

`FileDropZone` looked like the worst of them — a click-to-browse div with a `display: none` file input, which would mean no keyboard path to loading samples. It is imported by nothing. The live drop areas pair with a real `<button>`, so that path was always fine. Checking before claiming mattered here.

Two of my own tests were wrong along the way, both caught by their own guards. The keyboard sweep flagged four sites that were **its own comments** — the phrase `<div onClick>` in the text explaining the fixes — so it strips comments now and asserts that it does. And `controlNames.test.tsx` started failing on "the slider exceptions still exist": I had written that assertion so the exemption could not outlive its reason, and it duly told me the exemption was now stale. Deleted.

## A test named for sorting that could not fail on it

The full suite went red once on `LibraryPage > should sort presets by date` and passed on retry. Reading it: it found the presets with `/Drum Kit|Multisample/` and then asserted that each one matched `/Drum Kit|Multisample/` — three tautologies. Its own comments said *"the exact order depends on the mock data"* and *"the order should be consistent after sorting"*, and then checked no order at all. **A sorting bug could not fail it**, and the flakiness came from `getAllByText` inside a `waitFor` racing a re-render while asserting nothing that depended on it.

The fixtures are dated deliberately — one now, one a day old, one two days old — so there is an order to assert. It now checks the default (newest first, which is what every user sees without touching anything) and both directions of the toggle. My first attempt asserted the wrong direction, which is how I learned the first click *toggles* rather than sets: the library opens `desc` already. Inverting the comparator now fails two tests where it previously failed none.

## Verifying a claim I had made without checking

Last pass I wrote that the twenty remaining `exhaustive-deps` warnings were "triaged as benign". That was not true in the sense the word implies: I verified two of them and judged the rest by reading the messages. The pass before that punished exactly this — something dismissed without testing turned out to hide keyboard controls nobody could reach. So I went back and checked the three that could actually hurt.

**`VirtualMidiKeyboard`'s key-release callback omits `onKeyRelease` from its dependencies.** A stale release handler is the textbook cause of a stuck note, so this was the one worth understanding. It is benign, and the reason is interesting: `MultisampleTool`'s `handleKeyRelease` does not close over state at all — it reads `window.opPatchstudioActiveNotes`, a **global list of sounding notes**, precisely so that releasing works regardless of which closure the handler came from. The global is a hack, and it is the hack that makes the missing dependency harmless.

**`useAudioPlayer`'s unmount cleanup warns about `activeNotesRef.current` changing before cleanup runs.** That is React's standard caution, and here the behaviour it warns about is the intended one: the effect iterates whatever is current at unmount and cleans up each note. Benign, verified rather than assumed.

So nothing to fix — but the global's contract was worth pinning, because it outlives the component and its failure mode is audible. Three tests now assert it: an entry appears when a multisample note sounds and disappears when the note is released; drum notes are deliberately absent, since the drum tool releases by its own path; and **nothing is left behind when the hook unmounts mid-note**, which is what switching tabs while a pad is sounding does. A leaked entry is a note id released forever and never cleared — a stuck note and a list that grows across mounts.

Both drain paths are load-bearing: removing the unmount cleanup fails with *"unmounting mid-note leaked an entry into a list that outlives the component"*, and removing the release removal fails with *"a released note must not stay in the global list"*.

The honest summary of this pass: **no defect found, and one of my own claims corrected from asserted to verified.** Worth recording as that rather than as a fix.

## Auditing the README's safety promise

The README says *"Every write to an instrument is reviewed once, verified byte for byte."* That is a promise about the thing this app exists to protect, and nothing enforced it. So I audited the four native write paths and found the real picture is more precise than the sentence — and worth writing down rather than smoothing over.

**Two guarantees, unevenly distributed.** `mtp_upload_preset` and `complete_preset_send` require a single-use `x-doxy-token` bound to the device serial, the session generation and a digest of the manifest, so a reviewed plan cannot be replayed or repurposed. `mtp_upload_at_path` (Install samples) and `mtp_copy_preset` have no token: their review is a frontend flow, which is a convention rather than a guarantee.

**But the guarantee that protects device content is enforced everywhere.** All three commands that write a *new* name refuse when that name is taken — by name, in the native layer, independently of any review. That is the invariant that means nothing is ever replaced, and it now has a test: `every_write_path_refuses_to_replace_existing_content` reads the body of each command and fails if the refusal is dropped. A second test requires the two plan-carrying paths to check their token.

**Writing that test taught me the contract rather than confirming it.** It failed on `complete_preset_send`, and correctly: that command's entire purpose is to fill in a folder that already exists, so refusing a taken name would refuse the only thing it does. It protects the same property by a different route — re-reading the folder, recomputing the missing set, and refusing when that no longer matches what the user was shown, so it can only add files that are genuinely absent. The test now asserts *that* for the completion path and the name refusal for the other three, which is the accurate rule rather than the tidy one.

Both tests were verified by breaking the code: softening the install path's refusal fails with *"does not refuse a name that is already taken"*, and removing the token check fails with *"writes without requiring the review token"*.

The asymmetry itself is left as it is. Token-gating the install and copy paths would be a real change to how those flows work, and the name refusal already prevents the loss this app is careful about; what was missing was anyone being able to see that, and that is now recorded in the test rather than in my head.

## My own audit had missed a write path

Last pass I audited "the four native write paths" and enforced their refusals with a test. There are **five**. `restore_backup` writes to the instrument exactly as sending does, and it lives in `backup.rs` rather than `main.rs` — which is precisely how it escaped an audit whose scope I had typed out from memory.

**The conclusion held; the scope did not.** Restore turns out to be the most heavily guarded of the five: it requires a token matching the preview, refuses when the device session generation has changed, refuses when the backup's own manifest has changed since the preview, **refuses the whole operation if any single file conflicts**, checks free space before writing, and skips files already byte-identical. "Additive recovery" is not a policy applied while writing; a conflict stops everything before the first byte. That is now asserted in `backup.rs`, verified by removing the conflict refusal and the session check and watching each fail with its own message.

**The more useful fix is the one that makes the next omission impossible.** A hand-written list of write paths keeps passing while the thing it was meant to cover moves out of view, so `no_device_write_path_escapes_the_audit` derives the list from the source instead: it finds every `#[tauri::command]` in either file whose body reaches `storage.upload` — the only way bytes get onto a device — and fails if one is not named by a write-safety test. Adding a new command that uploads fails it by name; I checked, with a real one.

**It found itself on the first run.** The slice after the last `#[tauri::command]` runs to end of file, so the detector read the test module and matched its own string literals, reporting `no_device_write_path_escapes_the_audit` as a device writer. That is the third time in this work a source-reading test has tripped on its own text — the native delete/rename test built its needles from fragments for the same reason, and the keyboard sweep had to learn to strip comments. The rule is clear enough now to state: **a test that reads source must exclude the tests, or it will find itself.** This one truncates each file at `#[cfg(test)]` and says why.

## The only automatic deletion in the app

The constraint this work has followed throughout is that no device content is overwritten, renamed, deleted **or auto-cleaned**. Device content is covered by the write-path tests. But there is one automatic deletion in the app, and it is not on a device: `sweep_staging` runs every time the library is opened and removes leftover files from an interrupted import — inside the owner's own recordings folder.

It is well bounded. One fixed subdirectory, loose files only, no recursion, and `remove_file` on a symlink removes the link rather than its target. The existing test covered the happy path and checked that a take in `originals/` survived.

**What it did not cover is where the damage would be.** `sweep_staging` reads `root.join(STAGING_DIR)`. If that constant were ever empty or `"."`, the join resolves to the **library root** — and the sweep would take `fieldwork-catalog.json` with it, losing every take's provenance, every recorded occurrence and every marked region, with no second copy anywhere. Nothing else in the code would look wrong; the function would read correctly line by line.

So the blast radius is now asserted rather than the behaviour alone: a file at the library root survives, the catalog is byte-identical afterwards, and a folder inside staging is left alone because the sweep removes files rather than directories. A separate test asserts the constant itself — non-empty, not `.` or `..`, no separators, resolving to something strictly below the root, and not equal to the originals directory or the catalog file name.

Setting `STAGING_DIR` to `""` fails **both** tests independently, by different routes: the constant guard on its own assertion, and the behavioural test where the staged files should still exist. Two detections for one catastrophe is the right number for the only place this app deletes anything without being asked.

## A flake, and the ordering problem behind it

The suite went red once in fifteen runs on `LibraryPage > should sort presets by type` — a sibling of the sort-by-date test fixed earlier in this work. The cause was the app, not the test.

**Two of the three fixtures are drum kits, so sorting by type is a tie.** `localeCompare` returns 0, `Array.prototype.sort` is stable, and the result is therefore whatever order the list happened to arrive in — so the same library could present the same two kits in either order between renders. The comparator now breaks ties by name.

**That change broke the pagination test, and the breakage was the interesting part.** Its 25 fixtures all spread one object, so they share a single timestamp: one long tie. With a plain `localeCompare` tie-break they sorted "Preset 1, Preset 10, Preset 11 … Preset 2, Preset 20", and page two began at "Preset 22". That is deterministic and wrong for a person.

Almost everything in this app is numbered — "long take 01", "Preset 12", "kick 2.wav" — so names are now compared with numeric collation, for the primary name sort as well as the tie-break. The sequence reads 1, 2, 3 … 10, 11, page two begins at "Preset 16" again, and **the pagination test passes unchanged**, which is the evidence that this is the order a person expects rather than one I preferred. A batch import is exactly the case where every timestamp collides, so this is the common path rather than an edge.

**The tie-break was not load-bearing until I made it so.** Removing it left all eighteen tests passing across six runs, because every fixture in that file arrives in name order — indistinguishable from a tie-break working. The new test supplies three presets with one shared timestamp in **reverse** name order and requires them to come back in name order; without the tie-break it fails. Eight consecutive full-suite runs are clean.

## `hdiutil verify` failed, and it was not the image

Packaging then reported *"verify failed - Resource temporarily unavailable"*, and I had already written that build's hash into the guide and the results sheet — recording a verified build that had not been verified. Worth naming as a process error rather than tidying away.

The cause: the image was still attached from the previous run in a half-open state. `hdiutil info` listed it with no mount point, so the file stayed held and nothing could read it. `hdiutil detach /dev/disk18 -force` released it, verification then passed, the diagnostic ran on the app extracted from the image, and the recorded hash was checked against the artifact that had actually been verified. The failure mode is now written into the guide, because it looks exactly like a corrupt image and is not one.

## Four tests in one file that could not fail

Six clean end-to-end runs turned up no flakes, so I swept the suite for weak assertions instead — tautologies, `toBeDefined()` on imports, `not.toThrow()` standing alone. `patchGeneration.test.ts` came back with four tests that asserted nothing about the code.

**Two were literally `expect(true).toBe(true)`,** with comments claiming to verify the behaviour their names described: *"should ensure all exported files have .wav extension"* and *"should correctly convert AIF loop points from seconds to frames"*. The second is the worse of the two, because loop points are the one thing `docs/hardware-test-guide.md` singles out as unsettleable by reading — so the suite appeared to cover exactly the thing I had flagged as uncovered.

**Two more asserted the mock rather than the generator.** The JSZip mock's `file()` returns a canned `{"engine":{"transpose":N}}` for any request, so a test that set `N`, generated a patch, then read it back through `JSZip.loadAsync` was reading its own fixture. **Deleting the transpose write from both generators outright left every test in the file green.** That is the proof rather than the suspicion.

All four now read what the generator actually wrote, using the `file.mock.calls` inspection the honest tests in the same file already used:

- The extension test asserts the name matches the *requested* format, which also corrects the test's own premise — this app exports AIFF as well as WAV, so "all files have .wav" stopped being true when that shipped. Forcing `getAudioFileExtension` to return `.wav` now fails it.
- The loop test builds a two-second 44.1 kHz zone looping 0.5 s → 1.5 s and asserts `loop.start` is 22050 and `loop.end` is **66149** — one less than the arithmetic, because the writers want the last frame rather than one past it. Dropping that `- 1` fails with `66150`.
- The transpose tests inspect the written `patch.json`. Deleting the transpose write now fails **two** tests where it previously failed none.

The canned fixture in the mock is left in place so `loadAsync` does not throw, but it now carries a comment saying it is a trap and why — a future reader reaching for `loadAsync` should know the answer is fabricated before they trust it.

My four new `mockZip as any` casts were replaced with `as unknown as JSZip` when the lint count rose from 314 to 318; it is back to 314.

## Finishing the assertion sweep

Having found four tests that could not fail, I went back for the two weak patterns I had listed and not investigated.

**A test whose comment promised more than it checked.** `usePatchGeneration.test.ts` captured the state handed to the generator and asserted that `envelope`, `envelope.amp` and `envelope.filter` **existed** — under a comment saying it verified the envelope *values*. So `{ amp: {}, filter: {} }`, or every number silently zeroed, would have passed. An imported preset's envelope reaching the generator with the wrong numbers is a patch that sounds wrong, so it asserts the eight numbers now; zeroing one sustain fails it.

**Two tests that checked a call happened but not what it carried.** Passing the right preset name and the current state *is* what `usePatchGeneration` does, so `expect(generateDrumPatch).toHaveBeenCalled()` left the hook's whole job unchecked. They now read the call's arguments: a wrong preset name fails two tests, and handing over a copied rather than the live state fails one.

**The other weak patterns came back clean, which is worth stating too.** A sweep for tests whose *only* assertions are `toBeDefined` or `toBeTruthy` found none — every remaining existence check sits beside a real one. The fifteen `toHaveBeenCalled()` sites without an argument check are almost all legitimate: `catalogChoose`, `mtpDisconnect`, `pickFolder` and `onClose` take nothing meaningful, and being called *is* the assertion. The seven `typeof x === 'function'` checks are cheap API-shape smoke tests rather than false claims, and are left alone.

That closes the sweep. Across it: four tests that could not fail, one that promised more than it checked, two that checked the wrong half, and — earlier — two flakes, each of which turned out to be the app rather than the test.

## I tested the wrong validator

I had written off the 267 `no-explicit-any` reports as "hiding correct code rather than bugs" on the strength of **one** data point. So I separated them: of ninety in non-test source, seventy-one are internal variables and **nineteen sit on a boundary** — a parameter or a return, where a real type would have to agree with a caller. That is the subset worth reading, and the first one read found something.

**There were two `validatePresetJson` functions.** One in `presetImport.ts` and one in `jsonImport.ts`. The live path is `presetImport.ts`: `importPresetFromFile` is what the drum and multisample settings panels call, and it validates with its own local copy. The one in `jsonImport.ts` was reachable from **nothing** — except the test I wrote for it last pass.

So last pass I improved the error message of a dead function and reported it as a user-facing fix. The live path already did the right thing: it has always kept the parse position in `Invalid JSON format: ${parseError.message}`. **The improvement was real and it reached nobody**, and the test I added gave the appearance of coverage for a path no user can take. Recording that plainly because the mistake is more instructive than the fix.

Worse, the coverage was inverted: the *dead* validator had a test and `importPresetFromFile` — the actual entry point — had **none**. So the duplicate is deleted, its test with it, and the live entry point is covered now: a valid preset imports, a non-`.json` name is refused by extension, malformed JSON keeps its position in the message, and a multisample preset imported into the drum tool is told which tab to switch to rather than merely rejected. Flattening the parse message fails one; removing the extension check fails another.

The `any` on that function was not itself the bug — the duplication was, and the `any` is what let two functions with different signatures share a name without anything objecting. That is a better argument for the typing work than I had before, and a correction to what I claimed about it.

## An imported preset could rewrite every object in the app

Following the lead I had named — `deepMerge(target: any, source: any)` — this is the most serious defect found in the whole pass, and the `any` is what hid it.

`deepMerge` merges an imported preset's settings into the base patch JSON. **The source is a file the user did not write:** presets are shared on forums and sound-pack sites, several of which the research doc cites, and `importPresetFromFile` feeds them through `mergeImportedDrumSettings` to here. The implementation was `for (const key in source)` with no key filtering.

`JSON.parse` keeps `__proto__` as an ordinary own property, so a preset containing `{"__proto__": {"polluted": "yes"}}` survives parsing intact. The merge then reads `target['__proto__']` — which is `Object.prototype`, and passes the `typeof === 'object'` check — and **recurses into it**, writing the injected keys onto the prototype every object in the app inherits from. `constructor` reaches the same place by another route.

I reproduced it before fixing anything: importing that preset put `polluted` on `{}`. And because the generated `patch.json` is an ordinary object, the injected keys would then have been **serialised and written to the instrument** with every patch the user produced afterwards.

The fix is `Object.keys` instead of `for...in`, plus a refusal of `__proto__`, `constructor` and `prototype` by name. `Object.keys` also stops inherited enumerable properties being merged, which is the same surprise from the other direction. Six tests cover it: the two pollution routes, inherited keys, that a legitimate preset still merges completely (the guard must not cost the feature), that a non-object source does not throw, and the same attack through `mergeImportedDrumSettings` — the function `patchGeneration` actually calls. Restoring `for...in` fails three of them.

**This is the argument for the typing work that I did not have before.** Two passes ago I wrote off the `no-explicit-any` reports as hiding correct code, on one data point. Separating the nineteen boundary uses from the seventy-one internal ones has now produced a duplicated validator with inverted test coverage and a prototype-pollution hole in the preset import path — two real defects from the first two entries read.

## A preset name with a semicolon in it lost every saved setting

Following the next lead I had named — the two `load*ImportedPreset(): any | null` functions — led to where they read from: a **cookie**, written with no encoding and no size check.

**`document.cookie = name=value` with a raw JSON value.** A `;` terminates a cookie, so saving settings while the preset name contained one truncated the stored JSON mid-string. The loader's `JSON.parse` then threw, the `catch` logged a warning nobody sees, and the app fell back to defaults — **taking the sample rate, bit depth and every other saved setting with it**. Reproduced before fixing: `{"presetName":"kick;snare"}` came back as `{"presetName":"kick`.

Values are encoded on write and decoded on read now. The reader falls back to the raw text when `decodeURIComponent` throws, so cookies written by earlier versions — plain JSON, and possibly containing a stray `%` — still load rather than being dropped.

**And the save reported success either way.** A cookie over roughly 4 KB is discarded by the browser without an error, and these cookies carry the imported preset, which is the large part. `saveDrumSettingsAsDefault` returned `void`, and the caller — a user-initiated action — always showed *"drum settings saved as default"*. So the flow congratulated the user on something that had not happened, which is the same defect as the interrupted-send success message found early in this work.

`setCookie` now reads the value back and returns whether it stuck; both save functions return that; and both call sites show either the success or **"These settings are too large to store — an imported preset is usually the reason"**, which names the cause and what to do.

Two things I got wrong on the way, both worth recording:

**My first test asserted the wrong thing.** I expected the preset name to round-trip, and it comes back empty — because the loader clears it deliberately: a *default* should not carry one specific preset's name. The app was right. The real claim is narrower and more useful: a `;` in that name must not destroy the settings around it.

**And the size test could not work in jsdom**, which does not enforce the 4 KB limit, so asserting it there would have been asserting jsdom's leniency. The mechanism — that the return value is a real round-trip check — is unit-tested; the limit itself is asserted in WebKit, the engine Tauri renders in. Same split as the IndexedDB work, for the same reason.

## Dropping a folder could kill the app outright

`processEntry(entry: any)` — the next boundary `any` on the list — is a recursive walk over a dropped folder, and it was unbounded in three directions at once.

**No depth limit.** A directory that contains itself, which `webkitGetAsEntry` can expose through a symlink, recursed until memory ran out. This is not a slowdown: running the test against the unbounded version does not fail an assertion, it kills the process with **`FATAL ERROR: Reached heap limit — JavaScript heap out of memory`**. The same thing would happen to the app.

**No file cap.** Dropping a sample library read every file in it into memory as a `File` before any filtering — for a tool that holds **twenty-four zones**. Nearly all of that work was thrown away after being done.

**Unbounded parallelism.** `Promise.all` over every child at once fired thousands of concurrent `entry.file()` calls, and no limit can stop work already started in parallel — so the recursion is sequential now, which is what makes the caps effective rather than advisory.

Bounds are eight levels and five hundred files, generous enough that a real folder of samples is untouched, and the drop reports when it stopped early — silently loading the first five hundred files of a library with no hint of truncation would look like the app losing samples.

**Three attempts at the test, and the first two were worse than useless.** The first asserted a promise race resolved, having picked the drop target with a CSS guess that matched nothing — so the handler never ran and the test passed by doing nothing. The second located the target by its visible text, which found it, but then asserted on a loaded zone and on a notification: the zone needs real audio decoding, which a one-byte fake file cannot provide, and the notification renders in `NotificationSystem`, which was not in the tree. Only the third asserts the thing actually under test — the fixtures count their own visits, so the walk's bounds are measured directly.

That progression is worth recording because the first version is the shape of a test that would have shipped looking green: a plausible-sounding assertion about a surface that can never appear.

## A loop that starts at the beginning of a sample

Two defects this time, the same shape: **`||` treats 0 as absent**, and 0 is an ordinary value for a loop point.

**Loading a saved preset moved its loop start.** `LibraryPage`'s restore defaulted with `file.loopStart || duration * 0.2` in four places across two call sites. A stored `loopStart` of 0 is entirely normal — it is what a loop beginning at the start of the sample means, and it is what `patchGeneration` itself writes — so restoring such a preset silently moved the loop 20% into the sample. Now one tested helper, `restoredLoopPoints`, using `??`, shared by both sites.

**And zero-crossing snapping quietly failed at the very start.** `APPLY_ZERO_CROSSING_TO_MULTISAMPLE_FILE` took the snapped result as `result.loopStart || initialLoopStart`. A snapped value of 0 is a real answer — `findNearestZeroCrossing` returns the lowest-amplitude frame it finds, and frame 0 is a legitimate winner — so `||` discarded it and reverted to the un-snapped position. The audible symptom is a click at the loop point, which is the one thing this snapping exists to prevent. **A third site in the same reducer already used `??`**, so the correct form was known and these two were oversights rather than decisions.

A sweep for the pattern found 68 numeric fields defaulted with a non-zero `||` fallback, and almost all are fine: a sample rate, bit depth or duration of 0 is genuinely invalid, so treating it as absent is right. The loop points were the ones where 0 means something.

**Three attempts at the reducer test, and the first two passed against the broken code.**

The first set the loop start to 0 and asserted it stayed 0 — but then `initialLoopStart` was also 0, and `0 || 0` agrees with `0 ?? 0`. It needed a *non-zero* loop start that snaps **to** zero.

The second built a buffer with silence at the head, which makes every early frame a candidate — so the snap never moved and the value came back unchanged either way. Reading `findNearestZeroCrossing` rather than guessing showed what a fixture has to look like: the signal non-zero from frame 1 so there is nowhere else for the snap to land.

The third still passed, because the whole branch is guarded on `autoZeroCrossing` and the test never enabled it — the code under test was not running at all. Only the fourth version fails against `||` and passes against `??`.

That is the fifth time in this work that breaking the code has caught a test of mine that proved nothing. It is also the argument for doing it every time: three plausible-looking versions of this test would all have shipped green.

## Hardware validation: pending

Nothing in this document establishes that any of it works against real hardware. The procedure is in `docs/hardware-test-guide.md` — build and install checks, first connection, per-device read-only checks, the six capture-workflow checks, and the failure checks. The five timed same-task comparisons in `docs/companion-app-comparison.md` are what would substantiate any claim about this being the best tool for the job; they require the instruments and a musician's judgement, and have not been run.
