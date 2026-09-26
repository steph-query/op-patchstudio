import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MultisamplePresetSettings } from '../../components/multisample/MultisamplePresetSettings';
import { AppContextProvider } from '../../context/AppContext';

/**
 * The six sliders in the multisample settings had **no accessible name at all**.
 *
 * Each row put its visible text in a separate `<label>` for appearance and passed
 * `labelText=""` to the Slider. Carbon points a slider's `aria-labelledby` at an element it
 * renders itself from `labelText`, and overrides `htmlFor`, `aria-label` and
 * `aria-labelledby` given to the component — all measured rather than assumed — so an
 * empty `labelText` means an unnamed control. A screen reader announced "slider, 0" with
 * nothing to say what it set: transpose, width, highpass, velocity, volume or portamento.
 *
 * Moving the text into `labelText` names them. Appearance is preserved by a rule in
 * `src/index.css` targeting `.cds--label:has(+ .cds--slider-container)`, verified in WebKit
 * to compute to the same 14px / weight 500 / primary colour / 8px margin the separate
 * labels had — so this is a correctness change with no visual one.
 */

/** Every slider in this panel, by the name it must now answer to. */
const SLIDERS = [
  /transpose:/i,
  /width:/i,
  /highpass:/i,
  /velocity sensitivity:/i,
  /volume:/i,
  /portamento amount:/i,
];

function openEverySection() {
  render(
    <AppContextProvider>
      <MultisamplePresetSettings />
    </AppContextProvider>,
  );
  // The rows live in collapsible sections; open whatever will open so the sliders mount.
  for (const button of screen.queryAllByRole('button')) {
    if (/sound|sample|advanced|settings|engine|tuning/i.test(button.textContent ?? '')) {
      fireEvent.click(button);
    }
  }
}

describe('multisample slider names', () => {
  it('every slider says what it sets', () => {
    openEverySection();
    const sliders = screen.queryAllByRole('slider');
    // If the panel renders no slider at all this test would pass vacuously.
    expect(sliders.length, 'no sliders rendered, so this proves nothing').toBeGreaterThan(0);

    const names = sliders.map(slider => {
      const id = slider.getAttribute('aria-labelledby');
      const labelledBy = id ? document.getElementById(id) : null;
      return (slider.getAttribute('aria-label') ?? labelledBy?.textContent ?? '').trim();
    });
    const unnamed = names.filter(name => !name).length;
    expect(unnamed, `${unnamed} of ${sliders.length} sliders have no accessible name: ${JSON.stringify(names)}`).toBe(0);
  });

  it('names the right things, not just any text', () => {
    openEverySection();
    const names = screen.queryAllByRole('slider').map(slider => {
      const id = slider.getAttribute('aria-labelledby');
      return (id ? document.getElementById(id)?.textContent : '') ?? '';
    });
    for (const expected of SLIDERS) {
      expect(names.some(name => expected.test(name)), `no slider is named ${expected}; found ${JSON.stringify(names)}`).toBe(true);
    }
  });

  it('carries the live value, which is why the text is in the label', () => {
    // "transpose: 0" rather than "transpose" — the value is part of the name, so a screen
    // reader user hears the setting without having to hunt for it.
    openEverySection();
    const names = screen.queryAllByRole('slider').map(slider => {
      const id = slider.getAttribute('aria-labelledby');
      return (id ? document.getElementById(id)?.textContent : '') ?? '';
    });
    expect(names.some(name => /transpose:\s*-?\d+/.test(name)), `no transpose value in ${JSON.stringify(names)}`).toBe(true);
  });
});
