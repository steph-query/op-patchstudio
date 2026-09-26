/**
 * Turn whatever was thrown into something worth showing a musician.
 *
 * The experience contract says an error names the cause and the next action in
 * the user's words. Most of this app's messages already do — they are written
 * that way in the native layer — but `String(error)` on an `Error` prefixes
 * them with "Error: ", which is noise, and home folders render as
 * `/Users/<name>/…` where `~/…` reads better. Both are cheap to fix in one
 * place rather than at 34 call sites.
 */

/** Strip the machinery from a thrown value, leaving the sentence. */
export function describeError(value: unknown): string {
  let text: string;
  if (value instanceof Error) {
    text = value.message;
  } else if (typeof value === 'string') {
    text = value;
  } else if (value && typeof value === 'object' && 'message' in value && typeof (value as { message: unknown }).message === 'string') {
    text = (value as { message: string }).message;
  } else {
    text = String(value);
  }
  // Tauri and nested rethrows can stack these prefixes.
  while (/^\s*(Error|TypeError|RangeError|InvalidStateError|NotSupportedError):\s*/i.test(text)) {
    text = text.replace(/^\s*[A-Za-z]*Error:\s*/, '');
  }
  text = shortenHomePath(text.trim());
  // `String(undefined)` and friends would otherwise be shown verbatim.
  if (!text || ['undefined', 'null', 'NaN', '[object Object]'].includes(text)) {
    return 'Something went wrong, and no reason was reported.';
  }
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

/** Show `~/Music/Fieldwork Library` rather than someone's user name. */
export function shortenHomePath(text: string): string {
  return text.replace(/\/Users\/[^/\s]+(?=\/)/g, '~');
}

/**
 * Add context to a thrown error without stacking prefixes.
 *
 * Three layers each wrapped the one below — `readAudioMetadata` wrapped
 * `readAudioMetadataFromArrayBuffer` wrapped `parseWavMetadata` — and a broken file
 * produced "Failed to read audio metadata: Failed to read audio metadata: Failed to
 * read WAV metadata: Unknown error." Each layer was individually reasonable; the
 * result was unreadable, and it ended on "Unknown error" because every layer also
 * replaced a non-Error with that phrase instead of describing it.
 *
 * So: describe the cause once, and add the prefix only when it says something the
 * message does not already say.
 */
export function wrapError(prefix: string, error: unknown): Error {
  const described = describeError(error);
  if (alreadyExplained(described, prefix)) return new Error(described);
  return new Error(`${prefix}: ${described}`);
}

/**
 * Whether a message already states a failure, making another prefix redundant.
 *
 * Matching the prefix text alone is not enough: "Failed to read audio metadata" and
 * "Failed to read WAV metadata" are different strings saying the same thing at
 * different granularity, and the inner one is the more specific of the two. So the
 * test is whether the message *opens with a failure phrase at all* — if it does, it
 * is already a described failure and the more specific wording should survive.
 */
function alreadyExplained(described: string, prefix: string): boolean {
  const lower = described.toLowerCase();
  if (lower.startsWith(prefix.toLowerCase().replace(/[:\s]+$/, ''))) return true;
  return /^(failed to|could not|cannot|can't|unable to|unsupported|not a |no )/.test(lower);
}
