// Simple cookie utility functions
export const cookieUtils = {
  // Set a cookie with expiration
  /** Returns whether the value is actually readable back afterwards. */
  setCookie: (name: string, value: string, days: number = 30): boolean => {
    try {
      const date = new Date();
      date.setTime(date.getTime() + (days * 24 * 60 * 60 * 1000));
      const expires = `expires=${date.toUTCString()}`;
      // Encode the value. Every caller stores JSON, and a `;` terminates a cookie — so a
      // preset named "kick;snare" truncated the stored settings to invalid JSON, which the
      // reader's `JSON.parse` then threw on, silently replacing the user's saved settings
      // with defaults. Commas, equals signs, newlines and non-ASCII names had the same
      // problem waiting.
      document.cookie = `${name}=${encodeURIComponent(value)};${expires};path=/`;

      // A cookie over roughly 4 KB is discarded by the browser without an error, so the
      // only way to know it stuck is to look. Callers get a boolean rather than silence.
      const stored = cookieUtils.getCookie(name);
      if (stored !== value) {
        console.warn(`Cookie "${name}" did not store (${encodeURIComponent(value).length} bytes; the limit is about 4 KB).`);
        return false;
      }
      return true;
    } catch (error) {
      console.warn('Failed to set cookie (cookies may be disabled):', error);
      return false;
    }
  },

  // Get a cookie value
  getCookie: (name: string): string | null => {
    try {
      const nameEQ = `${name}=`;
      const ca = document.cookie.split(';');
      for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) {
          const raw = c.substring(nameEQ.length, c.length);
          // Cookies written before values were encoded are plain JSON, and decoding those
          // is a no-op unless they happen to contain a `%` followed by two hex digits — so
          // fall back to the raw text rather than losing settings on a malformed sequence.
          try {
            return decodeURIComponent(raw);
          } catch {
            return raw;
          }
        }
      }
      return null;
    } catch (error) {
      console.warn('Failed to read cookie (cookies may be disabled):', error);
      return null;
    }
  },

  // Remove a cookie
  removeCookie: (name: string) => {
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
  }
};

// Cookie keys used in the app
export const COOKIE_KEYS = {
  LAST_TAB: 'opxy_last_tab',
  DRUM_KEYBOARD_PINNED: 'opxy_drum_keyboard_pinned',
  MULTISAMPLE_KEYBOARD_PINNED: 'opxy_multisample_keyboard_pinned',
  MIDI_NOTE_MAPPING: 'opxy_midi_note_mapping',
  DRUM_DEFAULT_SETTINGS: 'opxy_drum_default_settings',
  MULTISAMPLE_DEFAULT_SETTINGS: 'opxy_multisample_default_settings',
  // Add other cookie keys here as needed
} as const; 