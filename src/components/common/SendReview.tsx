import { useEffect, useRef } from 'react';
import type { PendingSend } from '../../hooks/useConfirmedSend';
import type { ReconcileReport } from '../../utils/tauriBridge';
import { formatFileSize } from '../../utils/audio';
import { formatBytes } from '../../utils/formatBytes';
import './send-review.css';
import { useModalFocus } from '../../hooks/useModalFocus';

/**
 * The single confirmation before anything is written to an instrument.
 *
 * It states the device by name, the folder, every file, and what the audio will
 * be — so confirming is an informed act rather than a reflex. There is no second
 * dialog: this is the one step the send costs.
 */
export function SendReview({
  pending,
  sending,
  onConfirm,
  onCancel,
  reconciliation,
  checking,
  onCheck,
  onComplete,
}: {
  pending: PendingSend | null;
  sending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  reconciliation?: ReconcileReport | null;
  checking?: boolean;
  onCheck?: () => void;
  onComplete?: () => void;
}) {
  const modalFocusRef = useRef<HTMLDivElement | null>(null);
  useModalFocus(!!pending, modalFocusRef);
  // Escape cancels, as it does everywhere else — but not mid-write, for the same
  // reason the Cancel button is disabled then: the bytes are already going.
  useEffect(() => {
    if (!pending || sending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onCancel(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pending, sending, onCancel]);

  if (!pending) return null;
  // Once a check has found that folder, sending it fresh is certain to be refused —
  // so the button that would do it says why instead of failing on press.
  const folderExists = reconciliation?.folder_exists === true;

  return <div className="send-review-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget && !sending) onCancel(); }}>
    <div className="send-review" ref={modalFocusRef}
      role="dialog" aria-modal="true" aria-labelledby="send-review-title">
      <h2 id="send-review-title">Send {pending.name} to {pending.deviceModel.toLowerCase()}?</h2>
      <dl>
        <div><dt>Device</dt><dd>{pending.deviceModel}{pending.deviceSerial ? ` · ${pending.deviceSerial}` : ''}</dd></div>
        <div><dt>Folder</dt><dd><code>presets/{pending.category}/{pending.name}.preset</code></dd></div>
        <div><dt>Audio</dt><dd>{pending.format}</dd></div>
        <div><dt>Writing</dt><dd>{pending.files.length} {pending.files.length === 1 ? 'file' : 'files'} · {formatFileSize(pending.totalBytes)}</dd></div>
        <div><dt>Device has</dt><dd>{formatBytes(pending.plan.free_space)} free{pending.plan.creates_category ? `, and ${pending.category} will be created` : ''}</dd></div>
      </dl>

      <ul className="send-review-files">
        {pending.files.map(file => <li key={file.name}>
          <code>{file.name}</code><span>{formatFileSize(file.data.length)}</span>
        </li>)}
      </ul>

      <p className="send-review-note">
        This plan was checked against {pending.deviceModel}{pending.deviceSerial ? ` (${pending.deviceSerial})` : ''} just now. If you swap devices or reconnect before confirming, the write is refused rather than sent to the wrong instrument. An existing preset of this name is refused rather than replaced, and every file is read back and compared before this is called sent.
      </p>

      {reconciliation && <div className="send-review-reconcile" role="status">
        <strong>{reconciliation.verdict}</strong>
        <p>{reconciliation.explanation}</p>
        <ul>
          {reconciliation.files.map(file => <li key={file.name}><code>{file.name}</code><span>{file.status}</span></li>)}
          {reconciliation.extra.map(name => <li key={'extra-' + name}><code>{name}</code><span>not part of this preset</span></li>)}
        </ul>
        {folderExists && <p className="send-review-dead-end">
          {reconciliation.token
            ? 'Sending this as a new preset is refused while that folder exists. Add the missing files, or cancel and send it under another name.'
            : 'Sending this as a new preset is refused while that folder exists. Cancel and send it under another name, or tidy that folder on the device first.'}
        </p>}
        {onComplete && reconciliation.token && <button className="media-primary" onClick={onComplete} disabled={sending || checking}>
          {sending ? 'adding…' : `add the ${reconciliation.absent} missing ${reconciliation.absent === 1 ? 'file' : 'files'}`}
        </button>}
      </div>}

      <div className="send-review-actions">
        {onCheck && <button onClick={onCheck} disabled={sending || checking}>
          {checking ? 'checking…' : 'check the device'}
        </button>}
        <button onClick={onCancel} disabled={sending}>Cancel</button>
        <button className="media-primary" onClick={onConfirm} disabled={sending || folderExists}>
          {sending ? 'writing…' : 'send to device'}
        </button>
      </div>
    </div>
  </div>;
}
