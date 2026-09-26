import { test, expect } from '@playwright/test';

/**
 * Task 4 of `docs/companion-app-comparison.md`: find every project that references
 * one sample, then decide whether it is safe to delete.
 *
 * The inspector could only answer the forward question — what does *this* project
 * need — and said so honestly ("this report does not establish that other files are
 * safe to delete"). Answering the asked question meant opening every project and
 * comparing by eye. The sweep does it in one action, and the important half of the
 * behaviour is what it refuses to claim: one unreadable project makes every negative
 * answer provisional, because that project is as likely as any other to be the only
 * thing holding a sample.
 *
 * Two projects here are readable and one is not, so both halves are on screen at once.
 */

/**
 * A .xy file: the magic header, then the ASCII paths the reader picks up.
 *
 * A *single* NUL separates segments **within** one path — the format stores a path
 * as pieces that concatenate, and `readPath` joins them — so a double NUL is what
 * ends a path. Writing one NUL between paths yields a single reference with all of
 * them run together, which is exactly what the first version of this fixture did.
 */
function xy(paths: string[]): Buffer {
  const head = Buffer.from([0xdd, 0xcc, 0xbb, 0xaa]);
  const body = Buffer.concat(paths.map(path => Buffer.concat([Buffer.from(path, 'ascii'), Buffer.from([0, 0])])));
  // Padding keeps the parser reading a realistic amount of surrounding bytes.
  return Buffer.concat([head, Buffer.alloc(64), body, Buffer.alloc(64)]);
}

const SHARED = '/fat32/samples/user/kick.wav';
const LONELY = '/fat32/samples/user/shaker.wav';

test('one action says which projects share a sample, and refuses to guess when one cannot be read', async ({ page }) => {
  const files: Record<number, number[]> = {
    // Two readable projects. Both use the shared kick; only the first uses the shaker.
    101: [...xy([SHARED, LONELY, SHARED])],
    102: [...xy([SHARED, '/fat32/presets/drum/kit.preset/snare.wav'])],
    // A third with no recognizable header at all.
    103: [...Buffer.from('this is not an xy project', 'ascii')],
  };

  await page.addInitScript(`(() => {
    const files = ${JSON.stringify(files)};
    const projects = [
      { handle: 101, name: 'monday jam', size: 400 },
      { handle: 102, name: 'tuesday', size: 400 },
      { handle: 103, name: 'half written', size: 30 },
    ];
    window.__READS__ = [];
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 9063, product_id: 1, location_id: 7, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return {
          presets: [],
          projects,
          standalone_samples: [
            { handle: 201, name: 'kick.wav', size: 2048, path: 'samples/user/kick.wav' },
            { handle: 202, name: 'shaker.wav', size: 1024, path: 'samples/user/shaker.wav' },
          ],
        };
        case 'mtp_read_file': {
          window.__READS__.push(args.handle);
          return files[args.handle] || [];
        }
        default: return [];
      }
    } } };
  })()`);

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'projects tab', exact: true }).click();
  const inspector = page.getByRole('region', { name: 'Project inspector' });

  // Open one project: the forward view, which is all there was before.
  await page.getByRole('button', { name: /monday jam/ }).click();
  await expect(inspector.getByRole('heading', { name: 'monday jam' })).toBeVisible();
  await expect(inspector).toContainText(SHARED);

  // Before the sweep the page says what it does not know, and claims nothing.
  await expect(inspector).toContainText('does not establish that any file is unused');
  await expect(inspector).not.toContainText('also used by');

  // One action.
  await inspector.getByRole('button', { name: 'check all 3 projects' }).click();

  // The kick is shared; the other project is named, not merely counted.
  await expect(inspector).toContainText('also used by 1 other project: tuesday');
  // And the sweep was incomplete, so the shaker is unknown rather than unused.
  await expect(inspector).toContainText('sharing unknown — 1 project could not be read');
  await expect(inspector).toContainText('2 of 3 projects read');
  await expect(inspector).toContainText('half written (no recognized OP-XY project header)');
  await expect(inspector).toContainText('may still be held by one of them');
  // Nothing anywhere offers to delete, or calls anything safe to delete.
  await expect(inspector).not.toContainText('safe to delete');

  // Every project was read exactly once, and reading a project writes nothing.
  const reads = await page.evaluate(() => (window as unknown as { __READS__: number[] }).__READS__);
  expect(reads.filter(handle => handle === 101)).toHaveLength(2); // once to inspect, once to sweep
  expect(reads.filter(handle => handle === 102)).toHaveLength(1);
  expect(reads.filter(handle => handle === 103)).toHaveLength(1);
});

/**
 * Reading every project is the slow part of this feature, and the panel is unmounted
 * whenever another tab is shown — so the first version threw the result away the moment
 * the user pressed ⌘1 to check something, and made them sit through all of it again.
 * The index now lives in app state, tagged with the instrument it was built on.
 */
test('the sweep survives leaving the tab, and can be stopped while it runs', async ({ page }) => {
  await page.addInitScript(`(() => {
    const xy = (paths) => {
      const head = [0xdd, 0xcc, 0xbb, 0xaa];
      const body = [];
      for (const path of paths) { for (const ch of path) body.push(ch.charCodeAt(0)); body.push(0, 0); }
      return [...head, ...new Array(64).fill(0), ...body, ...new Array(64).fill(0)];
    };
    const files = { 101: xy(['/fat32/samples/user/kick.wav']), 102: xy(['/fat32/samples/user/kick.wav']) };
    window.__READS__ = [];
    // Held open so the "stop" button has something to interrupt.
    window.__HOLD__ = false;
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      switch (command) {
        case 'mtp_list_available': return [{ kind: 'op-xy', model: 'OP-XY', product: 'OP-XY', serial: 'XY-0042', vendor_id: 9063, product_id: 1, location_id: 7, mode: 'mtp' }];
        case 'mtp_connect': return { kind: 'op-xy', model: 'OP-XY', manufacturer: 'teenage engineering', serial: 'XY-0042', connected: true };
        case 'mtp_list_storages': return [{ capacity: 8e9, free_space: 4e9, description: 'fixture' }];
        case 'mtp_scan_presets': return {
          presets: [], projects: [{ handle: 101, name: 'monday jam', size: 400 }, { handle: 102, name: 'tuesday', size: 400 }],
          standalone_samples: [{ handle: 201, name: 'kick.wav', size: 2048, path: 'samples/user/kick.wav' }],
        };
        case 'mtp_read_file':
          window.__READS__.push(args.handle);
          while (window.__HOLD__) await new Promise(r => setTimeout(r, 30));
          return files[args.handle] || [];
        default: return [];
      }
    } } };
  })()`);

  await page.goto('/');
  await page.getByRole('button', { name: 'find devices' }).click();
  await page.getByRole('button', { name: 'connect device', exact: true }).click();
  await expect(page.getByRole('button', { name: 'disconnect', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'projects tab', exact: true }).click();

  const inspector = page.getByRole('region', { name: 'Project inspector' });
  await page.getByRole('button', { name: /monday jam/ }).click();
  await expect(inspector).toContainText('/fat32/samples/user/kick.wav');

  // --- Stopping -----------------------------------------------------------------
  await page.evaluate(() => { (window as unknown as { __HOLD__: boolean }).__HOLD__ = true; });
  await inspector.getByRole('button', { name: 'check all 2 projects' }).click();
  // The panel is inert during a device operation, so the stop lives in the busy banner
  // above it — the one surface that is not blocked. A button inside the panel could be
  // seen and never pressed, which is how the first version of this shipped.
  const stop = page.getByRole('button', { name: 'Stop reading' });
  await expect(stop).toBeVisible();
  await stop.click();
  await page.evaluate(() => { (window as unknown as { __HOLD__: boolean }).__HOLD__ = false; });

  // A stopped sweep publishes nothing: a partial read would report a sample as unshared
  // on the strength of projects nobody looked at.
  await expect(stop).toHaveCount(0);
  await expect(inspector.getByRole('button', { name: /check all 2 projects/ })).toBeVisible();
  await expect(inspector).not.toContainText('projects read');
  await expect(inspector).not.toContainText('also used by');

  // --- Surviving a tab change ----------------------------------------------------
  await inspector.getByRole('button', { name: 'check all 2 projects' }).click();
  await expect(inspector).toContainText('All 2 projects read');
  const afterSweep = (await page.evaluate(() => (window as unknown as { __READS__: number[] }).__READS__)).length;

  await page.getByRole('tab', { name: 'drum tab', exact: true }).click();
  await page.getByRole('tab', { name: 'projects tab', exact: true }).click();
  await page.getByRole('button', { name: /monday jam/ }).click();

  // Still known, and not a single project was read again.
  await expect(inspector).toContainText('All 2 projects read');
  await expect(inspector).toContainText('also used by 1 other project: tuesday');
  const afterReturn = (await page.evaluate(() => (window as unknown as { __READS__: number[] }).__READS__)).length;
  // One extra read: re-opening the project itself, not the sweep.
  expect(afterReturn).toBe(afterSweep + 1);
});
