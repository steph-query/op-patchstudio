import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDeviceProfile, READABLE_AUDIO, isReadableAudio } from '../../utils/teDevices';
import type { TeDeviceKind } from '../../utils/teDevices';

/**
 * The same device knowledge exists twice: `roots` in `src/utils/teDevices.ts`
 * drives the inventory scan, and `backup_roots` in `src-tauri/src/te.rs` is the
 * authority for backup, restore and path validation.
 *
 * Drift between them is silent and costly in both directions. A root added only to
 * the frontend means the app lists files that backups never save. A root added
 * only to Rust means `backup.rs` requires it in every manifest, so restoring an
 * older backup fails with "Backup is missing a library root". Neither shows up in
 * any other test, because each side is internally consistent.
 */
const RUST_SOURCE = resolve(process.cwd(), 'src-tauri/src/te.rs');

function rustBackupRoots(): Map<string, string[]> {
  const source = readFileSync(RUST_SOURCE, 'utf8');
  const body = source.slice(source.indexOf('pub fn backup_roots'));
  const arms = body.slice(0, body.indexOf('\n}')).matchAll(/"([a-z0-9-]+)"\s*=>\s*&\[([^\]]*)\]/g);
  const roots = new Map<string, string[]>();
  for (const [, kind, list] of arms) {
    roots.set(kind, [...list.matchAll(/"([^"]+)"/g)].map(([, name]) => name));
  }
  return roots;
}

describe('device library roots, in both languages', () => {
  it('has a Rust source to compare against', () => {
    // If this file moves, the invariant below silently stops checking anything.
    expect(existsSync(RUST_SOURCE), `${RUST_SOURCE} not found`).toBe(true);
    // Concrete values, so a regex that matched the wrong thing — or nothing — cannot
    // make the comparison below pass by having nothing to compare.
    expect(rustBackupRoots().get('op-1-field')).toEqual(['drum', 'synth', 'tape', 'album']);
    expect(rustBackupRoots().get('tp-7')).toEqual(['recordings', 'memo']);
    expect(rustBackupRoots().size).toBe(3);
  });

  it('agrees on every device, in the same order', () => {
    const rust = rustBackupRoots();
    for (const [kind, expected] of rust) {
      const profile = getDeviceProfile(kind as TeDeviceKind);
      expect(profile.kind, `${kind} is a device the frontend knows`).toBe(kind);
      expect(profile.roots, `${kind}: teDevices.ts roots vs te.rs backup_roots`).toEqual(expected);
    }
  });

  it('covers every device the frontend claims roots for', () => {
    // The other direction: a frontend device with roots but no Rust arm would be
    // scanned and shown, and then silently skipped by every backup.
    const rust = rustBackupRoots();
    for (const kind of ['op-xy', 'op-1-field', 'tp-7'] as TeDeviceKind[]) {
      expect(rust.has(kind), `${kind} has a backup_roots arm in te.rs`).toBe(true);
    }
    // `unknown` deliberately has none on either side: nothing is assumed about a
    // device this app has not been taught.
    expect(getDeviceProfile('unknown').roots).toEqual([]);
    expect(rust.get('unknown') ?? []).toEqual([]);
  });
});

/**
 * The other fact both languages hold: which audio containers this app can open.
 * `is_audio_file` in `src-tauri/src/main.rs` decides what a device scan calls
 * audio; `READABLE_AUDIO` decides the same in the interface. A container listed
 * by one and not the other is either a file the user is offered and cannot open,
 * or one they can open and are never shown.
 */
const RUST_MAIN = resolve(process.cwd(), 'src-tauri/src/main.rs');

function rustAudioSuffixes(): string[] {
  const source = readFileSync(RUST_MAIN, 'utf8');
  const body = source.slice(source.indexOf('fn is_audio_file'));
  const list = body.slice(0, body.indexOf('\n}'));
  return [...list.matchAll(/"\.([a-z0-9]+)"/g)].map(([, extension]) => extension).sort();
}

describe('what counts as audio, in both languages', () => {
  it('is the same set of containers', () => {
    const rust = rustAudioSuffixes();
    expect(rust).toEqual(['aif', 'aiff', 'wav']);
    for (const extension of rust) {
      expect(isReadableAudio(`take.${extension}`), `${extension} is readable in the interface`).toBe(true);
      expect(isReadableAudio(`TAKE.${extension.toUpperCase()}`), `${extension} in caps`).toBe(true);
    }
  });

  it('excludes what neither side can decode', () => {
    // These were listed as audio by the tape and TP-7 views, which meant offering a
    // recording that cannot be auditioned, previewed or sliced.
    for (const extension of ['mp3', 'flac', 'm4a', 'ogg', 'txt', 'json', 'xy']) {
      expect(isReadableAudio(`file.${extension}`), extension).toBe(false);
      expect(rustAudioSuffixes()).not.toContain(extension);
    }
  });

  it('strips only a real audio extension', () => {
    expect('take.wav'.replace(READABLE_AUDIO, '')).toBe('take');
    expect('my.take.aif'.replace(READABLE_AUDIO, '')).toBe('my.take');
    expect('notes.txt'.replace(READABLE_AUDIO, '')).toBe('notes.txt');
  });
});
