import { useAppContext } from '../../context/AppContext';
import { detectDeviceKind, getDeviceProfile } from '../../utils/teDevices';

// A dated research snapshot, not a live update check or a compatibility certification.
export function FirmwareNotice() {
  const { state } = useAppContext();
  if (!state.tauriDevice) return null;
  const kind = state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model);
  const profile = getDeviceProfile(kind);
  const firmware = profile.firmware;
  if (!firmware) return null;
  return (
    <details className="firmware-notice">
      <summary>{profile.label} firmware <strong>{firmware.latest}</strong><span>checked {firmware.checked}</span></summary>
      <div>
        <p>Device-reported version: <strong>{state.tauriDevice.firmware || 'unavailable'}</strong>. Latest researched release: {firmware.latest} ({firmware.released}).</p>
        <p>{firmware.notes}</p>
        <p>Make a verified backup before updating or reorganising device content.</p>
        <a href={firmware.url} target="_blank" rel="noreferrer">Official releases and update instructions ↗</a>
      </div>
    </details>
  );
}
