import { test, expect } from '@playwright/test';

/**
 * Setting a zone's root note, which is how a multisample set is mapped.
 *
 * Changing a root note re-sorts the list. Enter used to commit and *then* blur, and
 * the blur committed again from a closure React had not re-rendered — so the second
 * commit landed on whichever sample had just moved into that row. Pressing Enter
 * after setting one zone's key silently gave a different zone the same key, which
 * is a mis-mapped instrument that plays wrong and looks right.
 */
function wav(seconds: number, frequency: number) {
  const rate = 44100, frames = Math.round(seconds * rate), bytes = 44 + frames * 2;
  const buffer = Buffer.alloc(bytes);
  buffer.write('RIFF', 0); buffer.writeUInt32LE(bytes - 8, 4); buffer.write('WAVE', 8);
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36); buffer.writeUInt32LE(frames * 2, 40);
  for (let i = 0; i < frames; i++) buffer.writeInt16LE(Math.round(Math.sin((i * frequency) / rate * 6.283) * 9000), 44 + i * 2);
  return buffer;
}

test('setting one zone’s key leaves every other zone alone', async ({ page }) => {
  await page.addInitScript(() => Object.assign(window, { __TAURI__: { core: { invoke: async () => [] } } }));
  await page.goto('/');
  await page.getByRole('tab', { name: 'multisample tab', exact: true }).click();

  page.on('filechooser', chooser => chooser.setFiles([
    { name: 'pad c2.wav', mimeType: 'audio/wav', buffer: wav(0.4, 65) },
    { name: 'pad c3.wav', mimeType: 'audio/wav', buffer: wav(0.4, 131) },
  ]));
  await page.getByText(/drop|browse|choose/i).first().click();
  await expect(page.getByText('2 / 24 loaded')).toBeVisible({ timeout: 20_000 });

  // The names carry their own pitches, so both start in agreement.
  await expect(page.getByText(/note in the filename/)).toHaveCount(0);

  const key = page.getByPlaceholder('C4 or 60').first();
  await key.fill('G5');
  await key.press('Enter');

  // Exactly one zone moved, and the warning names exactly that one.
  const warning = page.getByText(/note in the filename/);
  await expect(warning).toContainText('1 file has a note in the filename that differs from its root note');
  await expect(warning).toContainText('pad c2.wav says C2, mapped to G5');
  await expect(warning).not.toContainText('pad c3.wav');

  // And the untouched zone still reads C3.
  const keys = await page.getByPlaceholder('C4 or 60').evaluateAll(inputs =>
    (inputs as HTMLInputElement[]).map(input => input.value).sort());
  expect(keys).toEqual(['C3', 'G5']);
});
