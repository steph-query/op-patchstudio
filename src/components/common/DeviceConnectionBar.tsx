import { useRef, useState } from 'react';
import { useAppContext } from '../../context/AppContext';
import { isTauriAvailable, mtpConnect, mtpDisconnect, mtpScanPresets, mtpScanTree, mtpListStorages, mtpListAvailable, tp7SwitchToMtp } from '../../utils/tauriBridge';
import type { TauriAvailableDevice, TauriDeviceInfo } from '../../utils/tauriBridge';
import { detectDeviceKind, getDeviceProfile, resolveTabForDevice, TE_USB_VENDOR_ID } from '../../utils/teDevices';
import type { TeDeviceKind } from '../../utils/teDevices';
import { describeError } from '../../utils/describeError';

/** Instructions come from the device profiles so the hints have one definition. */
const SUPPORTED_KINDS: TeDeviceKind[] = ['op-xy', 'op-1-field', 'tp-7'];
import { deviceOperation } from '../../utils/deviceOperation';

export function DeviceConnectionBar() {
  const { state, dispatch } = useAppContext();
  const [available, setAvailable] = useState<TauriAvailableDevice[]>([]);
  const [location, setLocation] = useState('');
  const [message, setMessage] = useState('Connect USB, enable file transfer, then find devices. Close other transfer apps first.');
  const running = useRef(false);
  if (!isTauriAvailable()) return null;

  /**
   * Every action in this bar goes through here, and each one gets its own message.
   *
   * It used to pass none, so the busy banner fell back to "Working… keep the device
   * connected" for connecting, scanning, disconnecting and switching a TP-7 into
   * transfer mode alike — four waits of very different lengths and consequences,
   * described identically.
   */
  async function run(work: () => Promise<void>, message: string) {
    if (running.current) return;
    running.current = true;
    dispatch({ type: 'SET_TAURI_CONNECTING', payload: true });
    try { await deviceOperation(work, { message }); }
    catch (error) {
      setMessage(describeError(error));
      dispatch({ type: 'ADD_NOTIFICATION', payload: { id: crypto.randomUUID(), type: 'error', title: 'device operation failed', message: describeError(error) } });
    } finally { running.current = false; dispatch({ type: 'SET_TAURI_CONNECTING', payload: false }); }
  }

  async function scan(info: Pick<TauriDeviceInfo, 'model' | 'kind'>) {
    const kind = info.kind ?? detectDeviceKind(info.model);
    const [inventory, storages] = await Promise.all([kind === 'op-xy' ? mtpScanPresets() : mtpScanTree(getDeviceProfile(kind).roots), mtpListStorages()]);
    dispatch({ type: 'SET_TAURI_PRESETS', payload: 'presets' in inventory ? inventory.presets : [] });
    dispatch({ type: 'SET_TAURI_PROJECTS', payload: 'projects' in inventory ? inventory.projects : [] });
    dispatch({ type: 'SET_TAURI_SAMPLES', payload: 'standalone_samples' in inventory ? inventory.standalone_samples : [] });
    dispatch({ type: 'SET_TAURI_TREE_ENTRIES', payload: 'entries' in inventory ? inventory.entries : [] });
    dispatch({ type: 'SET_TAURI_STORAGE_INFO', payload: storages[0] ? { freeSpace: storages[0].free_space, capacity: storages[0].capacity } : null });
    const missing = 'missing_roots' in inventory ? inventory.missing_roots : [];
    // Shared, not just announced here: the view for a folder that is not there needs
    // to be able to explain itself, rather than showing an unexplained empty list.
    dispatch({ type: 'SET_TAURI_MISSING_ROOTS', payload: missing });
    setMessage(missing.length ? 'Folders not found: ' + missing.join(', ') + '. Backup requires all library folders.' : 'Library refreshed.');
  }

  async function discover() {
    const devices = (await mtpListAvailable()).filter(device => device.vendor_id === TE_USB_VENDOR_ID && device.kind !== 'unknown');
    setAvailable(devices);
    const ready = devices.filter(device => device.mode === 'mtp' && device.location_id !== 0);
    setLocation(ready.length === 1 ? String(ready[0].location_id) : '');
    // Four states, not two. The old message told people to select a device even when
    // one had just been selected for them, and said nothing useful to the owner of a
    // TP-7 that is on the bus but still in audio mode — the first thing they meet.
    const waiting = devices.filter(device => device.mode !== 'mtp' || device.location_id === 0);
    if (!devices.length) {
      setMessage('No supported devices found. Check USB and the device’s transfer mode.');
    } else if (ready.length === 1) {
      setMessage(`${ready[0].product ?? ready[0].kind} is in file-transfer mode. Connect device to open it.`);
    } else if (ready.length > 1) {
      setMessage(`${ready.length} devices are in file-transfer mode. Choose which one to open.`);
    } else if (waiting.some(device => device.kind === 'tp-7')) {
      setMessage('A TP-7 is attached but still in audio mode. Stop any recording, then use prepare tp-7.');
    } else {
      setMessage('Found a device, but it is not in file-transfer mode yet. Enable it on the device, then find devices again.');
    }
  }

  async function connect() {
    const selected = available.find(device => String(device.location_id) === location && device.mode === 'mtp');
    if (!selected) throw new Error('Find and select a device first.');
    let opened = false;
    try {
      const info = await mtpConnect(selected.location_id);
      opened = true;
      if (selected.serial && info.serial && selected.serial !== info.serial) throw new Error('Device identity changed. Find devices again.');
      await scan(info);
      dispatch({ type: 'SET_TAURI_DEVICE', payload: info });
      dispatch({ type: 'SET_TAB', payload: resolveTabForDevice(state.currentTab, info.kind ?? detectDeviceKind(info.model)) });
    } catch (error) { if (opened) await mtpDisconnect(); throw error; }
  }

  return <section className="connection-panel" aria-label="Device connection">
    <div className="connection-heading"><span>DEVICE DOCK</span><span>{state.tauriDevice ? 'USB session active' : 'Your field system starts here'}</span></div>
    <div className="connection-controls">
      {state.tauriDevice ? <>
        <strong>● {state.tauriDevice.model.toLowerCase()}</strong>
        {state.tauriStorageInfo && <span>{(state.tauriStorageInfo.freeSpace / 1024 ** 3).toFixed(2)} GB free</span>}
        <button disabled={state.tauriConnecting} onClick={() => void run(() => scan(state.tauriDevice!), 'Rescanning the device library. Nothing is being written.')}>refresh device</button>
        <button disabled={state.tauriConnecting} onClick={() => void run(async () => {
          await mtpDisconnect();
          dispatch({ type: 'SET_TAURI_DEVICE', payload: null });
          dispatch({ type: 'SET_TAURI_PRESETS', payload: [] });
          dispatch({ type: 'SET_TAURI_PROJECTS', payload: [] });
          dispatch({ type: 'SET_TAURI_SAMPLES', payload: [] });
          dispatch({ type: 'SET_TAURI_TREE_ENTRIES', payload: [] });
          dispatch({ type: 'SET_TAURI_STORAGE_INFO', payload: null });
          // The same resolver the connect path uses, so the two cannot drift: it keeps
          // you where you are whenever the tab still works without a device.
          dispatch({ type: 'SET_TAB', payload: resolveTabForDevice(state.currentTab, null) });
          setAvailable([]); setLocation(''); setMessage('Disconnected. Find devices to start another session.');
        }, 'Closing the transfer session.')}>disconnect</button>
      </> : <>
        <button disabled={state.tauriConnecting} onClick={() => void run(discover, 'Looking for connected instruments.')}>find devices</button>
        <select aria-label="Select device" value={location} onChange={event => setLocation(event.target.value)} disabled={state.tauriConnecting}>
          <option value="">select device…</option>
          {available.map((device, index) => <option key={String(device.location_id) + '-' + index} disabled={device.mode !== 'mtp' || !device.location_id} value={device.location_id || 'usb-' + index}>{device.product ?? getDeviceProfile(device.kind).label} · {device.serial ?? 'USB ' + device.location_id} {device.mode !== 'mtp' ? '(enable transfer mode)' : ''}</option>)}
        </select>
        <button disabled={!location || state.tauriConnecting} onClick={() => void run(connect, 'Opening a transfer session and reading the library. This can take a moment on a full device.')}>connect device</button>
        <button disabled={state.tauriConnecting} onClick={() => void run(async () => { await tp7SwitchToMtp(); setMessage('TP-7 is switching to transfer mode. Wait a moment, then find devices again.'); setAvailable([]); setLocation(''); }, 'Asking the TP-7 to switch into transfer mode.')}>prepare tp-7</button>
      </>}
    </div>
    <p role="status">{state.tauriConnecting ? 'Working with your device…' : message}</p>
    {!state.tauriDevice && <details><summary>File-transfer instructions</summary>
      <ul>{SUPPORTED_KINDS.map(kind => <li key={kind}>{getDeviceProfile(kind).label}: {getDeviceProfile(kind).transferHint}</li>)}</ul>
      <p>Transfer mode interrupts USB audio/MIDI. One device session is managed at a time.</p></details>}
  </section>;
}
