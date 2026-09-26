import { test, expect } from '@playwright/test';
test('the slider-label rule reaches Carbon\'s label', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: /^drum/ }).waitFor();
  const result = await page.evaluate(() => {
    // Build the exact markup Carbon produces for a slider with labelText.
    const host = document.createElement('div');
    host.innerHTML = `<div class="cds--form-item">
      <label class="cds--label" id="probe-label">transpose: 5</label>
      <div class="cds--slider-container"><div role="slider" aria-labelledby="probe-label"></div></div>
    </div>`;
    document.body.appendChild(host);
    const label = host.querySelector('.cds--label') as HTMLElement;
    const cs = getComputedStyle(label);
    const out = {
      fontSize: cs.fontSize, fontWeight: cs.fontWeight, color: cs.color,
      marginBottom: cs.marginBottom, display: cs.display,
      supportsHas: CSS.supports('selector(:has(+ *))'),
    };
    host.remove();
    return out;
  });
  console.log('SELECTOR ' + JSON.stringify(result));
  expect(result.supportsHas).toBe(true);
});
