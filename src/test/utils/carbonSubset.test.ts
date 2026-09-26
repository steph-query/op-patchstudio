import { readFileSync, globSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * The Carbon subset must cover every Carbon component the app renders.
 *
 * `main.tsx` used to import `@carbon/styles/css/styles.css` — the whole library, 836 KB,
 * declaring 3,854 `cds--` selectors of which 61 matched anything on screen. It now imports
 * `src/theme/carbon-subset.scss`, which took the stylesheet to 246 KB.
 *
 * The failure mode of getting this wrong is silent and ugly: a Carbon component whose
 * stylesheet is missing renders as an unstyled control — a select with no chevron, a
 * slider with no track — and nothing errors. So the components imported from
 * `@carbon/react` in source and the component sheets in the subset are checked against
 * each other here.
 */

/** Carbon exports that are not separate stylesheets, and what covers them instead. */
const COVERED_ELSEWHERE: Record<string, string> = {
  SelectItem: 'select',
  Theme: 'the theme layers',
  Content: 'ui-shell',
  Modal: 'modal',
  InlineLoading: 'inline-loading',
  TextInput: 'text-input',
};

/** Component name as used in JSX → the scss directory that styles it. */
function sheetFor(component: string): string {
  if (component in COVERED_ELSEWHERE) {
    const mapped = COVERED_ELSEWHERE[component];
    return /^[a-z-]+$/.test(mapped) ? mapped : '';
  }
  // Button → button, TextInput → text-input
  return component.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function carbonComponentsUsed(): string[] {
  const used = new Set<string>();
  for (const file of globSync('src/**/*.tsx', { cwd: process.cwd() }).filter(f => !f.includes('/test/'))) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from\s*'@carbon\/react'/g)) {
      for (const name of match[1].split(',')) {
        const clean = name.trim();
        if (clean) used.add(clean);
      }
    }
  }
  return [...used].sort();
}

describe('the Carbon subset', () => {
  const subset = readFileSync('src/theme/carbon-subset.scss', 'utf8');

  it('includes a stylesheet for every Carbon component the app imports', () => {
    const missing: string[] = [];
    for (const component of carbonComponentsUsed()) {
      const sheet = sheetFor(component);
      if (!sheet) continue; // covered by a theme layer rather than a component sheet
      if (!subset.includes(`components/${sheet}'`)) missing.push(`${component} (needs components/${sheet})`);
    }
    expect(missing, `these components would render unstyled — add them to src/theme/carbon-subset.scss:\n${missing.join('\n')}`).toEqual([]);
  });

  it('names sheets that actually exist in the installed Carbon', () => {
    // A typo in a `@use` path fails the build, but a sheet removed by a Carbon upgrade
    // would be a silent loss of styling for whatever it covered.
    for (const match of subset.matchAll(/@use '@carbon\/styles\/scss\/components\/([\w-]+)'/g)) {
      expect(existsSync(`node_modules/@carbon/styles/scss/components/${match[1]}`), `components/${match[1]} is no longer in @carbon/styles`).toBe(true);
    }
  });

  it('never goes back to the whole library', () => {
    const main = readFileSync('src/main.tsx', 'utf8');
    expect(main, 'main.tsx imports the full Carbon stylesheet again').not.toContain('@carbon/styles/css/styles.css');
    expect(main).toContain('carbon-subset.scss');
  });

  it('detects the shape it is looking for', () => {
    const used = carbonComponentsUsed();
    expect(used.length, 'no @carbon/react imports found in source at all').toBeGreaterThan(3);
    expect(used, 'Select is one of the components in use').toContain('Select');
    // And the mapping produces the kebab-case sheet names Carbon uses.
    expect(sheetFor('Slider')).toBe('slider');
    expect(sheetFor('TextInput')).toBe('text-input');
  });
});
