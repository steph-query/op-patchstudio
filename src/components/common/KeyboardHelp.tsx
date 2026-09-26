import { useEffect, useRef } from 'react';
import { SHORTCUTS, shortcutCount } from '../../utils/shortcuts';
import './keyboard-help.css';
import { useModalFocus } from '../../hooks/useModalFocus';

/**
 * The list of every keyboard shortcut, grouped by where it applies.
 *
 * Reached with `?` from anywhere, or from the hint beside the tabs. It is read
 * straight from `SHORTCUTS`, so it cannot describe a key the app does not have.
 */
export function KeyboardHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus in, Tab trapped, and focus handed back to whatever opened the sheet.
  useModalFocus(open, dialogRef);

  useEffect(() => {
    if (!open) return;
    // Focus the dialog itself, not a control inside it. Focusing the Close button —
    // which sits at the bottom of a scrollable sheet — made the browser scroll it
    // into view, so pressing `?` landed in the middle of the list with the heading
    // off screen.
    // Optional call: not every environment implements it, and a missing scroll is
    // not worth throwing over.
    dialogRef.current?.scrollTo?.(0, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      // `?` toggles it shut too, so the key that opened it also closes it.
      if (event.key === 'Escape' || event.key === '?') { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return <div className="keyboard-help-backdrop" role="presentation" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="keyboard-help" role="dialog" aria-modal="true" aria-labelledby="keyboard-help-title" ref={dialogRef} tabIndex={-1}>
      <h2 id="keyboard-help-title">Keyboard shortcuts</h2>
      <p className="keyboard-help-note">{shortcutCount()} shortcuts. Each one works in the place named above it.</p>
      {SHORTCUTS.map(group => <section key={group.where}>
        <h3>{group.where}</h3>
        <dl>
          {group.shortcuts.map(shortcut => <div key={shortcut.does}>
            <dt>{shortcut.keys.map(key => key === 'to' || key === '…'
              ? <span key={key} className="keyboard-help-join">{key}</span>
              : <kbd key={key}>{key}</kbd>)}</dt>
            <dd>{shortcut.does}</dd>
          </div>)}
        </dl>
      </section>)}
      <div className="keyboard-help-actions">
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  </div>;
}
