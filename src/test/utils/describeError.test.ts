import { describe, it, expect } from 'vitest';
import { describeError, shortenHomePath, wrapError } from '../../utils/describeError';

describe('describeError', () => {
  it('keeps the sentence and drops the machinery', () => {
    expect(describeError(new Error('The recording changed size during the transfer. Refresh the device and try again.')))
      .toBe('The recording changed size during the transfer. Refresh the device and try again.');
    expect(describeError('A preset with this name already exists; choose a different name'))
      .toBe('A preset with this name already exists; choose a different name.');
  });

  it('strips stacked error prefixes that come back over IPC', () => {
    expect(describeError('Error: Error: USB disconnected')).toBe('USB disconnected.');
    expect(describeError(new Error('TypeError: decodeAudioData failed'))).toBe('decodeAudioData failed.');
    expect(describeError('InvalidStateError: the context is closed')).toBe('The context is closed.'.replace('The', 'the'));
  });

  it('shortens a home folder rather than showing a user name', () => {
    expect(describeError(new Error('Backup incomplete at /Users/nick/Music/backups/OP-XY-backup-1: disk full')))
      .toBe('Backup incomplete at ~/Music/backups/OP-XY-backup-1: disk full.');
  });

  it('reads a message off a plain rejection object', () => {
    expect(describeError({ message: 'Open your library first' })).toBe('Open your library first.');
  });

  it('never renders an empty or meaningless error', () => {
    expect(describeError(undefined)).toBe('Something went wrong, and no reason was reported.');
    expect(describeError(new Error('   '))).toBe('Something went wrong, and no reason was reported.');
    expect(describeError('')).toBe('Something went wrong, and no reason was reported.');
  });

  it('leaves existing punctuation alone', () => {
    expect(describeError('Is the device in transfer mode?')).toBe('Is the device in transfer mode?');
    expect(describeError('Reading…')).toBe('Reading…');
  });
});

describe('shortenHomePath', () => {
  it('replaces any home folder in a longer sentence', () => {
    expect(shortenHomePath('2 tracks written to /Users/nick/Music/tape. Copy them in.'))
      .toBe('2 tracks written to ~/Music/tape. Copy them in.');
  });

  it('leaves paths outside a home folder alone', () => {
    expect(shortenHomePath('/Volumes/Field/takes/a.wav')).toBe('/Volumes/Field/takes/a.wav');
    expect(shortenHomePath('presets/drum/kit.preset')).toBe('presets/drum/kit.preset');
  });

  it('does not mangle a bare home folder with nothing after it', () => {
    expect(shortenHomePath('/Users/nick')).toBe('/Users/nick');
  });
});

/**
 * Wrappers stacked. `readAudioMetadata` wrapped `readAudioMetadataFromArrayBuffer`
 * wrapped `parseWavMetadata`, and a three-byte file named `.wav` produced
 * "Failed to read audio metadata: Failed to read audio metadata: Failed to read WAV
 * metadata: Unknown error." Each layer was reasonable alone.
 */
describe('wrapError', () => {
  it('adds context when the cause does not explain itself', () => {
    expect(wrapError('Failed to read WAV metadata', new RangeError('offset 40 is out of bounds')).message)
      .toBe('Failed to read WAV metadata: offset 40 is out of bounds.');
  });

  it('does not prefix a message that already states a failure', () => {
    // The inner wording is the more specific of the two and should survive.
    expect(wrapError('Failed to read audio metadata', new Error('Failed to read WAV metadata: chunk missing')).message)
      .toBe('Failed to read WAV metadata: chunk missing.');
  });

  it('does not stack however many layers wrap it', () => {
    let error: unknown = new Error('not a WAV or AIFF recording');
    for (const prefix of ['Failed to parse AIF metadata', 'Failed to read audio metadata', 'Failed to read audio metadata']) {
      error = wrapError(prefix, error);
    }
    expect((error as Error).message).toBe('not a WAV or AIFF recording.');
  });

  it('never leaves the user with "Unknown error"', () => {
    // Every layer used to replace a non-Error with that phrase, so a thrown string
    // or object ended up as the least useful sentence available.
    for (const thrown of ['disk went away', { message: 'device detached' }, undefined, null]) {
      const message = wrapError('Failed to read audio metadata', thrown).message;
      expect(message).not.toContain('Unknown error');
      expect(message.length).toBeGreaterThan(10);
    }
  });

  it('keeps the prefix when the cause is merely a noun, not a failure', () => {
    expect(wrapError('Failed to read audio metadata', new Error('offset 40 out of bounds')).message)
      .toBe('Failed to read audio metadata: offset 40 out of bounds.');
  });
});
