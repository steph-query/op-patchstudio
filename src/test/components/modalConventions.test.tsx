import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationModal } from '../../components/common/ConfirmationModal';

/**
 * Every layer in this app should behave the same way: announced as a dialog, named,
 * and dismissable with escape. Three modals predated that convention and quietly
 * broke it — including the confirmation that guards destructive actions, where
 * escape is the answer a person reaches for without thinking.
 *
 * The file sweep is deliberate. Each modal individually is easy to fix and easy to
 * forget; asserting the rule across all of them is what stops the next one being
 * added without it.
 */
const MODALS = [
  'common/ConfirmationModal.tsx',
  'common/RecordingModal.tsx',
  'common/SessionRestorationModal.tsx',
  'common/WaveformZoomModal.tsx',
  'common/SendReview.tsx',
  'common/KeyboardHelp.tsx',
  'drum/DrumBulkEditModal.tsx',
  'drum/DrumSampleSettingsModal.tsx',
];

describe('every modal follows the same conventions', () => {
  it.each(MODALS)('%s is a named dialog that escape closes', file => {
    const source = readFileSync(resolve(process.cwd(), 'src/components', file), 'utf8');
    expect(source, 'role="dialog"').toContain('role="dialog"');
    expect(source, 'aria-modal').toContain('aria-modal');
    expect(source.includes('aria-labelledby') || source.includes('aria-label='), 'an accessible name').toBe(true);
    expect(source, 'escape handling').toContain("'Escape'");
  });

  /**
   * Focus was the convention nothing enforced. Eight modals had three different answers
   * and six had none: two moved focus inside, two trapped Tab, and **none returned focus
   * to whatever opened them**. With the five that took no focus at all, Tab walked the
   * page behind the layer — including in `SendReview`, the one confirmation before
   * anything is written to an instrument.
   */
  it.each(MODALS)('%s hands the keyboard to the dialog and gives it back', file => {
    const source = readFileSync(resolve(process.cwd(), 'src/components', file), 'utf8');
    expect(source, 'useModalFocus').toContain('useModalFocus(');
    // Pointed at a real container, not a stray ref that was never attached.
    const ref = /useModalFocus\(\s*[^,]+,\s*(\w+)\s*\)/.exec(source);
    expect(ref, 'the hook must be given a ref').not.toBeNull();
    expect(source, `${ref?.[1]} must be attached to an element`).toContain(`ref={${ref?.[1]}}`);
  });

  /**
   * The flag must be the component's *own* idea of being open.
   *
   * `SendReview` was given a literal `true` while it returns null until a send is
   * pending — so the effect ran on the first render with no container to focus, and
   * because the flag never changed it never ran again. The dialog opened with focus
   * still on the button behind it, which is the defect this hook exists to remove,
   * reintroduced by the wiring.
   */
  it.each(MODALS)('%s gates the hook on the same condition it renders on', file => {
    const source = readFileSync(resolve(process.cwd(), 'src/components', file), 'utf8');
    const flag = /useModalFocus\(\s*([^,]+?)\s*,/.exec(source)?.[1];
    const guard = /if \(!(\w+)\) return null;/.exec(source)?.[1];
    expect(flag, 'the hook takes an open flag').toBeTruthy();
    if (!guard) return; // A modal the parent only mounts when open needs no guard.
    // `!!pending` and `pending`, or `isOpen` and `isOpen` — the same name either way.
    expect(flag?.replace(/[!]/g, ''), `gated on ${flag} but rendered on ${guard}`).toBe(guard);
  });

  it('there is one implementation rather than one per modal', () => {
    // Two modals had hand-written Tab traps. Both were correct and neither restored
    // focus, which is exactly the outcome a duplicated convention produces.
    for (const file of MODALS) {
      const source = readFileSync(resolve(process.cwd(), 'src/components', file), 'utf8');
      expect(source, `${file} still has its own focus trap`).not.toMatch(/querySelectorAll[^\n]*tabindex/);
    }
  });
});

describe('ConfirmationModal', () => {
  const props = { isOpen: true, message: 'loading a preset will overwrite your current session.', onConfirm: vi.fn(), onCancel: vi.fn() };

  it('is announced as what it is', () => {
    render(<ConfirmationModal {...props} />);
    expect(screen.getByRole('dialog', { name: /confirm action/i })).toBeInTheDocument();
    expect(screen.getByText(/overwrite your current session/)).toBeInTheDocument();
  });

  it('escape cancels, rather than confirming or doing nothing', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmationModal {...props} onCancel={onCancel} onConfirm={onConfirm} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('listens for nothing while closed', () => {
    const onCancel = vi.fn();
    render(<ConfirmationModal {...props} isOpen={false} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
