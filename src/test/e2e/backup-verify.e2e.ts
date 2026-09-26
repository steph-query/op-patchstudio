import { test, expect } from '@playwright/test';

/**
 * Task 1 of `docs/companion-app-comparison.md`: back up a device, then verify the
 * backup detects a single corrupted byte.
 *
 * The detection itself is native and covered by `rejects_corruption_even_when_length_matches`,
 * which flips one bit and leaves the length identical. What had never been rendered is
 * the half the user actually experiences: whether a failed verification *looks* like a
 * failure. A checksum mismatch that arrives as a quiet line — or worse, alongside the
 * words "Backup verified" — is a corrupted backup the user will trust.
 *
 * So both outcomes are driven here, and the load-bearing assertion is that success
 * wording cannot appear when verification failed.
 */

const BACKUP = '/Users/fixture/Backups/Fieldwork OP-XY 2026-09-25';

/** The message the native verifier produces for a one-bit change. */
const CORRUPTION = `Backup verification failed for projects/user/Song.versions/old.xy in ${BACKUP}: recorded checksum does not match the file on disk. Do not restore from this backup; make a new one.`;

async function panelWith(page: import('@playwright/test').Page, verify: 'ok' | 'corrupt') {
  await page.addInitScript(`(() => {
    window.__TAURI__ = { core: { invoke: async (command) => {
      switch (command) {
        case 'verify_backup':
          ${verify === 'corrupt'
            ? `throw new Error(${JSON.stringify(CORRUPTION)});`
            : `return { path: ${JSON.stringify(BACKUP)}, files: 412, bytes: 734003200, firmware: '1.1.33', kind: 'op-xy' };`}
        default: return [];
      }
    } } };
  })()`);
  await page.goto('/');
  await page.getByRole('tab', { name: 'projects tab', exact: true }).click();
  return page.getByRole('region', { name: 'Device backups' });
}

test('a corrupted backup is reported as a failure, never alongside success', async ({ page }) => {
  const panel = await panelWith(page, 'corrupt');

  // Verifying works with nothing plugged in, which is what the panel promises.
  await expect(panel.getByText(/Existing backups can be verified offline/)).toBeVisible();
  const verify = panel.getByRole('button', { name: 'Verify backup…' });
  await expect(verify).toBeEnabled();
  await verify.click();

  // An alert, so it is announced rather than merely present.
  const alert = panel.getByRole('alert');
  await expect(alert).toBeVisible();
  await expect(alert).toContainText('verification failed');
  // The file is named: without it the user cannot tell what to replace.
  await expect(alert).toContainText('old.xy');
  await expect(alert).toContainText('Do not restore from this backup');

  // The property that matters. These must not coexist.
  await expect(panel.getByText('Backup verified')).toHaveCount(0);
  await expect(panel.getByRole('status')).toHaveCount(0);

  // And the message is readable: no Error: prefix, no spelled-out home folder.
  const text = (await alert.textContent()) ?? '';
  expect(text).not.toContain('Error:');
  expect(text).not.toContain('/Users/fixture');
  expect(text).toContain('~/Backups');
});

test('a clean backup verifies, and says what was checked', async ({ page }) => {
  const panel = await panelWith(page, 'ok');
  await panel.getByRole('button', { name: 'Verify backup…' }).click();

  const status = panel.getByRole('status');
  await expect(status).toContainText('Backup verified');
  await expect(status).toContainText('412 files');
  await expect(status).toContainText('1.1.33');
  // The converse of the test above.
  await expect(panel.getByRole('alert')).toHaveCount(0);
});
