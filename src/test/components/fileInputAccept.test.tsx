import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Which files the OS dialog will let a person choose.
 *
 * Five inputs listed `audio/*,.wav` and never named AIFF, while an OP-1 field's
 * whole library is `.aif`. Two others offered `.mp3`, `.m4a`, `.ogg` and `.flac`,
 * which this app cannot open — choosing one leads straight to a failure, which is
 * the same dead end the takes import used to have.
 *
 * One list, matching what the app actually reads. The OP-1 *preset* importer keeps
 * its stricter `.aif,.aiff`, because a preset is always AIFF.
 */
const EXPECTED = '.wav,.aif,.aiff,audio/*';
const PRESET_IMPORTER = '.aif,.aiff';

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

describe('file chooser filters', () => {
  it('offer exactly what the app can open, everywhere', () => {
    const offenders: string[] = [];
    for (const path of sources(resolve(process.cwd(), 'src/components'))) {
      const source = readFileSync(path, 'utf8');
      for (const match of source.matchAll(/accept="([^"]*)"/g)) {
        const list = match[1];
        if (!/wav|aif|audio/i.test(list)) continue;
        if (list !== EXPECTED && list !== PRESET_IMPORTER) {
          offenders.push(`${path.split('src/components/')[1]}: ${list}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('name AIFF rather than trusting a wildcard to cover it', () => {
    expect(EXPECTED).toContain('.aif');
    expect(EXPECTED).toContain('.aiff');
  });

  it('do not offer containers the app cannot read', () => {
    for (const unreadable of ['.mp3', '.m4a', '.ogg', '.flac']) {
      expect(EXPECTED).not.toContain(unreadable);
    }
  });
});
