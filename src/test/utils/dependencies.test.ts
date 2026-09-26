import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Every runtime dependency must be imported by something.
 *
 * Two were not: `react-icons` (84 MB installed) and `carbon-components` (14.9 MB, the
 * Carbon v10 package superseded by `@carbon/react` + `@carbon/styles`). Neither appeared
 * in the bundle — Rollup had been tree-shaking them all along — so this was never a size
 * problem on disk. It was 109 MB of install, and a trap: a dead dependency is one an
 * editor will happily auto-import, and nothing would have said it was never meant to be
 * here.
 *
 * `sass` and `@types/uuid` were also listed as runtime dependencies while being purely
 * build-time; they are devDependencies now.
 */

/** Runtime dependencies that legitimately have no `import` in src, and why. */
const NO_IMPORT_EXPECTED: Record<string, string> = {
  // Nothing yet. Keep this empty if possible — an entry here is an exemption, and each
  // one is a place where the check below stops being able to tell dead from load-bearing.
};

function packageJson() {
  return JSON.parse(readFileSync('package.json', 'utf8')) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };
}

/** Every module specifier imported anywhere in src, including from CSS and SCSS. */
function importedSpecifiers(): string[] {
  const specifiers: string[] = [];
  const files = globSync('src/**/*.{ts,tsx,css,scss}', { cwd: process.cwd() });
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const pattern of [
      /from\s+['"]([^'"]+)['"]/g,       // import x from 'y'
      /import\s+['"]([^'"]+)['"]/g,     // import 'y'  (and CSS @import handled below)
      /@(?:use|import)\s+['"]([^'"]+)['"]/g, // scss @use / css @import
      /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]) {
      for (const match of source.matchAll(pattern)) specifiers.push(match[1]);
    }
  }
  return specifiers;
}

/** `@scope/name/deep/path` → `@scope/name`; `name/deep` → `name`. */
function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

describe('dependencies', () => {
  const { dependencies, devDependencies } = packageJson();

  it('every runtime dependency is imported somewhere', () => {
    const imported = new Set(importedSpecifiers().map(packageOf).filter(Boolean) as string[]);
    const unused = Object.keys(dependencies)
      .filter(name => !imported.has(name))
      .filter(name => !(name in NO_IMPORT_EXPECTED));
    expect(unused, `these are installed and shipped-adjacent but imported by nothing — remove them, or add a reason to NO_IMPORT_EXPECTED:\n${unused.join('\n')}`).toEqual([]);
  });

  it('build-only tools are not listed as runtime dependencies', () => {
    // `sass` compiles the theme and `@types/uuid` is types; neither is in the app.
    for (const tool of ['sass', 'vite', 'typescript', 'vitest', '@playwright/test']) {
      expect(dependencies, `${tool} belongs in devDependencies`).not.toHaveProperty(tool);
    }
    for (const types of Object.keys(dependencies)) {
      expect(types.startsWith('@types/'), `${types} is a types package and belongs in devDependencies`).toBe(false);
    }
  });

  it('detects the shape it is looking for', () => {
    // A resolver that stopped resolving would report every dependency as used.
    const imported = new Set(importedSpecifiers().map(packageOf).filter(Boolean) as string[]);
    expect(imported, 'react should be detected as imported').toContain('react');
    expect(imported, 'the Carbon styles are imported from scss').toContain('@carbon/styles');
    expect(packageOf('@carbon/styles/scss/theme')).toBe('@carbon/styles');
    expect(packageOf('./local')).toBeNull();
    // And the dependency list is real rather than empty.
    expect(Object.keys(dependencies).length).toBeGreaterThan(5);
    expect(Object.keys(devDependencies).length).toBeGreaterThan(5);
  });
});
