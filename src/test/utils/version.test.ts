import { describe, it, expect, vi } from 'vitest';
import { getAppVersion } from '../../utils/version';

describe('getAppVersion', () => {
  it('works offline without fetching the removed PWA manifest', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    expect(await getAppVersion()).toBe(__APP_VERSION__);
    expect(fetch).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
