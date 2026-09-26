import { describe, it, expect } from 'vitest';
import { buildSampleUsage, usage, sharingWith, describeUsage, unreferencedAmong } from '../../utils/sampleUsage';
import type { ScannedProject } from '../../utils/sampleUsage';
import type { XyPathRecord } from '../../utils/deviceXyParser';

function record(fullPath: string, type: XyPathRecord['type'] = 'standalone-sample'): XyPathRecord {
  return { offset: 0, segments: fullPath.split('/').filter(Boolean), fullPath, type };
}

function project(name: string, paths: Array<XyPathRecord | string>): ScannedProject {
  return { name, records: paths.map(path => (typeof path === 'string' ? record(path) : path)) };
}

const KICK = '/fat32/samples/user/kick.wav';
const SNARE = '/fat32/samples/user/snare.wav';
const HAT = '/fat32/samples/user/hat.wav';

describe('which projects use a sample', () => {
  it('names every project referencing it, not just the count', () => {
    const index = buildSampleUsage([
      project('monday jam', [KICK, SNARE]),
      project('tuesday', [KICK]),
      project('sketch', [HAT]),
    ]);
    expect(usage(index, KICK)).toEqual({ state: 'referenced', projects: ['monday jam', 'tuesday'] });
    expect(usage(index, SNARE)).toEqual({ state: 'referenced', projects: ['monday jam'] });
  });

  it('counts a project once however many times it references the sample', () => {
    const index = buildSampleUsage([project('loop heavy', [KICK, KICK, KICK])]);
    expect(usage(index, KICK)).toEqual({ state: 'referenced', projects: ['loop heavy'] });
  });

  it('reports nothing found only when every project was read', () => {
    const index = buildSampleUsage([project('a', [KICK]), project('b', [SNARE])]);
    expect(usage(index, HAT)).toEqual({ state: 'unreferenced' });
  });

  /**
   * The property this module exists for. One unread project out of many makes every
   * negative answer provisional — and the unread one is exactly as likely as any
   * other to be the only thing holding the file.
   */
  it('will not call a sample unused when a single project could not be read', () => {
    const index = buildSampleUsage([
      project('a', [KICK]),
      project('b', [SNARE]),
      { name: 'corrupt', records: null, problem: 'no magic header' },
    ]);
    const verdict = usage(index, HAT);
    expect(verdict.state).toBe('indeterminate');
    expect(verdict).toMatchObject({ unread: [{ name: 'corrupt', problem: 'no magic header' }] });
  });

  it('still answers positively on an incomplete sweep, because a hit is a hit', () => {
    // Finding a reference is conclusive whatever else failed to read; only the
    // absence of one depends on having read everything.
    const index = buildSampleUsage([project('a', [KICK]), { name: 'corrupt', records: null }]);
    expect(usage(index, KICK)).toEqual({ state: 'referenced', projects: ['a'] });
  });

  it('distinguishes two samples of the same name in different folders', () => {
    const inPreset = '/fat32/presets/drum/kit.preset/kick.wav';
    const index = buildSampleUsage([
      project('a', [record(inPreset, 'preset-sample')]),
      project('b', [KICK]),
    ]);
    expect(usage(index, inPreset)).toEqual({ state: 'referenced', projects: ['a'] });
    expect(usage(index, KICK)).toEqual({ state: 'referenced', projects: ['b'] });
  });

  it('ignores record kinds that do not name a file on the device', () => {
    // `content` is factory material with no file; `short-ref` names a preset. Counting
    // either would report a reference to a path that does not exist.
    const index = buildSampleUsage([
      project('a', [record('/content/factory/kick', 'content'), record('#drum/kit.preset', 'short-ref')]),
    ]);
    expect(index.byPath.size).toBe(0);
    expect(usage(index, '/content/factory/kick')).toEqual({ state: 'unreferenced' });
  });
});

describe('describing a verdict', () => {
  it('names the projects and the consequence', () => {
    const index = buildSampleUsage([project('monday jam', [KICK]), project('tuesday', [KICK])]);
    const text = describeUsage(usage(index, KICK), 'kick.wav');
    expect(text).toContain('used by 2 projects: monday jam, tuesday');
    expect(text).toContain('missing sample');
  });

  it('never claims a file is safe to delete', () => {
    // The app does not delete device content, and a project sweep cannot see a
    // reference held anywhere else. Both facts have to survive into the wording.
    const complete = buildSampleUsage([project('a', [KICK])]);
    const partial = buildSampleUsage([project('a', [KICK]), { name: 'b', records: null }]);
    for (const verdict of [usage(complete, HAT), usage(partial, HAT), usage(complete, KICK)]) {
      expect(describeUsage(verdict, 'hat.wav').toLowerCase()).not.toContain('safe to delete');
    }
  });

  it('distinguishes "no project names it" from "nothing uses it"', () => {
    // The narrower claim is the only true one: path inspection is heuristic, a
    // preset may hold its own copy, and copies of these projects elsewhere are not
    // covered. Dropping that distinction is how a careful tool licenses a bad delete.
    const index = buildSampleUsage([project('a', [KICK])]);
    const text = describeUsage(usage(index, HAT), 'hat.wav');
    expect(text).toContain('No project on this device references hat.wav');
    expect(text).toContain('no project names it, not that nothing uses it');
    expect(text).toContain('path inspection is partial');
  });

  it('says unknown rather than unused when the sweep was incomplete', () => {
    const index = buildSampleUsage([project('a', [KICK]), { name: 'half written', records: null, problem: 'truncated' }]);
    const text = describeUsage(usage(index, HAT), 'hat.wav');
    expect(text).toContain('could not be checked (half written)');
    expect(text).toContain('unknown rather than unused');
  });
});

describe('listing the unreferenced', () => {
  it('lists them in order when the sweep was complete', () => {
    const index = buildSampleUsage([project('a', [KICK])]);
    expect(unreferencedAmong(index, [SNARE, KICK, HAT])).toEqual([HAT, SNARE]);
  });

  it('refuses to produce a list at all from an incomplete sweep', () => {
    // Returning a partial list is worse than returning nothing: it reads as
    // "these are the unused ones" and would be acted on.
    const index = buildSampleUsage([project('a', [KICK]), { name: 'b', records: null }]);
    expect(unreferencedAmong(index, [SNARE, KICK, HAT])).toBeNull();
  });

  it('records which projects were read and which were not', () => {
    const index = buildSampleUsage([
      project('a', [KICK]),
      { name: 'b', records: null, problem: 'truncated' },
      project('c', [SNARE]),
    ]);
    expect(index.scanned).toEqual(['a', 'c']);
    expect(index.unread).toEqual([{ name: 'b', problem: 'truncated' }]);
  });
});

/**
 * The inspector asks a narrower question than `usage`: does anything *other than the
 * project on screen* use this sample? Computing that by filtering the current project
 * out of a `referenced` verdict is the natural thing to do and is wrong — an empty
 * result reads as "nothing else uses it", which an unread project makes unfounded.
 * The first version of the inspector had exactly that bug.
 */
describe('sharing, relative to the project being inspected', () => {
  it('names the other projects and leaves out the one on screen', () => {
    const index = buildSampleUsage([project('monday jam', [KICK]), project('tuesday', [KICK]), project('sketch', [KICK])]);
    expect(sharingWith(index, KICK, 'monday jam')).toEqual({ state: 'referenced', projects: ['tuesday', 'sketch'] });
  });

  it('says nothing else uses it only when every project was read', () => {
    const index = buildSampleUsage([project('monday jam', [KICK]), project('tuesday', [SNARE])]);
    expect(sharingWith(index, KICK, 'monday jam')).toEqual({ state: 'unreferenced' });
  });

  it('will not say "this project only" while a project is unread', () => {
    const index = buildSampleUsage([
      project('monday jam', [KICK]),
      { name: 'half written', records: null, problem: 'truncated' },
    ]);
    // The unread project may be the other user of this very sample.
    expect(sharingWith(index, KICK, 'monday jam').state).toBe('indeterminate');
  });

  it('still names a definite sharer on an incomplete sweep', () => {
    const index = buildSampleUsage([
      project('monday jam', [KICK]),
      project('tuesday', [KICK]),
      { name: 'half written', records: null },
    ]);
    expect(sharingWith(index, KICK, 'monday jam')).toEqual({ state: 'referenced', projects: ['tuesday'] });
  });
});
