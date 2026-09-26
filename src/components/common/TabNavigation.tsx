import { useAppContext } from '../../context/AppContext';
import { detectDeviceKind, tabLabel, tabsForDevice } from '../../utils/teDevices';
import type { DeviceTab } from '../../utils/teDevices';

interface TabNavigationProps {
  currentTab: DeviceTab;
  onTabChange: (tab: DeviceTab) => void;
}
const symbols: Record<DeviceTab, string> = { drum: '▦', multisample: '≋', takes: '◫', library: '▤', tapes: '◎', recordings: '◉', install: '↥', storage: '▥', projects: '⌘' };
const titles: Record<DeviceTab, string> = { drum: 'Drum lab', multisample: 'Sample lab', takes: 'Takes', library: 'Library', tapes: 'Tapes & albums', recordings: 'Recordings', install: 'Install samples', storage: 'Storage & backup', projects: 'Projects' };

export function TabNavigation({ currentTab, onTabChange }: TabNavigationProps) {
  const { state } = useAppContext();
  const kind = state.tauriDevice ? state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model) : null;
  const availableTabs = tabsForDevice(kind);
  const handleKeyDown = (event: React.KeyboardEvent, tab: DeviceTab) => {
    let next: DeviceTab | undefined;
    const index = availableTabs.indexOf(tab);
    if (event.key === 'Enter' || event.key === ' ') next = tab;
    if (event.key === 'ArrowLeft') next = availableTabs[(index - 1 + availableTabs.length) % availableTabs.length];
    if (event.key === 'ArrowRight') next = availableTabs[(index + 1) % availableTabs.length];
    if (event.key === 'Home') next = availableTabs[0];
    if (event.key === 'End') next = availableTabs[availableTabs.length - 1];
    if (next) { event.preventDefault(); onTabChange(next); document.getElementById(next + '-tab')?.focus(); }
  };
  return <div role="tablist" aria-label="main navigation tabs" aria-orientation="horizontal" className="tab-bar">
    {availableTabs.map((tab, index) => <button className="studio-tab" key={tab} id={tab + '-tab'} role="tab"
      aria-selected={currentTab === tab} aria-controls={tab + '-tabpanel'}
      aria-label={tabLabel(tab, kind) + ' tab'} tabIndex={currentTab === tab ? 0 : -1}
      onClick={() => onTabChange(tab)} onKeyDown={event => handleKeyDown(event, tab)}>
      <span className="tab-symbol" aria-hidden="true">{symbols[tab]}</span>
      <span>{tab === 'library' && kind === 'op-1-field' ? 'Patch library' : titles[tab]}</span>
      {kind && kind !== 'op-xy' && (tab === 'drum' || tab === 'multisample') && <small>XY</small>}
      <kbd className="tab-key" aria-hidden="true">⌘{index + 1}</kbd>
    </button>)}
  </div>;
}
