# OP-PatchStudio: Product Vision

> Historical May 2026 proposal. Firmware has since addressed several complaints below. Use [the September review](op-xy-2026-09-review.md) for current findings and implementation status.
## "The companion app Teenage Engineering should have built."

### Author Context
Written from the perspective of a staff PM who is also an active musician using the OP-XY daily for production and live performance.

---

## The Core Insight

The OP-XY is a brilliant instrument trapped behind terrible content management. Musicians spend hours wrestling with MTP connections, cryptic folder structures, and scattered tools just to get their sounds organized. The device has no on-screen rename, no visual preset browser, and no way to audit what's actually on it without scrolling through a tiny screen.

**OP-PatchStudio should feel like opening Finder for the first time after using DOS.** Everything on your device, visible, organized, and one click away.

---

## User Pain Points (Validated from OP Forums, Elektronauts, Gearspace)

| Pain Point | Severity | Current Workaround |
|---|---|---|
| Can't rename presets/samples on device | Critical | Connect via MTP, manually rename in Finder/Explorer |
| Preset samples clutter the global sample browser | Critical | None — just scroll past hundreds of entries |
| No way to preview what's on the device | High | Scroll through tiny screen, load each preset to hear it |
| 8GB fills up fast, no visibility into what's using space | High | Manual MTP browsing, guesswork |
| Projects reference samples by path — rename breaks them | High | Don't rename anything, ever |
| Creating multisamples requires 24 individual files | High | Manual Ableton export workflow |
| No way to bundle a project with its samples for sharing | High | Manually copy all referenced files |
| Importing preset packs requires manual folder copying | Medium | Field-Kit drag and drop |
| Can't edit patch.json parameters without a text editor | Medium | VSCode + JSON knowledge |
| No backup verification — "did my backup actually work?" | Medium | Hope for the best |

---

## The App Experience

### Philosophy
- **Device-first**: When an OP-XY is connected, every screen is about the device. When disconnected, every screen is about creating content to send to it.
- **Zero cognitive load**: No file paths, no JSON, no folder structures. Just presets, samples, and projects.
- **Musician's mental model**: Think in terms of kits, patches, and sounds — not directories and handles.

---

## Screen-by-Screen UX Plan

### Global: Connection Bar (Always Visible)

```
┌─────────────────────────────────────────────────────────────────┐
│ ● teenage engineering OP-XY  │  147 presets  │  2.1 GB free  │  ⟳ Refresh  │  ⏏ Disconnect │
└─────────────────────────────────────────────────────────────────┘
```

- Persistent bar above all tabs
- Shows: device name, preset count, free space (GB), last sync time
- Refresh button rescans without full reconnect
- Disconnect cleanly releases USB
- When disconnected: `[ Connect OP-XY ]` button with MTP mode instructions
- Subtle green tint when connected, neutral when not

---

### Tab 1: DRUM KIT BUILDER

**Purpose:** Create drum presets from scratch and send them to the device.

**Connected state additions:**
- "Send to Device" button next to "Download Preset" — writes directly via MTP
- Category picker (drum/perc/fx) before sending
- Conflict check: "kick kit already exists. Replace or rename?"
- After sending: toast with "Open on OP-XY: track 1 → shift+1 → scroll to [name]"

**No changes to core workflow** — the drum builder is already excellent. Just wire the output to the device.

---

### Tab 2: MULTISAMPLE BUILDER

**Purpose:** Create multisample/melodic presets and send to device.

**Connected state additions (same pattern as drum):**
- "Send to Device" with category picker (keys/bass/lead/pad/strings/wind/brass)
- Smart category suggestion based on sample content/name
- Conflict detection + resolution

---

### Tab 3: LIBRARY (Dual Purpose — This is the big one)

#### When Disconnected: Local Library
Current behavior — shows presets saved in browser IndexedDB. Users can download ZIPs.

#### When Connected: Device Manager

This is the screen that doesn't exist anywhere else. This is why people will use this app.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────┐
│  [all] [drum] [keys] [bass] [lead] [pad] [strings] [wind] [brass]      │
│  ┌─── Search: [________________]  Sort: [Name ▼]  ── [Grid │ List] ──┐ │
│  │                                                                     │ │
│  │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │ │
│  │  │  🥁 big kit      │  │  🎹 warm keys    │  │  🎹 deep bass    │  │ │
│  │  │  drum · 24 smpls │  │  keys · 8 smpls  │  │  bass · 12 smpls │  │ │
│  │  │  1.2 MB          │  │  890 KB           │  │  2.1 MB          │  │ │
│  │  │  [▶] [✎] [⋯]    │  │  [▶] [✎] [⋯]    │  │  [▶] [✎] [⋯]    │  │ │
│  │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │ │
│  │                                                                     │ │
│  │  ... (card grid or table list view, switchable)                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

**Preset Card (Grid View):**
- Type icon (🥁 drum / 🎹 synth)
- Preset name (large, readable)
- Category tag + sample count
- Total size
- Quick actions: Play first sample, Rename, More (delete, duplicate, export ZIP)

**Preset Row (List/Table View):**
- Same data as current DevicePresetTable but polished
- Expandable to show samples with play buttons
- Inline rename (click name to edit)
- Drag to reorder within category

**Preset Detail Panel (click a preset):**

```
┌─────────────────────────────────────────────────────────┐
│  warm keys                                    [✎ Rename] │
│  Category: keys  │  Type: multisample  │  8 regions     │
│  Total: 890 KB   │  Created: 2025-01-15                  │
│                                                           │
│  SAMPLES                                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │  ▶  warm-c3.wav    │ C3  │ oneshot │ 112 KB       │  │
│  │  ▶  warm-f3.wav    │ F3  │ oneshot │ 98 KB        │  │
│  │  ▶  warm-c4.wav    │ C4  │ oneshot │ 115 KB       │  │
│  │  ... (all samples with key mapping, playmode, size) │  │
│  └────────────────────────────────────────────────────┘  │
│                                                           │
│  PATCH SETTINGS                                           │
│  Engine: poly │ Transpose: 0 │ Volume: 69%               │
│  Envelope: A:0 D:8192 S:32767 R:4096                     │
│                                                           │
│  [Download ZIP]  [Delete from Device]  [Duplicate]        │
└─────────────────────────────────────────────────────────┘
```

**Key Interactions:**
- **Rename**: Click preset name → inline edit → validates OP-XY charset → renames folder + updates patch.json + updates all .xy project references
- **Delete**: Confirmation with "This preset is used in 2 projects" warning
- **Duplicate**: Copy preset with "-copy" suffix
- **Preview**: Play any sample directly from device via MTP streaming
- **Export**: Download as .preset.zip for sharing
- **Bulk select**: Shift+click for range, Cmd+click for multi → bulk delete, bulk export, bulk move category

---

### Tab 4: STORAGE (New — Optional but Valuable)

**Purpose:** "Where is my space going?"

```
┌─────────────────────────────────────────────────────┐
│  DEVICE STORAGE           2.1 GB free / 8.0 GB     │
│  ████████████████████░░░░░░░░  73% used             │
│                                                      │
│  Presets     ██████████████  4.2 GB (287 presets)    │
│  Samples     ████           1.1 GB (89 files)       │
│  Projects    ██             0.6 GB (23 projects)    │
│                                                      │
│  LARGEST PRESETS                                     │
│  1. epic orchestra    │ keys  │ 245 MB │ 24 samples │
│  2. drum mega kit     │ drum  │ 189 MB │ 24 samples │
│  3. deep bass layers  │ bass  │ 156 MB │ 18 samples │
│                                                      │
│  UNUSED SAMPLES (not in any preset)                  │
│  12 orphaned samples using 34 MB  [Clean up]         │
└─────────────────────────────────────────────────────┘
```

This solves the "8GB is not enough, mine is full" pain point. Users can finally see what's eating their storage and clean up intelligently.

---

### Tab 5: PROJECTS (Future — Low Priority)

**Purpose:** View and manage .xy project files. Show which presets/samples each project references. Enable project bundling for sharing (project + all referenced presets/samples as a single archive).

This solves the "projects aren't self-contained" problem. Lower priority because it requires deeper .xy binary parsing which we've already started.

---

## Interaction Principles

### 1. Preview Everything
Every sample on the device should be playable with one click. No "load it onto a track to hear it." This alone is worth the app.

### 2. Safe by Default
- Rename operations check project references before executing
- Delete warns about dependent projects
- Backup reminder on first connect of the day
- Automatic .xy backup before any rename operation

### 3. Feel Native to TE's Design Language
- Lowercase text throughout (TE style)
- Monospace where appropriate
- Minimal color — mostly grayscale with green for "connected/success"
- No gradients, no shadows, no rounded-everything
- Clean grid layouts, generous whitespace
- The app should look like it lives in the same universe as teenage.engineering's website

### 4. Speed Over Polish
- Device scan should complete in < 3 seconds
- Sample preview should start in < 200ms
- Rename should feel instant (optimistic UI + background MTP write)
- No loading spinners for < 500ms operations

---

## Implementation Priority

### Phase A: Make the Library Tab Great (1-2 weeks)
1. Polish DevicePresetTable → grid/list view toggle
2. Preset detail panel with full metadata
3. Inline rename with OP-XY charset validation
4. Sample preview playback from device
5. Delete preset with confirmation
6. Export preset as .zip

### Phase B: Storage Visibility (3-5 days)
1. Storage usage breakdown by category
2. Largest presets list
3. Orphaned sample detection

### Phase C: Seamless Create-to-Device (3-5 days)
1. "Send to Device" on drum/multisample tabs (already started)
2. Category picker with smart suggestions
3. Conflict detection and resolution
4. Post-send navigation hint

### Phase D: Project Intelligence (1-2 weeks)
1. Parse .xy files to show project→preset→sample dependency graph
2. "Which projects use this preset?" query
3. Project bundle export (project + all dependencies)
4. Rename-safe project reference updating

### Phase E: Community Features (Future)
1. Preset pack import (drag a .zip → auto-organize into categories)
2. Preset pack export (select multiple → create shareable bundle)
3. Preset sharing format standard for the community

---

## Success Metric

When a user on OP Forums posts:

> "I just connected my OP-XY to PatchStudio and I can finally SEE everything on my device. I renamed a preset and it updated the project references automatically. I found 200MB of orphaned samples I forgot about. This is what Field-Kit should have been."

That's when we've won.
