import { readFileSync, globSync } from 'node:fs';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToggleSwitch } from '../../components/common/ToggleSwitch';

/**
 * Anything you can click, you must be able to reach and operate from the keyboard.
 *
 * `ToggleSwitch` was a `<div onClick>` styled as a pill — not focusable, not announced as
 * interactive, impossible to activate without a mouse. It sets the **export audio format**
 * (wav/aiff) and the **MIDI note mapping** (c3/c4), so those two settings were unavailable
 * to a keyboard user entirely.
 *
 * The three collapsible section headers in `MultisamplePresetSettings` were the same shape,
 * and worse in effect: `sound` is collapsed by default, so six sliders and three selects
 * sat behind a control that could not be operated at all. That one is covered by
 * `MultisampleSliderNames.test.tsx`, which cannot even find the sliders unless the header
 * responds.
 */

/**
 * Comments have to go before scanning.
 *
 * The first version of this swept the raw source and flagged four sites — all of them the
 * phrase `<div onClick>` inside the comments explaining why those very divs had been
 * converted. A sweep that reads its own documentation as evidence is worse than no sweep.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')  // JSX {/* ... */}
    .replace(/\/\*[\s\S]*?\*\//g, '')                // /* ... */
    .replace(/^[ \t]*\/\/.*$/gm, '');                  // // ...
}

/** Overlay backdrops are legitimately mouse-only: Escape is the keyboard path, and
 *  `modalConventions.test.tsx` already requires every modal to have it. */
const BACKDROPS = [
  'src/components/common/ConfirmationModal.tsx',
  'src/components/common/RecordingModal.tsx',
  'src/components/common/WaveformZoomModal.tsx',
  'src/components/drum/DrumBulkEditModal.tsx',
  'src/components/drum/DrumSampleSettingsModal.tsx',
];

/** Surfaces whose interaction is inherently a drag or a pointer gesture. */
const POINTER_GESTURES = [
  'src/components/common/ADSREnvelope.tsx',      // dragging envelope handles
  'src/components/common/FileDropZone.tsx',      // unused; the live drop areas pair with a browse button
];

/** Rows that select a list item and have a keyboard path through their list. */
const LIST_ROWS = [
  'src/components/device/DevicePresetTable.tsx',
  'src/components/multisample/MultisampleSampleTable.tsx',
];

describe('ToggleSwitch', () => {
  const props = { leftLabel: 'wav', rightLabel: 'aiff', isRight: false };

  it('is a switch that says what it is and what state it is in', () => {
    render(<ToggleSwitch {...props} onToggle={vi.fn()} />);
    const toggle = screen.getByRole('switch', { name: 'wav or aiff' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });

  it('reflects the other state', () => {
    render(<ToggleSwitch {...props} isRight onToggle={vi.fn()} />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });

  it('can be reached by tab and operated from the keyboard', () => {
    const onToggle = vi.fn();
    render(<ToggleSwitch {...props} onToggle={onToggle} />);
    const toggle = screen.getByRole('switch');
    toggle.focus();
    expect(toggle).toHaveFocus();
    // A real button activates on both, which a div never did on either.
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('is disabled rather than silently inert', () => {
    const onToggle = vi.fn();
    render(<ToggleSwitch {...props} disabled onToggle={onToggle} />);
    const toggle = screen.getByRole('switch');
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('no clickable element is mouse-only', () => {
  it('every div with an onClick is focusable, or is a documented exception', () => {
    const exempt = new Set([...BACKDROPS, ...POINTER_GESTURES, ...LIST_ROWS]);
    const offenders: string[] = [];
    for (const file of globSync('src/components/**/*.tsx', { cwd: process.cwd() }).map(f => f.replaceAll('\\', '/'))) {
      if (exempt.has(file)) continue;
      const source = withoutComments(readFileSync(file, 'utf8'));
      for (const match of source.matchAll(/<div\b([^>]*?)>/gs)) {
        const attrs = match[1];
        if (!attrs.includes('onClick')) continue;
        if (/role=|tabIndex|onKeyDown/.test(attrs)) continue;
        offenders.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
      }
    }
    expect(offenders, `these can be clicked but not reached by keyboard:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('does not read its own comments as evidence', () => {
    expect(withoutComments('{/* a <div onClick> here */}\n<span />')).not.toContain('onClick');
    expect(withoutComments('// a <div onClick> here\n<span />')).not.toContain('onClick');
    expect(withoutComments('/* a <div onClick> */\n<span />')).not.toContain('onClick');
    // And leaves real markup alone.
    expect(withoutComments('<div onClick={x}>')).toContain('onClick');
  });

  it('the exceptions still exist, so the list cannot go stale', () => {
    for (const file of [...BACKDROPS, ...POINTER_GESTURES, ...LIST_ROWS]) {
      const source = readFileSync(file, 'utf8');
      expect(source.includes('onClick'), `${file} no longer has a clickable div — remove it from the exceptions`).toBe(true);
    }
  });
});
