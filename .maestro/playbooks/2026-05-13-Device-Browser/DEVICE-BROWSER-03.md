# Phase 3: Device Browser UX Polish

Improve the Device Browser usability with search, sort, bulk operations, and progress indicators.

## Context

The Device Browser feature is functional but bare-bones. Users with many presets (50+) need search/filter. Scanning large devices needs progress feedback. Common operations like renaming multiple presets should be streamlined.

## Implementation

- [ ] **Add search and filter to DeviceTreeView** — Modify `src/components/device/DeviceTreeView.tsx` to add a search input at the top of the tree view. Filter logic: (1) match preset names, sample filenames, and category names case-insensitively, (2) when filtering, auto-expand matching categories and collapse empty ones, (3) highlight matching text in results, (4) debounce input by 200ms to avoid excessive re-renders. Add a type filter dropdown next to search: "All", "Drum", "Multisample", "Samples", "Projects". Use Carbon's `Search` and `Dropdown` components to match the existing design system. Keep filter state local to the component.

- [ ] **Add sort options to DeviceTreeView** — Add a sort toggle/dropdown to the tree view header. Sort options: (1) Name A-Z (default), (2) Name Z-A, (3) Size (largest first), (4) Size (smallest first). Apply sort within each category group independently. For presets, sort by preset name. For samples, sort by filename. For projects, sort by .xy filename. Persist sort preference in a cookie using the same pattern as other user preferences in `AppContext.tsx` (see `getCookieValue`/`setCookieValue` usage).

- [ ] **Add scanning progress indicator** — Modify `src/hooks/useDeviceBrowser.ts` to track scan progress and `src/components/device/DevicePage.tsx` to display it. Add to the hook's state: `scanPhase: 'presets' | 'samples' | 'projects' | null` and `scanProgress: {current: number, total: number} | null`. During `scanPresetsDirectory`, count categories first then report progress per category. During sample/project scanning, report per-file. In DevicePage, replace the simple "Loading..." text with a Carbon `ProgressBar` or `InlineLoading` component showing the current phase and progress fraction (e.g., "Scanning presets... 3/7 categories").

- [ ] **Add bulk rename support** — Add multi-select capability to DeviceTreeView: (1) Shift+click for range select, Cmd/Ctrl+click for toggle select, (2) show selection count in header, (3) when multiple presets/samples are selected, show a "Bulk Rename" button that opens a pattern-based rename modal. The bulk rename modal should support: prefix/suffix addition, find-and-replace within names, and sequential numbering (e.g., "kick-01", "kick-02"). Preview all changes before applying. Apply renames sequentially, updating patch.json and .xy files for each. Show progress and results summary.

- [ ] **Add keyboard navigation to DeviceTreeView** — Implement arrow key navigation: Up/Down to move selection, Left to collapse a group, Right to expand, Enter to select/open detail panel, Space to toggle play/stop audio preview, F2 to trigger rename on selected item. Track a `focusedIndex` in component state. Use `role="tree"` and `role="treeitem"` ARIA attributes with proper `aria-expanded`, `aria-selected`, and `aria-level` for screen reader support.

- [ ] **Write tests for UX enhancements** — Create/extend `src/test/components/DeviceTreeView.test.tsx`. Test: (1) search filters presets by name, (2) type filter shows only matching items, (3) sort orders items correctly, (4) keyboard navigation moves focus correctly, (5) bulk select with shift+click selects range. Run `npm run test && npm run build && npm run lint` to verify all tests pass.
