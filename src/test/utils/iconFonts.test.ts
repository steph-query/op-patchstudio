import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Every icon style the app renders must have its font shipped.
 *
 * `src/index.css` used to pull in FontAwesome's `all.css`, which declares four families
 * and made Vite bundle a woff2 and a ttf for each — 1.00 MB of webfonts in a 3.56 MB
 * frontend, 345 KB of it for families nothing renders. Importing only `solid` and
 * `regular` took the bundle to 3.20 MB.
 *
 * The saving creates a trap, which is what this test is really for: adding a `fab fa-…`
 * icon now renders an **empty box** rather than failing in any visible way, because a
 * missing `@font-face` is not an error. So the styles used in source and the styles
 * imported in CSS have to be checked against each other.
 */

/** FontAwesome's class prefixes, and the stylesheet each one needs. */
const STYLES: Record<string, string> = {
  fas: 'solid',
  'fa-solid': 'solid',
  far: 'regular',
  'fa-regular': 'regular',
  fab: 'brands',
  'fa-brands': 'brands',
};

/**
 * Components left behind by the upstream web app, reachable from nothing.
 *
 * Their tests were deleted when the desktop app dropped those routes, but the files
 * stayed. They are excluded from the icon scan because nothing renders them — and the
 * list is checked below, so if either is ever routed again this stops being true and the
 * suite says so rather than shipping an empty box where a logo should be.
 */
const ORPHANS = ['src/components/common/DonatePage.tsx', 'src/components/common/FeedbackPage.tsx'];

function sourceFiles(includeOrphans = false): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() })
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => !file.includes('/test/'))
    .filter(file => includeOrphans || !ORPHANS.includes(file));
}

/** Style prefixes that actually appear in a className, with where they were found. */
function usedStyles(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/class(?:Name)?=["'`]([^"'`]*)["'`]/g)) {
      for (const token of match[1].split(/\s+/)) {
        if (!(token in STYLES)) continue;
        const places = found.get(token) ?? [];
        if (!places.includes(file)) places.push(file);
        found.set(token, places);
      }
    }
  }
  return found;
}

describe('icon fonts', () => {
  const css = readFileSync('src/index.css', 'utf8');

  it('imports a stylesheet for every icon style the app renders', () => {
    const missing: string[] = [];
    for (const [prefix, places] of usedStyles()) {
      const sheet = STYLES[prefix];
      if (!new RegExp(`fontawesome-free/css/${sheet}\\.css`).test(css)) {
        missing.push(`"${prefix}" (needs ${sheet}.css) used in ${places.join(', ')}`);
      }
    }
    expect(missing, `these icons would render as empty boxes — add the stylesheet to src/index.css:\n${missing.join('\n')}`).toEqual([]);
  });

  it('does not import a family nothing uses', () => {
    // The reverse direction, so the saving does not quietly come back.
    const imported = [...css.matchAll(/fontawesome-free\/css\/(\w+)\.css/g)].map(match => match[1]);
    const needed = new Set([...usedStyles().keys()].map(prefix => STYLES[prefix]));
    for (const sheet of imported) {
      if (sheet === 'fontawesome') continue; // the base, always required
      expect(needed, `${sheet}.css is imported but no icon uses it`).toContain(sheet);
    }
  });

  it('never goes back to all.css', () => {
    // It is the obvious thing to reach for and it costs 345 KB.
    expect(css).not.toContain('fontawesome-free/css/all.css');
    // And the base stylesheet must be present, or no icon renders at all.
    expect(css).toContain('fontawesome-free/css/fontawesome.css');
  });

  it('detects the shape it is looking for', () => {
    // A matcher that stopped matching would pass the first test forever.
    const used = usedStyles();
    expect(used.size, 'no icon styles found in source at all').toBeGreaterThan(0);
    expect([...used.keys()], 'the app uses solid icons').toContain('fas');
  });

  it('the modules excluded from the scan really are unreachable', () => {
    // Without this the exclusion list is a way to hide a real defect.
    for (const orphan of ORPHANS) {
      const name = orphan.split('/').pop()!.replace('.tsx', '');
      const importers = sourceFiles(true)
        .filter(file => file !== orphan)
        .filter(file => new RegExp(`import[^;]*\\b${name}\\b[^;]*from`).test(readFileSync(file, 'utf8')));
      expect(importers, `${name} is imported again — it now needs its icon fonts shipped`).toEqual([]);
    }
  });
});
