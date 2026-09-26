import { test, expect } from '@playwright/test';

/**
 * A half-built kit must survive quitting the app.
 *
 * `docs/hardware-test-guide.md` calls this out as the failure worth reporting: "Session
 * saving stores sample audio in the browser database, and a WebKit build that refuses one
 * of the shapes it used to store would lose the kit silently." That has already happened
 * twice in this work — some WebKit builds reject a Blob or File in IndexedDB outright, and
 * the error message names neither.
 *
 * It is the one scenario a component test cannot cover, because the risk *is* the engine:
 * a jsdom fake-IndexedDB accepts shapes that real WebKit refuses. So this round-trips
 * through an actual reload in the browser Tauri renders in, with real IndexedDB.
 */

function monoWav(frames = 8820) {
  const bytes = 44 + frames * 2;
  const buffer = Buffer.alloc(bytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(bytes - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(44100, 24); buffer.writeUInt32LE(88200, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame++) buffer.writeInt16LE(Math.round(Math.sin(frame / 12) * 9000), 44 + frame * 2);
  return buffer;
}


/**
 * Wait until the stored session is actually *restorable*: the record exists and every
 * sample it references has its bytes in the samples store.
 *
 * Waiting for the record alone is not enough, and finding that out was the useful part.
 * The session row is written before the sample bytes land, and on the next launch
 * `clearCorruptedData` checks every referenced sample and discards the whole session if
 * one is missing — correctly, because a session whose audio is gone would restore as a
 * kit of silent pads. So a test that reloads as soon as the row appears sees no prompt at
 * all, and the app is right rather than wrong.
 */
async function restorableSession(page: import('@playwright/test').Page) {
  await expect.poll(async () => page.evaluate(async () => {
    const open = indexedDB.open('op-patchstudio-db');
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    if (!db.objectStoreNames.contains('sessions')) return -1;
    const read = <T>(store: string, get: (s: IDBObjectStore) => IDBRequest) =>
      new Promise<T | null>(resolve => {
        const request = get(db.transaction([store], 'readonly').objectStore(store));
        request.onsuccess = () => resolve(request.result as T);
        request.onerror = () => resolve(null);
      });
    const sessions = (await read<Array<{ drumSamples?: Array<{ sampleId: string }> }>>('sessions', s => s.getAll())) ?? [];
    const session = sessions[0];
    if (!session?.drumSamples?.length) return 0;
    for (const stored of session.drumSamples) {
      const sample = await read<{ id: string } | undefined>('samples', s => s.get(stored.sampleId));
      // A referenced sample with no bytes means the session is not yet whole.
      if (!sample) return 0;
    }
    return session.drumSamples.length;
  }), { timeout: 20_000 }).toBeGreaterThan(0);
}

test('a kit built before a restart is offered back, with its audio intact', async ({ page }) => {
  // Collect anything the app logs: a storage failure is reported to the console, and a
  // silent loss is exactly what this test exists to catch.
  const problems: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error') problems.push(message.text());
  });

  await page.goto('/');
  await page.getByRole('tab', { name: /^drum/ }).click();

  page.on('filechooser', chooser => chooser.setFiles([
    { name: 'thump.wav', mimeType: 'audio/wav', buffer: monoWav() },
    { name: 'clack.wav', mimeType: 'audio/wav', buffer: monoWav(4410) },
  ]));
  await page.getByText('drop samples here or click to browse').first().click();
  await expect(page.getByText('2 / 24 loaded')).toBeVisible();
  await page.getByPlaceholder(/preset name/i).first().fill('yard kit');

  // Written on a debounce, so wait for the state rather than a fixed sleep.
  await restorableSession(page);

  // Writing the session must not have failed. This is the assertion that catches the
  // Blob/File refusal: the kit looks fine on screen and the record never reached disk.
  expect(problems.filter(text => /blob|file|object store|indexeddb/i.test(text)), 'storage errors while saving the session').toEqual([]);

  // Now quit and come back.
  await page.reload();

  const modal = page.getByRole('dialog', { name: /restore|previous session/i });
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('2');
  await modal.getByRole('button', { name: 'restore', exact: true }).click();

  // The kit is back — both pads, and the name that was typed.
  await expect(page.getByText('2 / 24 loaded')).toBeVisible();
  await expect(page.getByText('thump.wav').first()).toBeVisible();
  await expect(page.getByText('clack.wav').first()).toBeVisible();
  await expect(page.getByPlaceholder(/preset name/i).first()).toHaveValue('yard kit');

  // And nothing failed on the way back in, either.
  expect(problems.filter(text => /blob|file|object store|indexeddb/i.test(text)), 'storage errors while restoring').toEqual([]);
});

test('declining leaves you with an empty kit rather than a half-restored one', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /^drum/ }).click();
  page.on('filechooser', chooser => chooser.setFiles({ name: 'thump.wav', mimeType: 'audio/wav', buffer: monoWav() }));
  await page.getByText('drop samples here or click to browse').first().click();
  await expect(page.getByText('1 / 24 loaded')).toBeVisible();

  await restorableSession(page);

  await page.reload();
  const modal = page.getByRole('dialog', { name: /restore|previous session/i });
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'start new' }).click();

  await expect(modal).toHaveCount(0);
  await expect(page.getByText('0 / 24 loaded')).toBeVisible();
  // And it does not ask again on the same visit.
  await expect(page.getByRole('dialog', { name: /restore|previous session/i })).toHaveCount(0);
});
