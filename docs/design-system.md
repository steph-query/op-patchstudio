# Fieldwork visual identity

Fieldwork is an independent studio companion for the field system. The current device integrations are OP-1 Field, OP-XY and TP-7; the branding does not imply support for every field-system product or affiliation with teenage engineering.

## Direction

Warm mineral surfaces, forest-graphite structure, and restrained signal orange. The original stacked-signal mark represents creating, organizing and preserving audio. Device badges indicate the actual connected device, not simultaneous sessions.

The app uses native system sans-serif and monospace fonts, without a remote font dependency. Workspace tabs distinguish Drum lab and Sample lab from device libraries; XY badges clarify builder compatibility when another device is connected.

## Implementation

- `src/theme/device-themes.scss`: device-independent semantic tokens and the Carbon adapter. Existing color aliases remain compatible with the audio editors.
- `src/index.css`: shell, typography, navigation, focus, spacing and shared controls. No style-attribute substring selectors or global text-input width restrictions.
- Media/project styles consume the same tokens; contrast, focus rings and state labels remain visible.
- `public/assets/fieldwork-mark.svg`: small UI mark and favicon.
- `public/assets/fieldwork-icon.svg`: scalable Mac icon source; Tauri generates platform icons.

## Compatibility and attribution

The display name is Fieldwork; the native identifier `com.doxy.app`, binary/package names, IndexedDB/localStorage keys, IPC header names, and backup manifest schema are deliberately unchanged. This avoids stranding existing libraries, backups and app data. The upstream MIT license and project attribution are preserved.

Fieldwork is a working product identity, not a claim of trademark clearance. Future device integrations can extend the shared profiles without introducing another device-specific theme.
