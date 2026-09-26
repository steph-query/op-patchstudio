import { useState, useCallback, useEffect } from 'react';
import { useAppContext } from '../../context/AppContext';
import { DrumTool } from '../drum/DrumTool';
import { MultisampleTool } from '../multisample/MultisampleTool';
import { LibraryPage } from '../library/LibraryPage';
import { DevicePresetTable } from '../device/DevicePresetTable';
import { DevicePresetDetail } from '../device/DevicePresetDetail';
import { TabNavigation } from './TabNavigation';
import { DeviceConnectionBar } from './DeviceConnectionBar';
import { StoragePage } from '../storage/StoragePage';
import { FirmwareNotice } from './FirmwareNotice';
import { ProjectsPage } from '../projects/ProjectsPage';
import { mtpScanPresets, mtpCopyPreset } from '../../utils/tauriBridge';
import type { TauriDevicePreset } from '../../utils/tauriBridge';
import { detectDeviceKind } from '../../utils/teDevices';
import type { DeviceTab } from '../../utils/teDevices';
import { DeviceMediaPage } from '../device/DeviceMediaPage';
import { SampleInstallPanel } from '../device/SampleInstallPanel';
import { TapeAssembly } from '../device/TapeAssembly';
import { CaptureLibraryPanel } from '../library/CaptureLibraryPanel';
import { useDeviceBusy, useDeviceOperationOptions, deviceOperation } from '../../utils/deviceOperation';
import { describeError } from '../../utils/describeError';
import { useAppShortcuts } from '../../hooks/useAppShortcuts';
import { KeyboardHelp } from './KeyboardHelp';

export function MainTabs() {
  const { state, dispatch } = useAppContext();
  const [selectedPreset, setSelectedPreset] = useState<TauriDevicePreset | null>(null);
  const busy = useDeviceBusy() || state.tauriConnecting;
  const { helpVisible, showHelp, hideHelp } = useAppShortcuts();
  const operation = useDeviceOperationOptions();
  useEffect(() => { setSelectedPreset(null); }, [state.tauriDevice]);
  useEffect(() => { setSelectedPreset(previous => previous ? state.tauriPresets.find(preset => preset.id === previous.id) ?? null : null); }, [state.tauriPresets]);

  const handleTabChange = (tabName: DeviceTab) => {
    dispatch({ type: 'SET_TAB', payload: tabName });
  };

  const handleSelectPreset = useCallback((preset: TauriDevicePreset) => {
    setSelectedPreset(prev => prev?.id === preset.id ? prev : preset);
  }, []);


  const handleCopyPreset = useCallback(async (preset: TauriDevicePreset, newName: string) => {
    const newHandle = await mtpCopyPreset(preset.folder_handle, newName);
    const scanResult = await mtpScanPresets();
    dispatch({ type: 'SET_TAURI_PRESETS', payload: scanResult.presets });
    dispatch({ type: 'SET_TAURI_PROJECTS', payload: scanResult.projects });
    dispatch({ type: 'SET_TAURI_SAMPLES', payload: scanResult.standalone_samples });
    setSelectedPreset(scanResult.presets.find(p => p.folder_handle === newHandle) ?? null);
    dispatch({ type: 'ADD_NOTIFICATION', payload: { id: crypto.randomUUID(), type: 'success', title: 'preset copied', message: `${newName} created and verified. Original preset and projects preserved.` } });
  }, [dispatch]);

  const tabPanelStyle = {
    background: 'var(--color-surface-primary)',
    borderRadius: '0 0 var(--radius-panel) var(--radius-panel)',
    border: '1px solid var(--color-border-subtle)',
    borderTop: 'none',
    minHeight: '500px',
    overflow: 'hidden'
  };
  const deviceKind = state.tauriDevice ? (state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model)) : null;

  return (
    <div
      role="tabpanel"
      aria-label="main application content"
      aria-busy={busy}
      style={{ marginBottom: '2rem', position: 'relative' }}
    >
      {busy && <div className="device-busy" role="status" aria-live="polite">{operation?.message ?? 'Working… keep the device connected.'}{operation?.cancel && <button onClick={() => void operation.cancel?.().catch(error => dispatch({ type: 'ADD_NOTIFICATION', payload: { id: crypto.randomUUID(), type: 'error', title: 'Cancel failed', message: describeError(error) } }))}>{operation.cancelLabel ?? 'Cancel'}</button>}</div>}
      <div className="studio-workspace" inert={busy || undefined}>
      <DeviceConnectionBar />
      <FirmwareNotice />
      <div className="shortcut-hint-row">
        <button className="shortcut-hint" onClick={showHelp} aria-label="keyboard shortcuts">? shortcuts</button>
      </div>
      <TabNavigation currentTab={state.currentTab} onTabChange={handleTabChange} />
      <KeyboardHelp open={helpVisible} onClose={hideHelp} />

      {state.currentTab === 'drum' && (
        <div role="tabpanel" id="drum-tabpanel" aria-labelledby="drum-tab" aria-label="drum tool content" style={tabPanelStyle}>
          <DrumTool />
        </div>
      )}

      {state.currentTab === 'multisample' && (
        <div role="tabpanel" id="multisample-tabpanel" aria-labelledby="multisample-tab" aria-label="multisample tool content" style={tabPanelStyle}>
          <MultisampleTool />
        </div>
      )}

      {state.currentTab === 'library' && (
        <div role="tabpanel" id="library-tabpanel" aria-labelledby="library-tab" aria-label="preset library content" style={tabPanelStyle}>
          {state.tauriDevice && deviceKind === 'op-xy' ? (
            <div style={{ display: 'flex', height: '100%', minHeight: '500px' }}>
              <div style={{ flex: 1, overflowY: 'auto', borderRight: selectedPreset ? '1px solid #e0e0e0' : 'none' }}>
                <DevicePresetTable
                  presets={state.tauriPresets}
                  onSelectPreset={handleSelectPreset}
                  selectedPresetId={selectedPreset?.id ?? null}
                />
              </div>
              {selectedPreset && (
                <div style={{ width: '360px', minWidth: '320px', overflowY: 'auto', background: 'var(--color-surface-primary)' }}>
                  <DevicePresetDetail
                    preset={selectedPreset}
                    onClose={() => setSelectedPreset(null)}
                    onCopy={(preset, name) => deviceOperation(() => handleCopyPreset(preset, name), { message: `Copying ${preset.name} to ${name} on the device. Nothing already there is replaced. Keep the device connected.` })}
                  />
                </div>
              )}
            </div>
          ) : state.tauriDevice && deviceKind === 'op-1-field' ? (
            <DeviceMediaPage mode="patches" />
          ) : (
            <LibraryPage />
          )}
        </div>
      )}

      {state.currentTab === 'tapes' && (
        <div role="tabpanel" id="tapes-tabpanel" aria-labelledby="tapes-tab" aria-label="OP-1 tape library" style={tabPanelStyle}>
          <DeviceMediaPage mode="tapes" />
          <TapeAssembly />
        </div>
      )}

      {state.currentTab === 'recordings' && (
        <div role="tabpanel" id="recordings-tabpanel" aria-labelledby="recordings-tab" aria-label="TP-7 recordings" style={tabPanelStyle}><DeviceMediaPage mode="recordings" /></div>
      )}

      {state.currentTab === 'takes' && (
        <div role="tabpanel" id="takes-tabpanel" aria-labelledby="takes-tab" aria-label="local library of imported takes" style={tabPanelStyle}><CaptureLibraryPanel /></div>
      )}

      {state.currentTab === 'install' && (
        <div role="tabpanel" id="install-tabpanel" aria-labelledby="install-tab" aria-label="install samples on the device" style={tabPanelStyle}><SampleInstallPanel /></div>
      )}

      {state.currentTab === 'storage' && state.tauriDevice && (
        <div role="tabpanel" id="storage-tabpanel" aria-labelledby="storage-tab" aria-label="device storage" style={tabPanelStyle}>
          <StoragePage />
        </div>
      )}

      {state.currentTab === 'projects' && (
        <div role="tabpanel" id="projects-tabpanel" aria-labelledby="projects-tab" aria-label="device projects" style={tabPanelStyle}>
          <ProjectsPage />
        </div>
      )}
      </div>
    </div>
  );
}
