/**
 * Every keyboard shortcut in the app, in one place, so the help sheet cannot
 * drift from what the code actually does.
 *
 * The app grew a lot of keyboard support in components that each owned their own
 * listener, which meant none of it was discoverable: the take auditioner marks
 * in and out with `i` and `o`, the drum keyboard plays pads from the home row,
 * the takes list walks with arrows — and nothing said so. This table is the
 * discovery surface for all of it, and each entry names where it applies,
 * because a shortcut that works in one panel and not another is worse than none
 * when you cannot tell which is which.
 *
 * Adding a shortcut to a component means adding it here too. Anything listed
 * here that is not real is a bug in this file.
 */
export interface Shortcut {
  /** Keys as they should be read, e.g. `['⌘1', '…', '⌘9']` or `['i']`. */
  keys: string[];
  /** What pressing it does, in the user's words. */
  does: string;
}

export interface ShortcutGroup {
  /** Where these apply — a panel name, or "Anywhere". */
  where: string;
  shortcuts: Shortcut[];
}

export const SHORTCUTS: ShortcutGroup[] = [
  {
    where: 'Anywhere',
    shortcuts: [
      { keys: ['⌘1', 'to', '⌘9'], does: 'Go to a tab, counting from the left. The number is shown on each tab.' },
      { keys: ['?'], does: 'Show this list.' },
      { keys: ['esc'], does: 'Close what is open — this list, an open preset, a zoomed waveform, a rename in progress — or leave a search field.' },
    ],
  },
  {
    where: 'Tabs',
    shortcuts: [
      { keys: ['←', '→'], does: 'Move between tabs.' },
      { keys: ['home', 'end'], does: 'Jump to the first or last tab.' },
    ],
  },
  {
    where: 'Takes list',
    shortcuts: [
      { keys: ['↑', '↓'], does: 'Walk the list. The list is one tab stop, so one Tab reaches it.' },
      { keys: ['home', 'end'], does: 'Jump to the first or last take.' },
      { keys: ['space'], does: 'Open a take for audition, or close it again.' },
    ],
  },
  {
    where: 'Auditioning a take',
    shortcuts: [
      { keys: ['space'], does: 'Play from the playhead, or stop.' },
      { keys: ['i'], does: 'Mark the start of a region at the playhead.' },
      { keys: ['o'], does: 'Mark the end of a region at the playhead.' },
    ],
  },
  {
    where: 'Drum lab',
    shortcuts: [
      { keys: ['a', 's', 'd', 'f', 'g', 'h', 'j'], does: 'Play the seven pads along the home row.' },
      { keys: ['w', 'e', 'r', 'y', 'u'], does: 'Play the five pads above it.' },
      { keys: ['z', 'x'], does: 'Switch between the two banks of twelve pads.' },
    ],
  },
  {
    where: 'Zoomed waveform',
    shortcuts: [
      { keys: ['p'], does: 'Hold to play what is in view; it stops when you let go.' },
    ],
  },
];

/** Total number of shortcuts listed — used by the help sheet's summary line. */
export function shortcutCount(groups: ShortcutGroup[] = SHORTCUTS): number {
  return groups.reduce((total, group) => total + group.shortcuts.length, 0);
}

/**
 * Whether a keystroke arrived while the user was typing, in which case a
 * single-letter shortcut must not steal it.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  // The attribute as well as the property: `isContentEditable` is computed by the
  // browser and is not implemented everywhere, and a shortcut that eats a
  // keystroke in a rich text field is a bug the user cannot work around.
  if (target.isContentEditable) return true;
  const editable = target.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}
