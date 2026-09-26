import { describe, it, expect, beforeEach } from 'vitest';
import { cookieUtils } from '../../utils/cookies';

describe('cookie round trip', () => {
  beforeEach(() => {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  });

  it('survives a plain value', () => {
    cookieUtils.setCookie('plain', 'hello');
    expect(cookieUtils.getCookie('plain')).toBe('hello');
  });

  it('survives JSON, which is what every caller stores', () => {
    const json = JSON.stringify({ presetName: 'kick', transpose: -12 });
    cookieUtils.setCookie('asjson', json);
    expect(cookieUtils.getCookie('asjson')).toBe(json);
  });

  it('survives a preset name containing a semicolon', () => {
    // A `;` terminates a cookie, so an unencoded value is truncated there.
    const json = JSON.stringify({ presetName: 'kick;snare' });
    cookieUtils.setCookie('withsemi', json);
    expect(cookieUtils.getCookie('withsemi'), 'a semicolon in the value truncated the cookie').toBe(json);
  });

  it('survives a value with a comma and an equals sign', () => {
    const json = JSON.stringify({ presetName: 'a,b=c' });
    cookieUtils.setCookie('withpunct', json);
    expect(cookieUtils.getCookie('withpunct')).toBe(json);
  });

  it('survives a non-ASCII preset name', () => {
    const json = JSON.stringify({ presetName: 'Été 鐘 kit' });
    cookieUtils.setCookie('unicode', json);
    expect(cookieUtils.getCookie('unicode')).toBe(json);
  });

  it('still reads a cookie written before values were encoded', () => {
    // Existing installs have plain JSON in these cookies; decoding must not break them.
    document.cookie = 'legacy={"presetName":"kick"};path=/';
    expect(cookieUtils.getCookie('legacy')).toBe('{"presetName":"kick"}');
  });

  it('does not lose a legacy value containing a stray percent sign', () => {
    // `decodeURIComponent('100%25')` is fine, but `'100%2'` throws — so the reader falls
    // back to the raw text rather than dropping the setting.
    document.cookie = 'stray=100%2;path=/';
    expect(cookieUtils.getCookie('stray')).toBe('100%2');
  });

  it('reports whether the value can actually be read back', () => {
    // The return value is a round-trip check rather than a guess, which is what lets a
    // caller notice a failure. jsdom does not enforce the browser's ~4 KB cookie limit, so
    // the oversized case is asserted in WebKit instead — see `cookie-limit.e2e.ts`.
    expect(cookieUtils.setCookie('fits', JSON.stringify({ ok: true }))).toBe(true);
    expect(cookieUtils.getCookie('fits')).toBe(JSON.stringify({ ok: true }));
  });
});

/**
 * The save-as-default flow shows a success notification, so the result has to be real.
 *
 * `saveDrumSettingsAsDefault` stores its JSON in a cookie, and the JSON includes the
 * imported preset — the large part. A browser discards an oversized cookie without an
 * error, so before this the flow reported "drum settings saved as default" for something
 * that had not saved.
 */
describe('saving settings as default reports what happened', () => {
  beforeEach(() => {
    for (const c of document.cookie.split(';')) {
      const name = c.split('=')[0].trim();
      if (name) document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
    }
  });

  it('returns true when the settings fit', async () => {
    const { saveDrumSettingsAsDefault } = await import('../../utils/defaultSettings');
    const { defaultDrumSettings } = await import('../../utils/defaultSettings');
    expect(saveDrumSettingsAsDefault(defaultDrumSettings, null)).toBe(true);
  });

  it('does not lose every setting because one name contains a semicolon', async () => {
    const { saveDrumSettingsAsDefault, loadDrumDefaultSettings, defaultDrumSettings } =
      await import('../../utils/defaultSettings');
    // The preset name is stored and then deliberately cleared on load — a *default* should
    // not carry one specific name. But it is stored, so before values were encoded a `;` in
    // it truncated the cookie into invalid JSON and the loader's `JSON.parse` threw, taking
    // the sample rate, bit depth and everything else down with it.
    const settings = { ...defaultDrumSettings, presetName: 'kick;snare', sampleRate: 22050, bitDepth: 24 };
    expect(saveDrumSettingsAsDefault(settings, null)).toBe(true);

    const loaded = loadDrumDefaultSettings();
    expect(loaded.sampleRate, 'a semicolon in the name lost the other settings').toBe(22050);
    expect(loaded.bitDepth).toBe(24);
    // And the name is cleared by design rather than by accident.
    expect(loaded.presetName).toBe('');
  });
});
