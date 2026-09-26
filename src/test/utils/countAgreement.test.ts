import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Counts and their nouns have to agree. "1 items" reads as a bug in the app rather
 * than a fact about the library, and it appeared in the recordings header, on every
 * preset card with a single sample, and in six other places — while fifty-two other
 * sites got it right with an inline ternary.
 *
 * That ratio is the reason this is a test rather than eight fixes. The convention was
 * already established and widely followed; what was missing was anything that noticed
 * when a new line broke it. A count followed directly by a bare plural noun is the
 * shape of the mistake, so that is what this looks for.
 *
 * A guarded count is not a defect — `TakeAudition`'s "N regions selected" sits behind
 * `chosenRegions.length > 1` and can never read "1 regions" — so a site can opt out by
 * saying so on the same line or the line above with `count-ok:`.
 */

const NOUNS = [
  'items', 'files', 'tracks', 'regions', 'presets', 'samples', 'takes', 'projects',
  'zones', 'pads', 'stems', 'recordings', 'references', 'folders', 'sessions', 'notes',
];

/** `{x.length} items` and `${x.length} items` — a count spliced straight into a plural. */
const SPLICED = new RegExp(String.raw`\$?\{[^{}]*\b(?:length|count|size)\b[^{}]*\}\s+(${NOUNS.join('|')})\b`, 'g');

function sourceFiles(): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() })
    .filter(file => !file.includes('/test/'))
    .map(file => file.replaceAll('\\', '/'));
}

describe('counts agree with their nouns', () => {
  it('no user-facing string splices a count straight into a plural noun', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        SPLICED.lastIndex = 0;
        for (const match of line.matchAll(SPLICED)) {
          // A ternary on the same line already chooses the noun.
          if (/===\s*1\s*\?/.test(line)) continue;
          // Explicitly reviewed and guarded elsewhere.
          const previous = lines[index - 1] ?? '';
          if (line.includes('count-ok:') || previous.includes('count-ok:')) continue;
          offenders.push(`${file}:${index + 1}  ${match[0].trim()}`);
        }
      });
    }
    expect(offenders, `a count is spliced into a plural noun; use the inline ternary the rest of the app uses, or mark the line "count-ok:" if the count cannot be 1:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('actually detects the shape it is looking for', () => {
    // Without this, a regex that matches nothing would pass the test above forever.
    const sample = 'return <p>{rows.length} items</p>;';
    expect([...sample.matchAll(SPLICED)]).toHaveLength(1);
    expect([...'`loaded ${files.length} files`'.matchAll(SPLICED)]).toHaveLength(1);
    // And leaves the corrected form alone.
    expect([...`{rows.length} {rows.length === 1 ? 'item' : 'items'}`.matchAll(SPLICED)]).toHaveLength(0);
  });
});
