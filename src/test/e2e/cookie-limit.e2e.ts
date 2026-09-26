import { test, expect } from '@playwright/test';

/**
 * A cookie over roughly 4 KB is discarded by the browser **without an error**.
 *
 * Every persisted setting in this app goes through `cookieUtils.setCookie`, including the
 * imported-preset JSON, which can be large. Silent discard means the setting is simply gone
 * on the next launch with nothing said — so `setCookie` now round-trips the value and
 * returns whether it stuck.
 *
 * This has to run in a real engine: jsdom does not enforce the limit, so the unit test can
 * only assert the mechanism. WebKit is the engine Tauri renders in.
 */
test('setCookie reports a value too large for the browser to keep', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(() => {
    const set = (name: string, value: string) => {
      document.cookie = `${name}=${encodeURIComponent(value)};path=/`;
      const found = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${name}=`));
      const raw = found ? found.slice(name.length + 1) : null;
      let readBack: string | null = null;
      try { readBack = raw === null ? null : decodeURIComponent(raw); } catch { readBack = raw; }
      return readBack === value;
    };
    return {
      small: set('fw_small', JSON.stringify({ ok: true })),
      // Comfortably past the limit, so this is not a borderline measurement.
      huge: set('fw_huge', JSON.stringify({ blob: 'x'.repeat(9000) })),
    };
  });
  expect(result.small, 'a small value must store and read back').toBe(true);
  expect(result.huge, 'an oversized value must be detected as not stored').toBe(false);
});
