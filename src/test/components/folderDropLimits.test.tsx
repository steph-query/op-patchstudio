import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MultisampleSampleTable, MAX_FILES_SCANNED, MAX_FOLDER_DEPTH } from '../../components/multisample/MultisampleSampleTable';
import { AppContextProvider } from '../../context/AppContext';

/**
 * Dropping a folder used to walk it without any bound.
 *
 * `processEntry` recursed with no depth limit and collected files with no cap, so a symlink
 * cycle — which `webkitGetAsEntry` can expose — recursed until the app died, and dropping a
 * whole sample library read every file into memory as a `File` before any filtering. The
 * sample lab holds **twenty-four zones**, so nearly all of that work was thrown away.
 *
 * These fixtures are the shapes that hurt: a directory that contains itself, and one with
 * far more files than the cap.
 */

/**
 * A fake `FileSystemFileEntry` that records being read.
 *
 * The walk's own behaviour is what is under test, so the fixtures count visits. Asserting on
 * loaded zones instead would depend on audio decoding a one-byte fake file, and asserting on
 * the notification would depend on `NotificationSystem` being in the tree — neither is what
 * these tests are about, and an earlier version of this file passed while doing nothing
 * because it asserted on a surface that could never appear.
 */
function fileEntry(name: string, visits: { count: number }) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (cb: (f: File) => void) => {
      visits.count++;
      cb(new File([new Uint8Array([1])], name, { type: 'audio/wav' }));
    },
  };
}

/** A fake `FileSystemDirectoryEntry` whose children are produced on demand. */
function dirEntry(name: string, children: () => unknown[], visits?: { dirs: number }) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    __visit: () => { if (visits) visits.dirs++; },
    createReader: () => {
      let served = false;
      return {
        readEntries: (cb: (entries: unknown[]) => void) => {
          if (!served && visits) visits.dirs++;
          // The real API returns batches and then an empty array.
          cb(served ? [] : children());
          served = true;
        },
      };
    },
  };
}

function dropWith(entry: unknown) {
  const items = [{ webkitGetAsEntry: () => entry }];
  return { dataTransfer: { items, files: [], types: ['Files'] } };
}

function renderTable() {
  render(
    <AppContextProvider>
      <MultisampleSampleTable
        onFileUpload={vi.fn()}
        onClearSample={vi.fn()}
        onRecordSample={vi.fn()}
        onFilesSelected={vi.fn()}
      />
    </AppContextProvider>,
  );
  // The drop handler sits on the empty-state area. React delegates events, so firing on the
  // text inside it reaches the handler — and locating it by what the user sees means the test
  // cannot silently target the wrong element and pass by doing nothing.
  return screen.getByText(/drag and drop .*files here/i);
}

describe('dropping a folder', () => {
  it('terminates on a directory that contains itself', { timeout: 20_000 }, async () => {
    // Before the depth limit this recursed until the stack or the heap gave out.
    const visits = { count: 0, dirs: 0 };
    const cycle: Record<string, unknown> = {};
    Object.assign(cycle, dirEntry('loop', () => [cycle, fileEntry('kick.wav', visits)], visits));

    const target = renderTable();
    fireEvent.drop(target, dropWith(cycle));

    // It entered the folder, found the file inside, and stopped — bounded by the depth cap
    // rather than running until something broke.
    await waitFor(() => expect(visits.count).toBeGreaterThan(0), { timeout: 10_000 });
    expect(visits.dirs, 'the walk followed the cycle past its depth limit').toBeLessThanOrEqual(MAX_FOLDER_DEPTH + 2);
    expect(visits.count, 'the file inside the cycle was read once per level and no more').toBeLessThanOrEqual(MAX_FOLDER_DEPTH + 2);
  });

  it('stops reading files at the cap', { timeout: 20_000 }, async () => {
    const visits = { count: 0, dirs: 0 };
    const many = dirEntry('library', () => Array.from({ length: MAX_FILES_SCANNED + 200 }, (_, i) => fileEntry(`s${i}.wav`, visits)), visits);
    const target = renderTable();
    fireEvent.drop(target, dropWith(many));

    await waitFor(() => expect(visits.count).toBeGreaterThan(10), { timeout: 10_000 });
    // Settle, then check it stopped rather than reading all seven hundred.
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(visits.count, 'the walk read past its own cap').toBeLessThanOrEqual(MAX_FILES_SCANNED);
  });
});
