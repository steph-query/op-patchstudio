# Phase 6: TE Design Language Polish

Apply Teenage Engineering's design aesthetic throughout the app. The goal: "it looks like TE made it."

## Typography and Color

- [ ] **Establish TE-style CSS variables and typography** — Create `src/theme/te-design-system.css` (or update existing theme files). TE's aesthetic: (1) all lowercase text, (2) monospace font for numbers and technical data (use `'SF Mono', 'Fira Code', 'Consolas', monospace`), (3) primary font: clean sans-serif like the existing Montserrat but lighter weights, (4) color palette: mostly grayscale — `#000` for primary text, `#666` for secondary, `#999` for tertiary, `#e5e5e5` for borders, `#f5f5f5` for backgrounds, `#fff` for cards. Only accent color: `#24a148` green for "connected/active/playing" states. No blue, no purple, no gradients. (5) Border radius: 0px for most elements (TE uses sharp corners), 2-3px max for buttons. (6) No box shadows — use borders only. Apply these to all device-related components first (DeviceConnectionBar, DevicePresetTable, DevicePresetDetail, StoragePage, ProjectsPage). Keep the existing drum/multisample builder styling as-is for now — they have their own established look.

## Layout and Spacing

- [ ] **Apply TE grid and spacing patterns** — TE uses generous whitespace and alignment. Update the connection bar to use a clean grid with consistent 16px padding. Update the preset table to use tighter row spacing (36px rows instead of 48px) with more breathing room between columns. Update category filter tabs to use a minimal style: no background, just bottom border on active tab (2px solid black). Remove all emoji from the preset table — replace type indicators with minimal text labels or small monochrome SVG icons. Format all file sizes in monospace. Format all counts in monospace. Ensure consistent alignment across all table columns.

## App Chrome

- [ ] **Update app title bar and overall layout** — Remove the "unofficial" badge from the header or make it more subtle (smaller, lighter). Update the header typography to match TE's website style. Ensure the tab bar uses TE-style minimal tabs: no rounded corners, no background color differences — just an underline or weight change for active tab. The overall app should feel like a tool, not a colorful web app. Review each screen and remove any element that feels "web-appy" — hover color changes should be subtle (gray shift, not color change), buttons should be minimal and functional.

- [ ] **Verify visual consistency** — Launch `cargo tauri dev`, connect the OP-XY, and visually review every screen. Ensure consistent typography, spacing, and color usage. Take screenshots for documentation. Run `npm run test && npm run build`.
