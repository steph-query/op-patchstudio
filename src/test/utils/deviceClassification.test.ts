import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectDeviceKind } from '../../utils/teDevices';

/**
 * Recognising a device happens twice: `detectDeviceKind` here and `classify` in
 * `src-tauri/src/te.rs`. Unlike the root lists, this pair is *logic*, so it can
 * drift in ways a data comparison would miss — which it had. A regex word
 * boundary treats `_` as part of a word, so `OP_XY` was an OP-XY natively and
 * unknown in the interface: the same instrument would be backed up as an OP-XY
 * while the UI offered it the unknown profile, without its library, install or
 * project tabs.
 *
 * Both sides now assert against this one fixture. `src-tauri/src/te.rs` reads the
 * same file in its own test, so a change to either classifier fails on its own
 * side with the case that broke.
 */
interface ModelCase {
  model: string;
  productId: number | null;
  kind: string;
  why?: string;
}

const fixture = JSON.parse(readFileSync(resolve(process.cwd(), 'fixtures/device-models.json'), 'utf8')) as {
  cases: ModelCase[];
};

describe('detectDeviceKind, against the shared fixture', () => {
  it('has cases to check', () => {
    expect(fixture.cases.length).toBeGreaterThan(20);
  });

  it.each(fixture.cases)('$model ($productId) is $kind', ({ model, productId, kind, why }) => {
    expect(detectDeviceKind(model, productId), why ?? model).toBe(kind);
  });

  it('treats a missing model the same as an empty one', () => {
    expect(detectDeviceKind(null)).toBe('unknown');
    expect(detectDeviceKind(undefined)).toBe('unknown');
  });
});
