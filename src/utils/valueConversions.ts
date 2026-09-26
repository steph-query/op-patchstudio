/**
 * Convert percentage to internal value (0-100% -> 0-32767)
 * Matches legacy percentToInternal function
 */
export function percentToInternal(percent: number): number {
  return Math.round((percent / 100) * 32767);
}

/**
 * Convert internal value to percentage (0-32767 -> 0-100%)
 * Matches legacy internalToPercent function
 */
export function internalToPercent(internal: number): number {
  return Math.round((internal / 32767) * 100);
}

/**
 * Keys that must never be merged from an imported file.
 *
 * `JSON.parse` creates `__proto__` as an ordinary own property, so a preset containing
 * `{"__proto__": {"x": 1}}` survives parsing intact. Assigning it — or worse, recursing
 * into `target['__proto__']`, which is `Object.prototype` and passes an `is object` check —
 * writes onto the prototype every object in the app inherits from. `constructor` reaches
 * the same place by another route.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Deep merge an imported preset's settings into the base patch JSON.
 *
 * **The source is a file the user did not write.** Presets are shared on forums and
 * sound-pack sites — the research in `docs/te-companion-feature-research.md` cites several —
 * so this is untrusted input, and it reaches here from `importPresetFromFile` by way of
 * `mergeImportedSettings`. The previous version used `for...in` with no key filtering:
 * importing a crafted preset polluted `Object.prototype`, and because the generated
 * `patch.json` is an ordinary object, the injected keys were then **written to the
 * instrument** with every patch the user produced afterwards.
 *
 * `Object.keys` rather than `for...in` also stops inherited enumerable properties being
 * merged, which is the same class of surprise from the other direction.
 */
export function deepMerge(target: any, source: any): void {
  if (!source || typeof source !== 'object') return;
  for (const key of Object.keys(source)) {
    if (UNSAFE_KEYS.has(key)) continue;
    const value = source[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
      }
      deepMerge(target[key], value);
    } else {
      target[key] = value;
    }
  }
} 