---
type: design
title: "A songwriting studio for the field system"
tags: [fieldwork, design, op-1-field, tp-7, logic, songwriting]
created: 2026-10-06
---

# A songwriting studio for the field system

**The workflow, as stated:** write on the OP-1 field's four tape tracks → multitrack out into the
TP-7 → see the passes and their tracks here → rename, organize, arrange → hand the components to
Logic Pro.

**The frame:** Scrivener for songwriters. An app for assembling a song out of fragments, that
happens to speak field system.

Scope is a personal studio tool ([[fieldwork-personal-tool-scope]]). Builds on
[[device-workspace-design]].

---

## The correction this starts from

An earlier pass of this conversation treated **split into stems** as nearly redundant — the
reasoning being that stems are grouped into stereo pairs, so a 2-channel recording yields one file
identical to the original.

That is true of a stereo memo and **false of everything this workflow produces**. A multitrack pass
off the OP-1 field is one multichannel WAV, and splitting it is the entire point. Stem splitting is
not a secondary feature here; it is the hinge the workflow turns on. The research already said so —
`te-companion-feature-research.md` gap #5 records owners splitting TP-7 multitrack takes by hand in
Audacity — and I under-read it.

---

## What is true today, verified in the source

| | |
| --- | --- |
| **Multichannel is supported** | The WAV parser accepts up to 32 channels; `stem_layout` groups them into stereo pairs with a mono remainder. Splitting streams to disk, so length is bound by free space. |
| **Eight channels is exactly four tape tracks** | `stem_layout(8) == [2,2,2,2]`. If the field sends four *stereo* tracks, the existing split already produces precisely the four tracks you recorded. |
| **TP-7 is flat and refuses folders** | Roots are `recordings` and `memo`. Grouping has to live on the Mac. |
| **Takes are content-addressed** | `Asset.id` is a SHA-256 of the bytes; the same audio imported twice is one asset with two occurrences. |
| **Regions already exist** | `Region { id, name, start_frame, end_frame }` — a named region is already a song part, with no way to say which song. |
| **Local files know their shape** | `local_audio_info` returns `channels`, `sample_rate`, `bits`, `duration_seconds` for anything in the library. |
| **Cutting a part out is nearly free** | `localaudio::window_bytes` seeks to a frame offset, converts AIFF big-endian, and returns a complete canonical WAV. |
| **No grouping anywhere** | Assets, occurrences, regions, transfers. No collection, no ordering, no notion of a song. |
| **No BWF support** | Nothing writes a `bext` chunk. This is the Logic bridge, and it is missing. |

### Two gaps this workflow walks straight into

**1. You cannot tell a song pass from a voice memo in the device list.** Channel count is not in the
device scan — only in each file's header. For this workflow that is *the* most important fact about
a file: a 4-track pass and a stereo note look identical until imported. Previously deferred as not
worth a read per row; this workflow changes the calculation, because the number of tracks is what the
list is for.

**2. Stem splitting is device-only.** `export_device_stems` takes an MTP handle; there is no local
equivalent. So a pass must be split *before* or *instead of* being imported — exactly backwards from
the order the rest of the app is built around.

---

## The shape of the data, corrected

The earlier version of this note modelled a song as a list of separate files. The multitrack
realisation makes it simpler and better:

> **A pass is one multichannel recording. Its tracks are a view of it, not separate things.**

That matters because it preserves everything the catalog already does well. One pass is one asset:
one SHA-256, one dedupe, one name you type once — "verse idea 3" — and the four tracks come along
for free. Splitting on import would shatter that into four assets with four names and no stated
relationship, and would throw away the one guarantee that makes them useful: they are aligned
because they are channels of the same file.

**So: do not split on import. Split at compile time.** The pass is the unit of identity; the stems
are the unit of output.

```
Collection { id, name, parent: Option<Id>, created_unix }   // album → song
Member     { collection_id, asset_id, region_id: Option<Id>, index }
```

A member is a whole pass or a named region of one. `index` is the arrangement order — the thing
folders cannot express, which is why everyone ends up typing `01 `, `02 ` into filenames.

Nothing moves on disk. A collection is catalog metadata, exactly like a label.

---

## Compile to Logic

Scrivener's defining feature is that you write in fragments and **compile** into a manuscript. The
analogue is exact, and it is the feature that makes this a songwriting app rather than a file
browser.

**Compile takes a song and writes a folder Logic can swallow whole.** Each part's stems are split
out at that moment, named, and stamped with a BWF `bext` chunk whose `time_reference` is a sample
count. Import the folder in Logic, choose **Move to Original Recording Position**, and the
arrangement lays itself out.

The alignment maths is trivial because of the multichannel structure:

```
yard door song/
  01 verse/                      part starts at 0:00
    track 1.wav   bext = 0
    track 2.wav   bext = 0        ← same offset: aligned by construction
    track 3.wav   bext = 0
    track 4.wav   bext = 0
  02 chorus/                     part starts at 0:22.4
    track 1.wav   bext = 22.4 s in samples
    ...
```

Every stem of a part carries the part's position. Within a part the offset is identical for all
tracks, because they are channels of one recording — there is no drift to correct and no sync to
get wrong. Across parts, the offset is wherever you ordered it.

`bext` is 602 bytes of fixed layout, and the app writes WAV headers in three places already
(`wavExport.ts`, `stems.rs`, `localaudio::canonical_header`), so it is a contained addition to the
native exporter.

**Unverified:** Logic's import behaviour has not been tested from here. The `bext` spec and Logic's
support are well established, but whether the exact field layout satisfies Logic is worth a
five-minute check — export two files with known offsets, import, and see where they land — before
building on it.

---

## The hardware question that decides the split

`stem_layout` assumes **stereo pairs**. That is right if the OP-1 field sends four stereo tracks
(8 channels → four stereo stems, exactly the tape tracks).

**It is wrong if the field sends four mono tracks.** `stem_layout(4)` returns `[2, 2]`, which would
pair track 1 with track 2 and track 3 with track 4 — two stereo files, each holding two unrelated
tape tracks. Silently, and the audio would sound plausible.

So before building compile, the thing to check on hardware: **record one multitrack pass and look at
the channel count.** 8 means the existing split is already correct. 4 means stem grouping needs to
be per-channel for this source, and the pairing assumption needs a way to be told otherwise.

This is the single highest-value thing to find out, because it determines whether the existing
splitter is a foundation or a trap.

---

## The Scrivener mapping

Worth being literal about it, because it predicts which features matter:

| Scrivener | Here |
| --- | --- |
| Binder — hierarchical tree of fragments | Album → song → parts |
| Document | A pass, or a named region of one |
| Synopsis on an index card | A one-line note per take: *"second half is the good bit"* |
| Corkboard — rearrange cards | Reorder parts; `index` on the member |
| Snapshots — versions of a document | Alternate takes of the same part |
| **Compile** | **Export the song to Logic** |
| Never leave the app to write | Audition, mark, name, arrange without a DAW |

The last row is the design constraint worth holding onto. Scrivener works because the whole
fragment-wrangling pass happens in one place and compiling is a discrete act at the end. The
equivalent failure here would be a workflow that sends you to Logic to decide whether a take is any
good.

---

## Suggested order

1. **Show the track count.** Free for library files via `local_audio_info`; a header read per row on
   the device. Without it the list cannot distinguish a song pass from a memo, which is the first
   question this workflow asks.
2. **Collections** — the data model plus a Takes-tab UI to make a song, drop passes and regions into
   it, and order them. Useful on its own, before any export exists.
3. **Local stem splitting** — `export_local_stems` alongside the device one, so a pass can be
   imported first and split later. Reuses the whole of `stems.rs`; the only new part is reading from
   a library path instead of an MTP handle.
4. **Compile to Logic**, with `bext`. After the five-minute Logic check and the channel-count check.
5. **Bars-to-BPM on a region** — `bars × 4 × 60 ÷ duration` makes every exported part grid-ready from
   one number you already know. No DSP.
6. **A one-line note per take.** Where "second half is the good bit" lives — the thing a filename
   can never hold and the thing you want six weeks later.

Steps 2 and 3 are each about the size of the sort-and-rename work already done on the device list.

### Deliberately out

Arbitrary nesting beyond album → song; tag taxonomies and star ratings; automatic tempo or key
detection; any arrangement view (Logic is better at it); writing collections to the device (the TP-7
refuses folders and the field has its own structure — grouping is a Mac-side concept).

### Still open

- **Does a multichannel take audition sensibly?** `window_bytes` returns the original channel count,
  so an 8-channel take reaches Web Audio as 8 channels. Playable, but the routing is unconsidered —
  a track-picker, or a downmix for audition, is probably wanted.
- **Does the field send tape tracks over USB at all, and how many channels?** Assumed from the stated
  workflow, not verified here.
