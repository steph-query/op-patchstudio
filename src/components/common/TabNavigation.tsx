import { useAppContext } from '../../context/AppContext';
import { detectDeviceKind, tabLabel, tabGroups, tabsForDevice } from '../../utils/teDevices';
import type { DeviceTab } from '../../utils/teDevices';

interface TabNavigationProps {
  currentTab: DeviceTab;
  onTabChange: (tab: DeviceTab) => void;
  /** Opens the shortcut sheet. It lives in the nav footer, beside what it describes. */
  onShowShortcuts?: () => void;
}
const symbols: Record<DeviceTab, string> = { drum: '▦', multisample: '≋', takes: '◫', songs: '❖', library: '▤', tapes: '◎', recordings: '◉', install: '↥', storage: '▥', projects: '⌘' };
const titles: Record<DeviceTab, string> = { drum: 'Drum lab', multisample: 'Sample lab', takes: 'Takes', songs: 'Songs', library: 'Library', tapes: 'Tapes & albums', recordings: 'Recordings', install: 'Install samples', storage: 'Storage & backup', projects: 'Projects' };

/**
 * The app's navigation, as a sidebar of two named sections.
 *
 * It was a horizontal strip of tabs across the top, which read as *views of one screen*
 * rather than *places to go* — and with a TP-7 attached the first two were an OP-XY drum
 * builder and sample builder, each wearing an `(op-xy)` badge to explain why it was
 * there. Navigation that has to apologise for itself is in the wrong shape.
 *
 * Sections come from `tabGroups`: what is on the attached instrument, then the workbench
 * that works with nothing plugged in. The device section is named after the device, so
 * connecting a TP-7 puts a section headed **tp-7** at the top holding only TP-7 screens.
 *
 * **Two tablists rather than one.** A `tablist` may only own `tab` children, so a single
 * one could not carry the section headings. Each section is therefore its own tablist
 * labelled by its heading: arrow keys move within a section, Tab moves between them,
 * which is also the more useful division. Each tablist keeps one tabbable entry — the
 * selected screen if it lives there, otherwise its first — so no section can become
 * unreachable by keyboard when the selection is in the other one.
 */
export function TabNavigation({ currentTab, onTabChange, onShowShortcuts }: TabNavigationProps) {
  const { state } = useAppContext();
  const kind = state.tauriDevice ? state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model) : null;
  const groups = tabGroups(kind);
  // ⌘ numbers count the whole sidebar top to bottom, matching the flattened order that
  // `useAppShortcuts` indexes, so the number shown on a screen is the one that reaches it.
  const ordered = tabsForDevice(kind);

  const handleKeyDown = (event: React.KeyboardEvent, tab: DeviceTab, within: DeviceTab[]) => {
    let next: DeviceTab | undefined;
    const index = within.indexOf(tab);
    if (event.key === 'Enter' || event.key === ' ') next = tab;
    // Up/Down are the vertical pair; Left/Right still work for anyone who learned them
    // when this was a horizontal strip.
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = within[(index - 1 + within.length) % within.length];
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = within[(index + 1) % within.length];
    if (event.key === 'Home') next = within[0];
    if (event.key === 'End') next = within[within.length - 1];
    if (next) { event.preventDefault(); onTabChange(next); document.getElementById(next + '-tab')?.focus(); }
  };

  return <nav className="studio-nav" aria-label="Main">
    {groups.map(group => {
      const headingId = 'nav-section-' + group.key;
      // The selected screen if it is in this section, otherwise this section's first —
      // so Tab always reaches every section.
      const tabbable = group.tabs.includes(currentTab) ? currentTab : group.tabs[0];
      return <div className="nav-section" key={group.key}>
        <h2 className="nav-section-title" id={headingId}>{group.label}</h2>
        <div role="tablist" aria-labelledby={headingId} aria-orientation="vertical" className="nav-list">
          {group.tabs.map(tab => <button className="studio-tab" key={tab} id={tab + '-tab'} role="tab"
            aria-selected={currentTab === tab} aria-controls={tab + '-tabpanel'}
            aria-label={tabLabel(tab, kind) + ' tab'} tabIndex={tab === tabbable ? 0 : -1}
            onClick={() => onTabChange(tab)} onKeyDown={event => handleKeyDown(event, tab, group.tabs)}>
            <span className="tab-symbol" aria-hidden="true">{symbols[tab]}</span>
            <span className="tab-title">{tab === 'library' && kind === 'op-1-field' ? 'Patch library' : titles[tab]}</span>
            <kbd className="tab-key" aria-hidden="true">⌘{ordered.indexOf(tab) + 1}</kbd>
          </button>)}
        </div>
      </div>;
    })}
    {!kind && <p className="nav-hint">Nothing connected. These screens all work offline — plug in an instrument to see what is on it.</p>}
    {onShowShortcuts && <button className="shortcut-hint" onClick={onShowShortcuts} aria-label="keyboard shortcuts">? shortcuts</button>}
  </nav>;
}
