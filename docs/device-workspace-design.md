---
type: design
title: "Managing device data: what the user is actually asking"
tags: [fieldwork, design, tp-7, op-1-field, op-xy, ux]
created: 2026-09-27
---

# Managing device data: what the user is actually asking

Written during the first session in which this app was connected to a real instrument — a TP-7, serial F1RYA129, 13 recordings, 184.9 MB. Everything before this was virtual-MTP fixtures and browser mocks.

**Method, and its limit.** The observations below come from one owner using one device for one evening. That is a thin base for a design, and it is stated up front so nothing here reads as validated. What it has over the earlier research ([[product-vision]], [[te-companion-feature-research]], [[companion-app-comparison]]) is that it is the first evidence of *this app* being used rather than reasoned about. Where it contradicts those documents, it is newer but not automatically righter. The OP-1 field and OP-XY have still never been connected, so every claim here about them is inference.

Scope is a personal studio tool ([[fieldwork-personal-tool-scope]]): sensible defaults over configurable options, a short workflow over a complete one, and no feature that only matters to somebody else.

---

## What was observed

1. **The interface was described as "chaotic" while a TP-7 was connected.** With the TP-7 open, ⌘1 and ⌘2 are Drum lab and Sample lab — builders for an OP-XY that is not plugged in — each wearing an `XY` badge. The device's own screen is ⌘4. The app had also landed on Sample lab rather than anything TP-7-related.

2. **Renaming was expected on the recordings list, and is not there.** Every TP-7 file is named `2026-09-27_224345_000`. The stated expectation was to click a name and type. Naming exists, but in the Takes library, one tab away and after an import step.

3. **Two layout shifts under the cursor, both from conditionally rendered bars.** The busy banner (`position: sticky`, so still in flow) and the preview mixer (`{playing && …}`) each inserted themselves above the list at the moment of a click. Both fixed; noted here because the cause is structural — any bar that appears on state change will do this.

4. **Sorting was requested, by "creation date, file size, name, length".**

---

## The questions a user is actually asking

Reordering the feature list around what someone is trying to find out, rather than what the device exposes:

| The question | Where it is answered today | Cost to answer |
| --- | --- | --- |
| **"What *is* this recording?"** | Nowhere but playback | One audition each |
| "Which of these do I care about?" | Search + folder filter + checkboxes | Manual |
| "Where did it come from, and when?" | Takes rows, well | Free — already stored |
| "Is this one already safe on my Mac?" | Takes tab, indirectly | **Free** — see below |
| "What is eating my space?" | Storage tab | Free |
| "Can I get it into a kit?" | Region marking → pad | Good, but three tabs |

Question one dominates everything else, and it is the one the interface helps with least. **A timestamp is not a name, so every recording is anonymous until played.** That makes audition-then-name the primary loop of the whole TP-7 workflow, not a side feature — which is exactly what observation 2 was reporting.

---

## Five findings that change the design

### 1. The device screen and the take library are one workflow split across two tabs

Look at what actually happens: read the recordings off the TP-7 → play one → decide it is worth keeping → import it → name it → mark a region → send it to a pad. Steps 1–3 are the Recordings tab; steps 4–6 are the Takes tab.

The rename friction in observation 2 is this seam. The instinct to rename where the file is listed was right; it only looked wrong because the app answers "renaming lives after the import step". **The fix is not to move renaming onto the device list — it is to stop making import a tab change.**

### 2. Renaming on the device is refused, and should stay refused

`mtp_rename` is a stub that always errors, with native tests asserting the refusal text and forbidding `.rename(` and `.delete(` from appearing in source. This is load-bearing on the OP-XY, where projects reference samples by path and a rename silently breaks them. The TP-7 case is genuinely weaker — recordings are not referenced by projects — but the guard is app-wide, and a per-device exception is exactly the kind of special case that later gets applied to the wrong device.

Labels are the answer, and they are strictly better for this workflow anyway: the bytes never move, re-importing the same audio still dedupes by content, and the recorder still shows the name it gave the file so the two can be reconciled later.

### 3. "Is this already in my library?" is free, and it is the most valuable column we do not show

`knownOrigins` already builds a `source_path → {device serials}` map from catalog occurrences, and `CaptureLibraryPanel` already computes it. Answering "has this exact device file been imported?" costs **no device reads and no hashing** — it is a map lookup that is already in memory.

That single fact answers the question behind most space management: *can I clear this off the device?* Right now that question requires switching tabs and comparing lists by eye.

This is the highest value-to-effort item in this document.

### 4. Sort keys collapse on a TP-7 — so sorting matters more in the library than on the device

On a device whose files are all named `YYYY-MM-DD_HHMMSS_NNN` in one folder at one format:

- name order **is** capture order
- date order **is** capture order
- duration order is *approximately* size order, because the format is fixed

So three of the four requested sort keys produce the same list. The real win on the device list is not a sort control but **a correct default: newest first.** What is on screen first should be what was recorded most recently.

Sorting earns its keep in the **Takes library**, where names are real, sources are mixed (TP-7, Field, files off the Mac), and capture date and import date genuinely differ.

### 5. Duration is not free, and the other three are

The native scan returns `path, handle, parent_handle, is_directory, size, modified` — no duration. Sorting by name, date or size is free today. Duration requires reading each file's header over MTP to get sample rate, channels, bit depth and data-chunk size.

That is feasible — `mtp_read_partial` exists, headers are small — but it is one device round-trip per file, on a transport whose real-world speed we measured for the first time tonight. It should be lazy and visibly progressive if it happens at all, never a blocking cost on opening a tab. Given finding 4, size is a good enough proxy on a fixed-format recorder that duration may not be worth the round-trips.

---

## Proposed structure

Two zones, replacing one flat tab strip. This is the shape proposed in conversation, with one amendment.

**Device** — reshapes with what is attached, and is where the app lands on connect.

| Attached | Screens |
| --- | --- |
| TP-7 | Recordings · Install · Storage |
| OP-1 field | Patches · Tapes · Install · Storage |
| OP-XY | Library · Projects · Install · Storage |
| Nothing | One "connect an instrument" panel |

**Workbench** — always present, cable or not: Takes · Drum lab · Sample lab.

**The amendment: Takes and the builders must not become device screens.** The take library is deliberately cross-device — it holds TP-7 takes, Field tape tracks and files that never came off a device at all — and it is usable with nothing plugged in. The builders produce OP-XY presets but are in `OFFLINE_TABS` on purpose; filing them under an OP-XY screen would mean needing an OP-XY attached to build a kit, which is worse than today.

Cross-device actions become widgets on the device screen, as proposed — and most already exist as actions rather than navigation: `SendReview` is the send-to-OP-XY flow, `useRegionHandoff` already puts a marked region on a pad.

**Cost.** The panels are already correctly scoped components — `DeviceMediaPage mode="recordings"` *is* the TP-7 screen. This is a change to `TabNavigation`, `MainTabs` and the `tabs` arrays in `teDevices.ts`. The `tabLabel` hack that appends `(op-xy)` to borrowed tabs deletes itself, which is the clearest signal the structure was wrong: navigation that has to apologise for itself is navigation in the wrong place.

---

## The file list, concretely

For the device recordings list, in value order:

1. **Default to newest first.** No control needed. (Finding 4.)
2. **An "in library" marker per row** — imported / not imported. Free. (Finding 3.)
3. **Import and name from this row**, without a tab change. (Finding 1.)
4. **Sortable columns** — name, date, size. Free. Duration deferred. (Finding 5.)

For the Takes library, sorting is worth more: name, capture date, import date, size, and duration — which *is* known locally there, because the files are on disk.

**On sort as an interaction:** click a column header, click again to reverse, one sort at a time, not persisted between sessions. No multi-key sorting, no saved views. Defaults over options.

---

## Deliberately not proposed

- **Deleting from the device.** Disabled app-wide and should stay so while dependency coverage is partial.
- **Tagging, rating, colour-coding, smart folders.** A library of a few hundred takes is served by search and a good name. These pay off at a scale this tool will not reach.
- **Waveform thumbnails in the list.** Would answer "what is this?" beautifully and costs a full read per file over MTP. Revisit only if the transport turns out to be fast.
- **Multi-key sort, saved views, per-device layout preferences.** Configuration standing in for a correct default.

---

## Playback latency, and why there is no disk cache

Pressing play took about a second to make a sound. The obvious fix — copy files to local
disk ahead of time — was considered and **rejected**, because the latency was not
disk-versus-USB. It was volume:

| Before one click of play | |
| --- | --- |
| Header probe, to read ~100 bytes of header | 1.05 MB |
| The full 30-second window, fetched before any of it played | 8.64 MB |
| **Total before the first sample sounded** | **9.69 MB** |

A cache would have hidden that by paying it earlier, and bought a materialized view of the
device to keep in sync — staleness, disk budget, invalidation on every rename and delete.

**Playback is streamed instead.** A 2-second opening window starts the audio (0.64 MB,
about 15× less), and 6-second chunks are fetched while it plays. Chunks are cut on frame
boundaries, so each is independently decodable and consecutive windows abut exactly;
scheduling each at the previous one's end time is sample-accurate and therefore gapless.
A 6-second chunk buys 6 seconds of playback and arrives in well under one even on a slow
link, so the margin is roughly tenfold. Nothing is written to disk and nothing is cached.

Two costs were measured and deliberately left:

- **Each chunk re-reads the 64 KB header probe** — about 384 KB per preview, all of it
  behind audio that is already sounding. Passing the parsed layout between chunks would
  save it and would make `readDevicePreview` stateful; a self-contained call that returns
  a complete decodable window is worth more than 64 KB of background traffic.
- **`mtp_read_partial` calls `storages()` on every invocation**, which is
  `GetStorageIDs` + `GetStorageInfo` — two USB round trips before each read, uncached, and
  the same pattern in all 15 native commands that touch storage. Chunking makes more calls,
  so there are more of these than before, but they now fall in the background rather than
  in front of the first sample. Worth caching for reads if the device ever feels slow
  elsewhere; free space would have to stay uncached, since write paths check it.

## Open questions

1. **Does the restructure happen before or after the remaining hardware checks?** Data-path findings survive a navigation change, so testing first loses nothing — and one session with real recordings will sharpen what a TP-7 screen should show.
2. **Is duration worth the round-trips on a recorder whose files are fixed-format?** Best answered by noticing whether size ever misleads during the checks.
3. **Does an "in library" marker change the space workflow enough to pull backup status onto the same row?** The catalog knows both; the row may not have space for both.
