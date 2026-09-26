import { readFileSync, globSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * Every device operation says what it is doing.
 *
 * While one is pending the workspace is `inert` and the busy banner is all the user can
 * see, so the operation's `message` is the entire explanation for the freeze. Ten of the
 * seventeen call sites passed none and fell back to "Working… keep the device connected"
 * — connecting, rescanning, zipping a preset, auditioning a sample and refreshing the
 * library after a send were all described with that one sentence, despite taking wildly
 * different amounts of time and meaning different things if interrupted.
 *
 * This is a source sweep rather than a behavioural test because the defect is an absent
 * argument: there is nothing to render and nothing to assert against at runtime.
 */

/** Where a call's own parentheses end, so options on a later line are still seen. */
function callText(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) return source.slice(openParen, i + 1);
    }
  }
  return source.slice(openParen);
}

function sourceFiles(): string[] {
  return globSync('src/**/*.{ts,tsx}', { cwd: process.cwd() })
    .map(file => file.replaceAll('\\', '/'))
    .filter(file => !file.includes('/test/'))
    // The module itself, and the bridge wrapper every call nests inside — it passes no
    // options on purpose, so the outer caller's message survives the nesting.
    .filter(file => !file.endsWith('utils/deviceOperation.ts') && !file.endsWith('utils/tauriBridge.ts'));
}

describe('device operations explain themselves', () => {
  it('every deviceOperation call passes a message', () => {
    const silent: string[] = [];
    let found = 0;
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/deviceOperation\s*\(/g)) {
        found++;
        const call = callText(source, match.index + match[0].length - 1);
        // Inline (`message: '…'`), ES shorthand (`{ message }` from a parameter), or a
        // named constant holding the options.
        if (!/\bmessage\s*[:}]/.test(call) && !/[A-Z_]{4,}/.test(call)) {
          silent.push(`${file}:${source.slice(0, match.index).split('\n').length}`);
        }
      }
    }
    // Guards the sweep itself: a regex that stopped matching would report success.
    expect(found, 'the sweep found no deviceOperation calls at all').toBeGreaterThan(10);
    // And that it would still catch the bare form, which is what shipped for ten sites.
    expect(/\bmessage\s*[:}]/.test('(() => mtpScanPresets())')).toBe(false);
    expect(/\bmessage\s*[:}]/.test("(work, { message })")).toBe(true);
    expect(/\bmessage\s*[:}]/.test("(work, { message: 'x' })")).toBe(true);
    expect(silent, `these device operations show the generic "Working…" banner instead of saying what they are doing:\n${silent.join('\n')}`).toEqual([]);
  });

  it('a long operation that can be stopped says so with a label', () => {
    // `cancel` without `cancelLabel` renders "Cancel", which is vague when the thing
    // being cancelled is a read rather than a dialog.
    for (const file of sourceFiles()) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/deviceOperation\s*\(/g)) {
        const call = callText(source, match.index + match[0].length - 1);
        if (/cancel\s*:/.test(call)) {
          expect(call, `${file} offers a cancel without naming it`).toMatch(/cancelLabel\s*:/);
        }
      }
    }
  });
});
