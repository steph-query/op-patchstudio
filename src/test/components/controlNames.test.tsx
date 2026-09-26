import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Every visible label must name its control.
 *
 * Twenty-two labels across five files carried no `htmlFor` and wrapped no control, while
 * the Carbon components beside them were given `labelText=""` on purpose — so the visible
 * text was decoration and the control itself had **no accessible name at all**. A screen
 * reader announced "combo box" with no indication of what it set, and clicking the label
 * did not focus anything. `RecordingModal`'s "input device" and "filename" were the same,
 * found because a test could not locate the control by its own visible label.
 *
 * Carbon's Select and Toggle put the `id` they are given on the `<select>` and `<button>`
 * respectively, so `htmlFor` associates them properly with no visual change.
 *
 * Carbon's Slider was the hard case: it always sets `aria-labelledby="{id}-label"` on its
 * `role="slider"` element, pointing at an element it renders itself from `labelText`, and
 * overrides `htmlFor`, `aria-label` and `aria-labelledby` passed to the component — all
 * measured rather than assumed. So its six rows had to move their text into `labelText`.
 * That looked like a visual change and was not: one rule in `src/index.css` targeting
 * `.cds--label:has(+ .cds--slider-container)` reproduces the old 14px / weight 500 /
 * primary colour / 8px margin exactly, verified in WebKit. There is no exception left.
 */

function componentFiles(): string[] {
  return globSync('src/components/**/*.tsx', { cwd: process.cwd() }).map(f => f.replaceAll('\\', '/'));
}

/** Labels with no `htmlFor` that do not wrap their own control. */
function orphanLabels(source: string): Array<{ line: number; text: string }> {
  const found: Array<{ line: number; text: string }> = [];
  for (const match of source.matchAll(/<label\b([^>]*)>([\s\S]*?)<\/label>/g)) {
    const [, attrs, body] = match;
    if (attrs.includes('htmlFor')) continue;
    if (/<(input|select|textarea)\b/.test(body)) continue;
    found.push({
      line: source.slice(0, match.index).split('\n').length,
      text: body.replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim(),
    });
  }
  return found;
}

describe('form controls are named by their visible labels', () => {
  it('no label is left unattached except the documented slider rows', () => {
    const orphans: string[] = [];
    for (const file of componentFiles()) {
      for (const { line, text } of orphanLabels(readFileSync(file, 'utf8'))) {
        orphans.push(`${file}:${line}  "${text}"`);
      }
    }
    expect(orphans, `these labels name nothing — add htmlFor pointing at the control's id:\n${orphans.join('\n')}`).toEqual([]);
  });


  it('detects the shape it is looking for', () => {
    expect(orphanLabels('<label style={{}}>playmode</label>')).toHaveLength(1);
    expect(orphanLabels('<label htmlFor="x">playmode</label>')).toHaveLength(0);
    // A label that wraps its own control is associated without htmlFor.
    expect(orphanLabels('<label>name<input /></label>')).toHaveLength(0);
  });
});
