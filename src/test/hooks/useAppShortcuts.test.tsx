import { renderHook, act, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppShortcuts } from '../../hooks/useAppShortcuts';
import { useDeviceBusy } from '../../utils/deviceOperation';
import { tabsForDevice } from '../../utils/teDevices';

vi.mock('../../utils/deviceOperation', () => ({ useDeviceBusy: vi.fn(() => false) }));

const dispatch = vi.fn();
const state: {
  currentTab: string;
  tauriDevice: { model: string; serial: string; kind?: string } | null;
  tauriConnecting: boolean;
} = { currentTab: 'drum', tauriDevice: null, tauriConnecting: false };
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch }) }));

function press(key: string, modifiers: Partial<KeyboardEventInit> = {}, target: Element = document.body) {
  fireEvent.keyDown(target, { key, ...modifiers });
}
function tabsSet() {
  return dispatch.mock.calls.map(([action]) => action).filter(action => action.type === 'SET_TAB').map(action => action.payload);
}

describe('useAppShortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useDeviceBusy).mockReturnValue(false);
    state.currentTab = 'drum';
    state.tauriDevice = null;
    state.tauriConnecting = false;
    document.body.innerHTML = '';
  });

  it('numbers the tabs that are actually on screen, left to right', () => {
    renderHook(() => useAppShortcuts());
    // Nothing connected: drum, multisample, takes, library, projects.
    expect(tabsForDevice(null)).toEqual(['drum', 'multisample', 'takes', 'library', 'projects']);
    press('3', { metaKey: true });
    press('5', { metaKey: true });
    expect(tabsSet()).toEqual(['takes', 'projects']);
  });

  it('follows the connected instrument, whose tabs are a different list', () => {
    state.tauriDevice = { model: 'TP-7 MTP Device', serial: 'TP-1' };
    renderHook(() => useAppShortcuts());
    expect(tabsForDevice('tp-7')).toEqual(['drum', 'multisample', 'takes', 'recordings', 'install', 'storage']);

    // ⌘4 is the library unplugged and the recorder's own files with a TP-7 attached,
    // and ⌘6 does not exist unplugged at all. Numbering the visible list is what
    // keeps the key pointing at the tab the user is looking at.
    press('4', { metaKey: true });
    press('6', { metaKey: true });
    expect(tabsSet()).toEqual(['recordings', 'storage']);
  });

  it('leaves a number with no tab alone rather than jumping somewhere arbitrary', () => {
    renderHook(() => useAppShortcuts());
    press('9', { metaKey: true });
    expect(tabsSet()).toEqual([]);
  });

  it('does not re-dispatch the tab already showing, but still moves focus to it', () => {
    const button = document.createElement('button');
    button.id = 'drum-tab';
    document.body.append(button);
    renderHook(() => useAppShortcuts());
    press('1', { metaKey: true });
    expect(tabsSet()).toEqual([]);
    expect(document.activeElement).toBe(button);
  });

  it('accepts ctrl for keyboards without a command key, and ignores alt combinations', () => {
    renderHook(() => useAppShortcuts());
    press('2', { ctrlKey: true });
    expect(tabsSet()).toEqual(['multisample']);
    // ⌥⌘1 and friends belong to the system and the browser.
    press('3', { metaKey: true, altKey: true });
    expect(tabsSet()).toEqual(['multisample']);
  });

  it('switches tabs even from inside a text field, as a command chord should', () => {
    const input = document.createElement('input');
    document.body.append(input);
    renderHook(() => useAppShortcuts());
    press('2', { metaKey: true }, input);
    expect(tabsSet()).toEqual(['multisample']);
  });

  it('opens and closes the shortcut list with ?', () => {
    const { result } = renderHook(() => useAppShortcuts());
    expect(result.current.helpVisible).toBe(false);
    act(() => press('?'));
    expect(result.current.helpVisible).toBe(true);
    act(() => press('?'));
    expect(result.current.helpVisible).toBe(false);
  });

  it('never steals ? from someone naming a preset', () => {
    const input = document.createElement('input');
    document.body.append(input);
    const textarea = document.createElement('textarea');
    document.body.append(textarea);
    const { result } = renderHook(() => useAppShortcuts());

    act(() => press('?', {}, input));
    expect(result.current.helpVisible).toBe(false);
    act(() => press('?', {}, textarea));
    expect(result.current.helpVisible).toBe(false);
  });

  it('stays quiet during a transfer, when the workspace is inert anyway', () => {
    vi.mocked(useDeviceBusy).mockReturnValue(true);
    const { result } = renderHook(() => useAppShortcuts());
    press('3', { metaKey: true });
    act(() => press('?'));
    expect(tabsSet()).toEqual([]);
    expect(result.current.helpVisible).toBe(false);
  });

  it('stays quiet while connecting, too', () => {
    state.tauriConnecting = true;
    renderHook(() => useAppShortcuts());
    press('3', { metaKey: true });
    expect(tabsSet()).toEqual([]);
  });

  it('stops listening once unmounted', () => {
    const { unmount } = renderHook(() => useAppShortcuts());
    unmount();
    press('3', { metaKey: true });
    expect(tabsSet()).toEqual([]);
  });
});
