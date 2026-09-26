import { describe, it, expect, afterEach } from 'vitest'
import { 
  percentToInternal, 
  internalToPercent, 
  deepMerge 
} from '../../utils/valueConversions'
import { mergeImportedSettings } from '../../utils/jsonImport';

describe('valueConversions', () => {
  describe('percentToInternal', () => {
    it('should convert 0% to 0', () => {
      expect(percentToInternal(0)).toBe(0)
    })

    it('should convert 50% to approximately 16384 (half of 32767)', () => {
      expect(percentToInternal(50)).toBe(16384)
    })

    it('should convert 100% to 32767', () => {
      expect(percentToInternal(100)).toBe(32767)
    })

    it('should handle values outside 0-100 range', () => {
      expect(percentToInternal(-10)).toBe(-3277)
      expect(percentToInternal(150)).toBe(49151)
    })

    it('should handle decimal percentages', () => {
      expect(percentToInternal(25.5)).toBe(8356)
    })
  })

  describe('internalToPercent', () => {
    it('should convert 0 to 0%', () => {
      expect(internalToPercent(0)).toBe(0)
    })

    it('should convert 16384 to approximately 50%', () => {
      expect(internalToPercent(16384)).toBe(50)
    })

    it('should convert 32767 to 100%', () => {
      expect(internalToPercent(32767)).toBe(100)
    })

    it('should handle values outside 0-32767 range', () => {
      expect(internalToPercent(-3277)).toBe(-10)
      expect(internalToPercent(49151)).toBe(150)
    })

    it('should round to nearest whole percent', () => {
      expect(internalToPercent(16383)).toBe(50) // Should round to 50
      expect(internalToPercent(16385)).toBe(50) // Should round to 50
    })
  })

  describe('deepMerge', () => {
    it('should merge simple objects', () => {
      const target = { a: 1, b: 2 }
      const source = { c: 3, d: 4 }
      
      deepMerge(target, source)
      
      expect(target).toEqual({ a: 1, b: 2, c: 3, d: 4 })
    })

    it('should overwrite primitive values', () => {
      const target = { a: 1, b: 2 }
      const source = { a: 10, c: 3 }
      
      deepMerge(target, source)
      
      expect(target).toEqual({ a: 10, b: 2, c: 3 })
    })

    it('should merge nested objects recursively', () => {
      const target = {
        engine: { volume: 50, pan: 0 },
        fx: { type: 'reverb' }
      }
      const source = {
        engine: { volume: 75, width: 100 },
        envelope: { attack: 10 }
      }
      
      deepMerge(target, source)
      
      expect(target).toEqual({
        engine: { volume: 75, pan: 0, width: 100 },
        fx: { type: 'reverb' },
        envelope: { attack: 10 }
      })
    })

    it('should handle deeply nested objects', () => {
      const target = {
        level1: {
          level2: {
            level3: { a: 1, b: 2 }
          }
        }
      }
      const source = {
        level1: {
          level2: {
            level3: { b: 20, c: 30 }
          }
        }
      }
      
      deepMerge(target, source)
      
      expect(target.level1.level2.level3).toEqual({ a: 1, b: 20, c: 30 })
    })

    it('should handle arrays by overwriting them (not merging)', () => {
      const target = { params: [1, 2, 3] }
      const source = { params: [4, 5] }
      
      deepMerge(target, source)
      
      expect(target.params).toEqual([4, 5])
    })

    it('should create missing nested objects', () => {
      const target = { existing: 'value' }
      const source = {
        new: {
          nested: {
            deep: 'value'
          }
        }
      }
      
      deepMerge(target, source)
      
      expect(target).toEqual({
        existing: 'value',
        new: {
          nested: {
            deep: 'value'
          }
        }
      })
    })

    it('should handle null and undefined values', () => {
      const target = { a: 1, b: null, c: undefined }
      const source = { b: 2, c: 3, d: null, e: undefined }
      
      deepMerge(target, source)
      
      expect(target).toEqual({ a: 1, b: 2, c: 3, d: null, e: undefined })
    })

    it('should replace object with non-object', () => {
      const target = { config: { nested: 'value' } }
      const source = { config: 'simple string' }
      
      deepMerge(target, source)
      
      expect(target.config).toBe('simple string')
    })
  })
})

/**
 * The source of this merge is a file the user did not write.
 *
 * Presets are shared on forums and sound-pack sites, and `importPresetFromFile` feeds them
 * to `mergeImportedSettings`, which calls `deepMerge`. The previous implementation used
 * `for...in` with no key filtering, and `JSON.parse` keeps `__proto__` as an ordinary own
 * property — so importing a crafted preset wrote onto `Object.prototype`. Since the
 * generated `patch.json` is an ordinary object, the injected keys were then **written to
 * the instrument** with every patch produced afterwards.
 */
describe('deepMerge with untrusted input', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).polluted;
    delete (Object.prototype as Record<string, unknown>).injected;
  });

  it('refuses __proto__ from a parsed preset', () => {
    const target: Record<string, unknown> = { engine: {} };
    // Exactly what JSON.parse produces for a preset file containing this key.
    deepMerge(target, JSON.parse('{"__proto__": {"polluted": "yes"}}'));
    expect(({} as Record<string, unknown>).polluted, 'a crafted preset polluted every object in the app').toBeUndefined();
  });

  it('refuses constructor.prototype, which reaches the same place', () => {
    deepMerge({}, JSON.parse('{"constructor": {"prototype": {"polluted": "yes"}}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not merge inherited properties, only the file\'s own', () => {
    const inherited = Object.create({ injected: 'from the prototype' });
    inherited.real = 'from the file';
    const target: Record<string, unknown> = {};
    deepMerge(target, inherited);
    expect(target.real).toBe('from the file');
    expect(target.injected, 'an inherited key is not part of the imported file').toBeUndefined();
  });

  it('still merges everything a preset legitimately carries', () => {
    // The guard must not cost the feature: nested objects, arrays and scalars all through.
    const target: Record<string, unknown> = { engine: { transpose: 0, playmode: 'poly' }, keep: true };
    deepMerge(target, { engine: { transpose: -12 }, regions: [{ sample: 'kick.wav' }], name: 'Kit' });
    expect(target).toEqual({
      engine: { transpose: -12, playmode: 'poly' },
      regions: [{ sample: 'kick.wav' }],
      name: 'Kit',
      keep: true,
    });
  });

  it('survives a source that is not an object at all', () => {
    const target: Record<string, unknown> = { a: 1 };
    for (const nonsense of [null, undefined, 'string', 42]) {
      expect(() => deepMerge(target, nonsense)).not.toThrow();
    }
    expect(target).toEqual({ a: 1 });
  });
});

/** And the same, through the function `patchGeneration` actually calls. */
describe('the live import chain', () => {
  afterEach(() => { delete (Object.prototype as Record<string, unknown>).polluted; });

  it('cannot be used to pollute every object via an imported preset', () => {
    // `patchGeneration` calls this with `state.importedDrumPresetJson` — a parsed file.
    const patchJson: Record<string, unknown> = { engine: {}, regions: [] };
    const imported = JSON.parse('{"engine": {"__proto__": {"polluted": "yes"}}, "__proto__": {"polluted": "yes"}}');
    mergeImportedSettings(patchJson, imported);
    expect(({} as Record<string, unknown>).polluted, 'the live merge path polluted Object.prototype').toBeUndefined();
  });
});

/**
 * What the consolidated merge carries over, and what it leaves alone.
 *
 * There used to be two identical copies of this — one named for drums, one for multisamples —
 * and nothing tested either. Both base patches carry the same sections, so there was never a
 * difference to express; keeping two copies is how a fix reaches one caller and not the other,
 * which is exactly what happened to `validatePresetJson` in the same file.
 */
describe('mergeImportedSettings', () => {
  const base = () => ({
    type: 'drum',
    engine: { transpose: 0, playmode: 'poly' },
    envelope: { amp: { attack: 0 } },
    fx: {}, lfo: {}, octave: 0,
    regions: [{ sample: 'kick.wav' }],
  });

  it('carries over the sections a preset may set', () => {
    const patch = base();
    mergeImportedSettings(patch, { engine: { transpose: -12 }, envelope: { amp: { attack: 500 } } } as never);
    expect(patch.engine).toEqual({ transpose: -12, playmode: 'poly' });
    expect(patch.envelope).toEqual({ amp: { attack: 500 } });
  });

  it('leaves the regions and the type alone', () => {
    // A preset's own regions are the app's, not the imported file's — an import that could
    // replace them would silently change which samples the patch points at.
    const patch = base();
    mergeImportedSettings(patch, { regions: [{ sample: 'not-mine.wav' }], type: 'multisampler' } as never);
    expect(patch.regions).toEqual([{ sample: 'kick.wav' }]);
    expect(patch.type).toBe('drum');
  });

  it('does nothing at all without an imported preset', () => {
    const patch = base();
    const before = JSON.parse(JSON.stringify(patch));
    mergeImportedSettings(patch, undefined);
    expect(patch).toEqual(before);
  });

  it('ignores a section the preset does not carry', () => {
    const patch = base();
    mergeImportedSettings(patch, { engine: { transpose: 5 } } as never);
    expect(patch.envelope).toEqual({ amp: { attack: 0 } });
  });
});
