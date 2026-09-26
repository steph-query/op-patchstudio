import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KeyboardHelp } from '../../components/common/KeyboardHelp';
import { SHORTCUTS, shortcutCount, isTypingTarget } from '../../utils/shortcuts';

describe('KeyboardHelp', () => {
  it('lists every shortcut under the place it applies', () => {
    render(<KeyboardHelp open onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog', { name: /keyboard shortcuts/i });

    for (const group of SHORTCUTS) {
      expect(screen.getByRole('heading', { name: group.where })).toBeInTheDocument();
      for (const shortcut of group.shortcuts) expect(dialog).toHaveTextContent(shortcut.does);
    }
    // The keys the user came here to learn.
    expect(dialog).toHaveTextContent('⌘1');
    expect(dialog).toHaveTextContent(`${shortcutCount()} shortcuts`);
  });

  it('shows nothing when closed', () => {
    const { container } = render(<KeyboardHelp open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('closes on escape, on ? again, on the backdrop and on the button', () => {
    const onClose = vi.fn();
    const { container } = render(<KeyboardHelp open onClose={onClose} />);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    // The key that opened it closes it — otherwise ? would open a second copy in the mind.
    fireEvent.keyDown(window, { key: '?' });
    expect(onClose).toHaveBeenCalledTimes(2);
    fireEvent.click(container.firstChild as Element);
    expect(onClose).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it('puts focus on the sheet itself, and does not close on a click inside', () => {
    const onClose = vi.fn();
    render(<KeyboardHelp open onClose={onClose} />);
    // Not the Close button: it sits at the bottom of a scrollable sheet, so focusing
    // it made the browser scroll it into view and the heading off screen.
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening for escape once it is closed', () => {
    const onClose = vi.fn();
    const { rerender } = render(<KeyboardHelp open onClose={onClose} />);
    rerender(<KeyboardHelp open={false} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('the shortcut table', () => {
  it('describes each key once, in a named place', () => {
    const places = SHORTCUTS.map(group => group.where);
    expect(new Set(places).size).toBe(places.length);
    for (const group of SHORTCUTS) {
      expect(group.shortcuts.length).toBeGreaterThan(0);
      for (const shortcut of group.shortcuts) {
        expect(shortcut.keys.length).toBeGreaterThan(0);
        expect(shortcut.keys.every(key => key.length > 0)).toBe(true);
        // A description that does not end in a sentence reads as a fragment beside the others.
        expect(shortcut.does.endsWith('.')).toBe(true);
      }
    }
  });

  it('knows when the user is typing, so a letter shortcut does not steal the keystroke', () => {
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const plain = document.createElement('div');

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
    expect(isTypingTarget(plain)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    // Detected from the attribute, because jsdom leaves the isContentEditable
    // property undefined and a real browser is not the only place this runs.
    expect(isTypingTarget(editable)).toBe(true);
    const notEditable = document.createElement('div');
    notEditable.setAttribute('contenteditable', 'false');
    expect(isTypingTarget(notEditable)).toBe(false);
  });
});
