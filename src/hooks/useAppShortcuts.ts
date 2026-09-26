import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';
import { detectDeviceKind, tabsForDevice } from '../utils/teDevices';
import { useDeviceBusy } from '../utils/deviceOperation';
import { isTypingTarget } from '../utils/shortcuts';

/**
 * The app's only global keyboard layer: ⌘1–⌘9 for the tabs and `?` for the list
 * of everything else.
 *
 * Tab numbers come from the same `tabsForDevice` list the tab bar renders, so
 * ⌘3 always means the third tab you can actually see — the tabs change with the
 * connected instrument, and a fixed numbering would point at the wrong panel
 * half the time.
 *
 * Nothing fires while a device operation is in flight: the workspace is inert
 * then, and changing tabs underneath a transfer would hide the thing the user
 * needs to be watching.
 */
export function useAppShortcuts() {
  const { state, dispatch } = useAppContext();
  const busy = useDeviceBusy() || state.tauriConnecting;
  const [helpVisible, setHelpVisible] = useState(false);
  const showHelp = useCallback(() => setHelpVisible(true), []);
  const hideHelp = useCallback(() => setHelpVisible(false), []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (busy) return;

      // ⌘1…⌘9. Ctrl is accepted for keyboards without a command key. Alt is not,
      // because ⌥⌘1 and the like belong to the system and the browser.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && /^[1-9]$/.test(event.key)) {
        const kind = state.tauriDevice ? state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model) : null;
        const tabs = tabsForDevice(kind);
        const target = tabs[Number(event.key) - 1];
        // Out of range: leave the keystroke alone rather than jumping somewhere arbitrary.
        if (!target) return;
        event.preventDefault();
        if (target !== state.currentTab) dispatch({ type: 'SET_TAB', payload: target });
        document.getElementById(target + '-tab')?.focus();
        return;
      }

      // `?` is a plain keystroke, so it must never interrupt typing a name.
      if (event.key === '?' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        setHelpVisible(visible => !visible);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busy, state.tauriDevice, state.currentTab, dispatch]);

  return { helpVisible, showHelp, hideHelp };
}
