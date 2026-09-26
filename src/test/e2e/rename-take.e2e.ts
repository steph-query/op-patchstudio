import { test, expect } from '@playwright/test';

/**
 * Gap #4 of `docs/te-companion-feature-research.md` — "rename and organize" — was the
 * least-served demand in the research table, noted as "local naming lands in playbook
 * phase 03". A TP-7 take arrives called `2026-02-23_112713_000.wav`, and in a studio it
 * is "yard door slam".
 *
 * Renaming on the *device* stays refused; this names your own copy. It is a label, not a
 * rename: the library is content-addressed, so the bytes and their path are identity and
 * `original_name` is kept as provenance. That distinction is the thing worth testing —
 * a label that quietly became a file rename would break deduplication on re-import and
 * lose the name the recorder gave the file.
 */

const ORIGINAL = '2026-02-23_112713_000.wav';

function library(label: string | null) {
  return {
    id: 'take1',
    stored_path: `originals/${ORIGINAL}`,
    original_name: ORIGINAL,
    bytes: 2048,
    first_imported_unix: 1_772_000_000,
    occurrences: [{ source: 'device', device_model: 'TP-7', device_serial: 'TP-0007', source_path: `recordings/${ORIGINAL}`, captured_at: '2026-02-23T11:27:13', imported_unix: 1_772_000_000 }],
    regions: [],
    label,
  };
}

async function openLibrary(page: import('@playwright/test').Page, reject?: string) {
  await page.addInitScript(`(() => {
    let asset = ${JSON.stringify(library(null))};
    window.__LABEL_CALLS__ = [];
    window.__TAURI__ = { core: { invoke: async (command, args) => {
      switch (command) {
        case 'catalog_open':
        case 'catalog_status':
          return { path: '/Users/fixture/Music/Fieldwork Library', assets: 1, bytes: 2048, occurrences: 1 };
        case 'catalog_assets': return [asset];
        case 'catalog_transfers': return [];
        case 'local_audio_info': return { asset_id: 'take1', sample_rate: 48000, channels: 2, bits: 24, is_float: false, frames: 96000, duration_seconds: 2, audio_bytes: 2048 };
        case 'local_audio_peaks': return { version: 1, asset_id: 'take1', buckets: args.buckets, channels: 2, frames: 96000, sample_rate: 48000,
          min: Array.from({ length: args.buckets * 2 }, () => -0.5), max: Array.from({ length: args.buckets * 2 }, () => 0.5) };
        case 'catalog_label_asset':
          window.__LABEL_CALLS__.push(args);
          ${reject ? `throw new Error(${JSON.stringify(reject)});` : ''}
          // The real command writes one field and returns the whole asset back.
          asset = { ...asset, label: args.label.trim() ? args.label.trim() : null };
          return asset;
        default: return [];
      }
    } } };
  })()`);
  await page.goto('/');
  await page.getByRole('tab', { name: 'takes tab', exact: true }).click();
  await page.locator('.take-row').first().click();
  const panel = page.getByRole('region', { name: new RegExp(`Audition ${ORIGINAL.replace(/\./g, '\\.')}`, 'i') });
  await expect(panel).toBeVisible();
  return panel;
}

test('a take can be named, and the name the recorder gave it survives', async ({ page }) => {
  const panel = await openLibrary(page);

  await panel.getByRole('button', { name: new RegExp(ORIGINAL.replace(/\./g, '\\.')) }).click();
  const field = panel.getByLabel('Take name');
  // Empty to start, with the original as the placeholder rather than as text to delete.
  await expect(field).toHaveValue('');
  await expect(field).toHaveAttribute('placeholder', ORIGINAL);
  await expect(panel.getByText(/The file on disk keeps its name\. Nothing on the device is renamed\./)).toBeVisible();

  await field.fill('yard door slam');
  await field.press('Enter');

  // The chosen name is what the app shows — including in the panel's accessible name,
  // so the locator built from the old name no longer matches it. That is the point: a
  // screen reader now announces the take the way its owner refers to it.
  await expect(panel).toHaveCount(0);
  const renamed = page.getByRole('region', { name: 'Audition yard door slam' });
  await expect(renamed).toBeVisible();
  await expect(renamed.getByRole('button', { name: 'yard door slam' })).toBeVisible();
  const row = page.locator('.take-row').first();
  await expect(row.locator('strong')).toHaveText('yard door slam');
  // And the recorder's name is kept visible as provenance rather than discarded.
  await expect(row).toContainText(`filed as ${ORIGINAL}`);
  // The bytes stayed where they are: the stored path is unchanged.
  await expect(row).toContainText(`originals/${ORIGINAL}`);

  // Exactly one write, carrying the take's id and the trimmed name.
  const calls = await page.evaluate(() => (window as unknown as { __LABEL_CALLS__: Array<{ assetId: string; label: string }> }).__LABEL_CALLS__);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toEqual({ assetId: 'take1', label: 'yard door slam' });
});

test('searching finds a take by either name', async ({ page }) => {
  const panel = await openLibrary(page);
  await panel.getByRole('button', { name: new RegExp(ORIGINAL.replace(/\./g, '\\.')) }).click();
  await panel.getByLabel('Take name').fill('yard door slam');
  await panel.getByRole('button', { name: 'save name' }).click();
  await expect(page.locator('.take-row').first().locator('strong')).toHaveText('yard door slam');

  const search = page.getByPlaceholder(/name, device or path/i).or(page.getByRole('searchbox')).first();
  // The name the owner chose.
  await search.fill('yard');
  await expect(page.locator('.take-row')).toHaveCount(1);
  // And the one the recorder gave it, which is still how the device refers to the file.
  await search.fill('112713');
  await expect(page.locator('.take-row')).toHaveCount(1);
  await search.fill('nothing like this');
  await expect(page.locator('.take-row')).toHaveCount(0);
});

test('a rejected name keeps what was typed, and escape abandons it', async ({ page }) => {
  const panel = await openLibrary(page, 'A take name cannot contain "/" — it would break the file name when you send it somewhere.');

  await panel.getByRole('button', { name: new RegExp(ORIGINAL.replace(/\./g, '\\.')) }).click();
  const field = panel.getByLabel('Take name');
  await field.fill('kick/snare');
  await field.press('Enter');

  // Told why, without losing the text — retyping is the annoying part.
  await expect(panel.getByRole('alert')).toContainText('cannot contain');
  await expect(field).toHaveValue('kick/snare');
  // And the take is still called what it was called.
  await expect(page.locator('.take-row').first().locator('strong')).toHaveText(ORIGINAL);

  await field.press('Escape');
  await expect(panel.getByLabel('Take name')).toHaveCount(0);
  await expect(panel.getByRole('alert')).toHaveCount(0);
});
