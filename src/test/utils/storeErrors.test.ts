import { describe, expect, it } from 'vitest';
import { describeStoreError } from '../../utils/indexedDB';

describe('what a failed write says', () => {
  it('names the cause and the fix when the engine refuses a Blob', () => {
    // The engine's own words are "Error preparing Blob/File data to be stored in
    // object store", which says nothing about why or what to do. Nothing the app
    // stores holds a Blob now, so this message exists for the regression, not today.
    const failure = describeStoreError(
      new DOMException('Error preparing Blob/File data to be stored in object store', 'UnknownError'),
      'presets',
    );
    expect(failure.message).toContain('will not store a Blob or File');
    expect(failure.message).toContain('Store the bytes instead');
    expect(failure.message).toContain('presets');
    // The original is kept, so nothing is hidden from whoever is debugging.
    expect(failure.message).toContain('Error preparing Blob/File data');
  });

  it('passes anything else through, named by store', () => {
    expect(describeStoreError(new DOMException('The quota has been exceeded.', 'QuotaExceededError'), 'samples').message)
      .toBe('Could not save to samples: The quota has been exceeded.');
  });

  it('says something useful even with no error to report', () => {
    expect(describeStoreError(null, 'sessions').message).toBe('Could not save to sessions: Unknown storage error');
  });
});
