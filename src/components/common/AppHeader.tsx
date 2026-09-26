import { useAppContext } from '../../context/AppContext';
import { detectDeviceKind } from '../../utils/teDevices';

export function AppHeader() {
  const { state } = useAppContext();
  const kind = state.tauriDevice ? state.tauriDevice.kind ?? detectDeviceKind(state.tauriDevice.model) : null;
  return <header className="studio-header" role="banner">
    <div className="brand-lockup">
      <img src="/assets/fieldwork-mark.svg" width="44" height="44" alt="" />
      <div><h1>fieldwork<span className="brand-period">.</span></h1><p>A studio companion for the field system</p></div>
    </div>
    <div className="studio-roster" aria-label="Supported devices">
      {([['op-1-field', 'OP–1 FIELD'], ['op-xy', 'OP–XY'], ['tp-7', 'TP–7']] as const).map(([device, label]) =>
        <span key={device} className={'device-badge' + (kind === device ? ' is-connected' : '')}>
          <span className="signal-dot" aria-hidden="true" />{label}{kind === device && <span className="sr-only"> connected</span>}
        </span>)}
      <span className="studio-edition">MAC STUDIO / 01</span>
    </div>
  </header>;
}
