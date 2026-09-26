import { renderHook, act, render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConfirmedSend } from '../../hooks/useConfirmedSend';
import { SendReview } from '../../components/common/SendReview';
import { catalogRecordTransfer, completePresetSend, mtpScanPresets, mtpUploadPreset, preflightPresetSend, reconcilePresetSend } from '../../utils/tauriBridge';

vi.mock('../../utils/tauriBridge', () => ({
  mtpUploadPreset: vi.fn(),
  mtpScanPresets: vi.fn(),
  catalogRecordTransfer: vi.fn(),
  preflightPresetSend: vi.fn(),
  reconcilePresetSend: vi.fn(),
  completePresetSend: vi.fn(),
}));

const plan = {
  token: 'plan-token',
  device_model: 'OP-XY',
  device_serial: 'XY-1',
  destination: 'presets/drum/field kit.preset',
  files: 2,
  bytes: 2560,
  free_space: 4_000_000_000,
  creates_category: false,
};

const dispatch = vi.fn();
const state: { tauriDevice: { model: string; serial: string } | null } = { tauriDevice: { model: 'OP-XY', serial: 'XY-1' } };
vi.mock('../../context/AppContext', () => ({ useAppContext: () => ({ state, dispatch }) }));

const files = [
  { name: 'patch.json', data: new Uint8Array(512) },
  { name: 'kick.wav', data: new Uint8Array(2048) },
];
const described = { name: 'field kit', category: 'drum', files, format: '44.1 khz · 16-bit · mono · .wav' };

function notices() {
  return dispatch.mock.calls.map(([action]) => action).filter(action => action.type === 'ADD_NOTIFICATION').map(action => action.payload);
}

function connectedOpXy() {
  vi.clearAllMocks();
  state.tauriDevice = { model: 'OP-XY', serial: 'XY-1' };
  vi.mocked(mtpUploadPreset).mockResolvedValue(1);
  vi.mocked(preflightPresetSend).mockResolvedValue(plan);
  vi.mocked(mtpScanPresets).mockResolvedValue({ presets: [], standalone_samples: [], projects: [] });
  vi.mocked(catalogRecordTransfer).mockResolvedValue({
    id: 't1', sent_unix: 1, device_model: 'OP-XY', device_serial: 'XY-1', destination: 'presets/drum',
    name: 'field kit', files: [], outcome: 'verified', error: null, source_asset_id: null, source_region: null,
  });
}

describe('useConfirmedSend', () => {
  beforeEach(connectedOpXy);

  it('writes nothing until the review is confirmed', async () => {
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });

    expect(result.current.pending?.name).toBe('field kit');
    expect(result.current.pending?.totalBytes).toBe(2560);
    expect(result.current.pending?.deviceSerial).toBe('XY-1');
    expect(mtpUploadPreset).not.toHaveBeenCalled();
  });

  it('cancelling leaves the device untouched', async () => {
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    act(() => result.current.cancel());

    expect(result.current.pending).toBeNull();
    expect(mtpUploadPreset).not.toHaveBeenCalled();
    expect(catalogRecordTransfer).not.toHaveBeenCalled();
  });

  it('writes once on confirm and records a verified transfer', async () => {
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.confirm(); });

    expect(mtpUploadPreset).toHaveBeenCalledWith('drum', 'field kit', files, 'plan-token');
    expect(mtpScanPresets).toHaveBeenCalled();
    expect(catalogRecordTransfer).toHaveBeenCalledWith(expect.objectContaining({
      device_model: 'OP-XY',
      device_serial: 'XY-1',
      destination: 'presets/drum',
      name: 'field kit',
      outcome: 'verified',
      files: [{ path: 'patch.json', bytes: 512 }, { path: 'kick.wav', bytes: 2048 }],
    }));
    expect(notices()[0].title).toBe('sent and verified');
    expect(result.current.pending).toBeNull();
  });

  it('records a failure as a failure and keeps the review open', async () => {
    vi.mocked(mtpUploadPreset).mockRejectedValue(new Error('A preset with this name already exists'));
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.confirm(); });

    expect(catalogRecordTransfer).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', error: expect.stringContaining('already exists') }));
    const notice = notices()[0];
    expect(notice.type).toBe('error');
    expect(notice.message).toContain('Nothing already on the device was replaced');
    expect(notices().some(item => item.title === 'sent and verified')).toBe(false);
    expect(result.current.pending).not.toBeNull();
  });

  it('a history write that fails does not turn a good send into an error', async () => {
    vi.mocked(catalogRecordTransfer).mockRejectedValue(new Error('Open your library first.'));
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.confirm(); });

    expect(notices()[0].title).toBe('sent and verified');
    expect(notices().every(item => item.type === 'success')).toBe(true);
  });

  it('refuses without an OP-XY rather than preparing a write', async () => {
    state.tauriDevice = { model: 'TP-7 MTP Device', serial: 'TP-1' };
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    expect(result.current.pending).toBeNull();
    expect(notices()[0].message).toContain('Connect an OP-XY');

    state.tauriDevice = null;
    await act(async () => { result.current.request(async () => described); });
    expect(result.current.pending).toBeNull();
  });

  it('refuses an empty preset instead of creating an empty folder', async () => {
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => ({ ...described, files: [] })); });
    expect(result.current.pending).toBeNull();
    expect(notices()[0].title).toBe('nothing to send');
  });
});

describe('useConfirmedSend — checking the device after a failure', () => {
  beforeEach(connectedOpXy);

  const report = {
    destination: 'presets/drum/field kit.preset',
    folder_exists: true,
    files: [
      { name: 'patch.json', status: 'absent', device_bytes: null },
      { name: 'kick.wav', status: 'identical', device_bytes: 2048 },
    ],
    extra: [],
    identical: 1,
    different: 0,
    absent: 1,
    verdict: 'can complete',
    explanation: '1 file(s) already match and 1 are missing. Only the missing files would be written; nothing existing is touched.',
    token: 'complete-token',
  };

  it('asks the device what is in that folder, writing nothing', async () => {
    vi.mocked(mtpUploadPreset).mockRejectedValue(new Error('Upload incomplete at presets/drum/field kit.preset'));
    vi.mocked(reconcilePresetSend).mockResolvedValue(report);
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.confirm(); });
    expect(result.current.reconciliation).toBeNull();

    await act(async () => { await result.current.check(); });
    expect(reconcilePresetSend).toHaveBeenCalledWith('drum', 'field kit', files);
    expect(result.current.reconciliation?.verdict).toBe('can complete');
    // Checking is read-only: no second write attempt, no history entry for it.
    expect(mtpUploadPreset).toHaveBeenCalledTimes(1);
    expect(catalogRecordTransfer).toHaveBeenCalledTimes(1);
  });

  it('reports a failed check instead of leaving the user guessing', async () => {
    vi.mocked(reconcilePresetSend).mockRejectedValue(new Error('USB disconnected'));
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.check(); });

    expect(result.current.reconciliation).toBeNull();
    expect(notices().some(notice => notice.title === 'could not check the device' && notice.message.includes('USB disconnected'))).toBe(true);
  });

  it('clears the report when the review is dismissed', async () => {
    vi.mocked(reconcilePresetSend).mockResolvedValue(report);
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.check(); });
    expect(result.current.reconciliation).not.toBeNull();
    act(() => result.current.cancel());
    expect(result.current.reconciliation).toBeNull();
  });
});

describe('useConfirmedSend — completing a partly written preset', () => {
  const report = {
    destination: 'presets/drum/field kit.preset',
    folder_exists: true,
    files: [
      { name: 'patch.json', status: 'absent', device_bytes: null },
      { name: 'kick.wav', status: 'identical', device_bytes: 2048 },
    ],
    extra: [],
    identical: 1,
    different: 0,
    absent: 1,
    verdict: 'can complete',
    explanation: '1 file(s) already match and 1 are missing.',
    token: 'complete-token',
  };

  beforeEach(() => {
    connectedOpXy();
    vi.mocked(completePresetSend).mockResolvedValue(1);
    vi.mocked(reconcilePresetSend).mockResolvedValue(report);
  });

  async function checked() {
    const { result } = renderHook(() => useConfirmedSend());
    await act(async () => { result.current.request(async () => described); });
    await act(async () => { await result.current.check(); });
    return result;
  }

  it('writes only the missing files, and records what it added', async () => {
    const result = await checked();
    await act(async () => { await result.current.complete(); });

    // The whole preset is handed over; the device decides what is missing, and the
    // token binds that decision to the folder as it was checked.
    expect(completePresetSend).toHaveBeenCalledWith('drum', 'field kit', files, 'complete-token');
    expect(mtpUploadPreset).not.toHaveBeenCalled();
    expect(catalogRecordTransfer).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'verified',
      name: 'field kit',
      files: [{ path: 'patch.json', bytes: 512 }],
    }));
    expect(notices()[0].title).toBe('completed and verified');
    expect(notices()[0].message).toContain('1 file added');
    expect(result.current.pending).toBeNull();
    expect(result.current.reconciliation).toBeNull();
  });

  it('offers nothing to complete when the verdict is blocked', async () => {
    vi.mocked(reconcilePresetSend).mockResolvedValue({ ...report, verdict: 'blocked', token: null });
    const result = await checked();
    await act(async () => { await result.current.complete(); });
    expect(completePresetSend).not.toHaveBeenCalled();
  });

  it('a failed completion cannot be retried on the same stale check', async () => {
    vi.mocked(completePresetSend).mockRejectedValue(new Error('That folder changed since you checked it.'));
    const result = await checked();
    await act(async () => { await result.current.complete(); });

    expect(notices()[0].type).toBe('error');
    expect(notices()[0].message).toContain('Nothing already on the device was replaced');
    // The approval was single-use, so the report can no longer authorise a write.
    expect(result.current.reconciliation).toBeNull();
    expect(result.current.pending).not.toBeNull();
    await act(async () => { await result.current.complete(); });
    expect(completePresetSend).toHaveBeenCalledTimes(1);
  });
});

describe('SendReview', () => {
  it('names the device, the folder, every file and what the audio will be', () => {
    const pending = {
      ...described,
      deviceModel: 'OP-XY',
      deviceSerial: 'XY-1',
      totalBytes: 2560,
      plan,
    };
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<SendReview pending={pending} sending={false} onConfirm={onConfirm} onCancel={onCancel} />);

    const dialog = screen.getByRole('dialog', { name: /send field kit to op-xy/i });
    expect(dialog).toHaveTextContent('OP-XY · XY-1');
    expect(dialog).toHaveTextContent('presets/drum/field kit.preset');
    expect(dialog).toHaveTextContent('44.1 khz · 16-bit · mono · .wav');
    expect(dialog).toHaveTextContent('2 files');
    expect(screen.getByText('patch.json')).toBeInTheDocument();
    expect(screen.getByText('kick.wav')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/refused rather than replaced/);
    expect(dialog).toHaveTextContent('3.73 gb free');
    expect(dialog).toHaveTextContent(/checked against OP-XY \(XY-1\) just now/);
    expect(dialog).toHaveTextContent(/If you swap devices or reconnect before confirming, the write is refused/);

    fireEvent.click(screen.getByRole('button', { name: 'send to device' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows what the device holds when a check has run, and offers the check itself', () => {
    const onCheck = vi.fn();
    render(<SendReview
      pending={{ ...described, deviceModel: 'OP-XY', deviceSerial: 'XY-1', totalBytes: 2560, plan }}
      sending={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      onCheck={onCheck}
      reconciliation={{
        destination: 'presets/drum/field kit.preset',
        folder_exists: true,
        files: [
          { name: 'patch.json', status: 'absent', device_bytes: null },
          { name: 'kick.wav', status: 'identical', device_bytes: 2048 },
        ],
        extra: ['stray.wav'],
        identical: 1,
        different: 0,
        absent: 1,
        verdict: 'blocked',
        explanation: '1 file(s) in that folder are not part of this preset. Nothing will be changed.',
        token: null,
      }}
    />);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('blocked');
    expect(dialog).toHaveTextContent('Nothing will be changed');
    expect(dialog).toHaveTextContent('absent');
    expect(dialog).toHaveTextContent('identical');
    expect(dialog).toHaveTextContent('not part of this preset');
    fireEvent.click(screen.getByRole('button', { name: 'check the device' }));
    expect(onCheck).toHaveBeenCalledTimes(1);
    // Blocked: there is nothing safe to add, so no button pretends otherwise — and
    // the send that is now certain to be refused is disabled with its reason shown.
    expect(screen.queryByRole('button', { name: /missing/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'send to device' })).toBeDisabled();
    expect(dialog).toHaveTextContent(/refused while that folder exists/);
  });

  it('offers to add the missing files when, and only when, the device said that is safe', () => {
    const onComplete = vi.fn();
    const report = {
      destination: 'presets/drum/field kit.preset',
      folder_exists: true,
      files: [
        { name: 'patch.json', status: 'absent', device_bytes: null },
        { name: 'kick.wav', status: 'identical', device_bytes: 2048 },
      ],
      extra: [],
      identical: 1,
      different: 0,
      absent: 1,
      verdict: 'can complete',
      explanation: 'Only the missing files would be written; nothing existing is touched.',
      token: 'complete-token',
    };
    const { rerender } = render(<SendReview
      pending={{ ...described, deviceModel: 'OP-XY', deviceSerial: 'XY-1', totalBytes: 2560, plan }}
      sending={false} onConfirm={vi.fn()} onCancel={vi.fn()} onCheck={vi.fn()} onComplete={onComplete}
      reconciliation={report} />);

    fireEvent.click(screen.getByRole('button', { name: 'add the 1 missing file' }));
    expect(onComplete).toHaveBeenCalledTimes(1);

    // Without a token — every file already there, or something differs — it is gone.
    rerender(<SendReview
      pending={{ ...described, deviceModel: 'OP-XY', deviceSerial: 'XY-1', totalBytes: 2560, plan }}
      sending={false} onConfirm={vi.fn()} onCancel={vi.fn()} onCheck={vi.fn()} onComplete={onComplete}
      reconciliation={{ ...report, verdict: 'already complete', absent: 0, token: null }} />);
    expect(screen.queryByRole('button', { name: /missing/ })).toBeNull();
  });

  it('escape cancels the review, but never once the write has started', () => {
    const onCancel = vi.fn();
    const pending = { ...described, deviceModel: 'OP-XY', deviceSerial: 'XY-1', totalBytes: 2560, plan };
    const { rerender } = render(<SendReview pending={pending} sending={false} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);

    // Mid-write the Cancel button is disabled; escape has to follow the same rule,
    // because by then the bytes are already going to the instrument.
    rerender(<SendReview pending={pending} sending onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('shows nothing when there is no pending send, and locks both buttons while writing', () => {
    const { container } = render(<SendReview pending={null} sending={false} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();

    render(<SendReview
      pending={{ ...described, deviceModel: 'OP-XY', deviceSerial: null, totalBytes: 2560, plan }}
      sending
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: 'writing…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});