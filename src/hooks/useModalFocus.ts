import { useEffect, type RefObject } from 'react';

/**
 * Give a dialog the keyboard while it is open, and hand it back when it closes.
 *
 * Eight modals had three different answers to this and six of them had none. Two moved
 * focus inside, two trapped Tab, and **none returned focus to whatever opened them** — so
 * closing a dialog dropped you at the top of the document, and with the five that took no
 * focus at all, Tab walked the page *behind* the layer. That included `SendReview`, the
 * one confirmation before anything is written to an instrument: opening it from the
 * keyboard left focus on the send button underneath, where Tab reached controls the user
 * could not see and a screen reader announced the wrong thing.
 *
 * What it does, in order:
 *
 * 1. Remembers what was focused before the dialog opened.
 * 2. Focuses the dialog container itself, not its first button. Focusing the first
 *    focusable element is the usual shortcut and it is wrong here — several of these
 *    dialogs lead with a confirm, and arming Enter on a destructive action as the layer
 *    appears is a way to lose device content by reflex. A focused container is announced
 *    by name and Tab moves inward from there.
 * 3. Keeps Tab inside the container, wrapping at both ends.
 * 4. Restores focus on close, but only if the remembered element is still in the document
 *    — a dialog that removed the thing that opened it would otherwise focus a detached
 *    node, which silently focuses nothing.
 */
export function useModalFocus(isOpen: boolean, container: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!isOpen) return;
    const element = container.current;
    if (!element) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // A container is not focusable by default, and requiring every caller to remember
    // `tabIndex={-1}` is how six of them came to be missing this in the first place.
    if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '-1');
    element.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = [...element.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter(node => node.offsetParent !== null || node === document.activeElement);
      if (!focusable.length) {
        // Nothing to move between, so Tab must not escape to the page behind.
        event.preventDefault();
        return;
      }
      // Every Tab is handled here rather than letting the browser move focus and
      // correcting it afterwards. Natural tab order is not DOM order — in WebKit, Tab
      // from a button inside this fixed overlay lands on the app header — so a trap that
      // only intervenes at the ends lets focus out and snatches it back, which reads as
      // a flicker and puts a screen reader on the wrong element in between.
      event.preventDefault();
      const active = document.activeElement;
      const index = active instanceof HTMLElement ? focusable.indexOf(active) : -1;
      if (index === -1) {
        // Focus is on the container itself, or somewhere outside: enter at the near end.
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
        return;
      }
      const step = event.shiftKey ? -1 : 1;
      focusable[(index + step + focusable.length) % focusable.length].focus();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous && document.contains(previous)) previous.focus();
    };
  }, [isOpen, container]);
}
