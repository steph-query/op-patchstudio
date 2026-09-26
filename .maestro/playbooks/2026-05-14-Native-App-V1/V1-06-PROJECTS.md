# Phase 5: Project Intelligence

Parse .xy project files to show preset/sample dependencies, enable safe renames that update project references, and support project bundling for sharing.

## Project Scanning

- [ ] **Add `mtp_scan_projects` Tauri command** — In `src-tauri/src/main.rs`, create a command that: (1) navigates to `projects/user/`, (2) lists all .xy files, (3) for each .xy file, downloads it and uses the existing `parseXyPaths()` logic (port from TypeScript to Rust, or download the bytes and parse in TypeScript). Return `Vec<DeviceProject>` where each project has: `handle: u32`, `name: String`, `size: u64`, `referenced_presets: Vec<String>` (extracted preset paths), `referenced_samples: Vec<String>` (extracted sample paths). Add `mtpScanProjects()` to tauriBridge.ts. Add `tauriProjects` to AppContext state.

- [ ] **Add Projects tab** — Add `'projects'` to the tab union type in AppContext. Create `src/components/projects/ProjectsPage.tsx`. Only visible when device is connected. Show a table of projects with columns: name, size, # preset references, # sample references. Click a project to expand and see all referenced paths grouped by type (preset-sample, standalone-sample, content, short-ref).

## Dependency-Aware Rename

- [ ] **Add project reference updating to rename flow** — When renaming a preset in the Library tab, after the MTP rename completes: (1) scan all projects for references to the old preset path, (2) show the user which projects will be updated ("this preset is referenced in 3 projects: [list]"), (3) on confirmation: for each affected project, download the .xy binary, run `applyXyRename()` (the pure function from deviceXyParser.ts) to replace old paths with new paths, create a backup of the original .xy file, upload the modified .xy file back to the device. (4) Show results: "updated 3 projects, created 3 backups in projects/user/backups/". This is the killer feature — no other tool can do project-safe renames.

## Project Bundle Export

- [ ] **Add "export project bundle" feature** — In the Projects tab, add an "export bundle" button per project. When clicked: (1) download the .xy file, (2) parse its path references, (3) download all referenced preset folders (patch.json + samples) and standalone samples, (4) bundle everything into a ZIP with the structure: `{project-name}/project.xy`, `{project-name}/presets/{category}/{preset}.preset/...`, `{project-name}/samples/user/...`. This creates a self-contained, shareable project archive. Use JSZip to build the ZIP and trigger browser download.

## Tests and Verification

- [ ] **Write tests and verify** — Test `parseXyPaths()` with real .xy data patterns (reuse logic from existing deviceXyParser.test.ts). Test project scanning result parsing. Test the rename + project update flow end-to-end with mock data. Run `npm run test && npm run build && cd src-tauri && cargo build`.
