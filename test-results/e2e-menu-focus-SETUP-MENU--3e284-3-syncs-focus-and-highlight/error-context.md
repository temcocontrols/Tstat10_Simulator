# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: e2e-menu-focus.spec.js >> SETUP_MENU: visual edit row w-3 syncs focus and highlight
- Location: tests\e2e-menu-focus.spec.js:7:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: page.waitForFunction: Test timeout of 30000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e6]:
  - button "Toggle layout edit mode" [ref=e7] [cursor=pointer]: 🔓
  - img [ref=e10]
  - generic [ref=e20]:
    - button "◀" [ref=e21] [cursor=pointer]
    - button "▼" [ref=e22] [cursor=pointer]
    - button "▲" [ref=e23] [cursor=pointer]
    - button "▶" [ref=e24] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | /**
  4  |  * Regression: selecting a menu row in visual edit syncs _currentScreenFocus
  5  |  * so the teal highlight does not disappear (opacity stays 1 on focused row).
  6  |  */
  7  | test('SETUP_MENU: visual edit row w-3 syncs focus and highlight', async ({ page }) => {
  8  |     await page.goto('/Tstat10.html', { waitUntil: 'networkidle', timeout: 60_000 });
> 9  |     await page.waitForFunction(() => typeof window.navigateTo === 'function', { timeout: 60_000 });
     |                ^ Error: page.waitForFunction: Test timeout of 30000ms exceeded.
  10 | 
  11 |     await page.waitForSelector('#btn-lock-save', { timeout: 30_000 });
  12 |     await page.locator('#btn-lock-save').click();
  13 |     await expect
  14 |         .poll(async () => page.evaluate(() => window._isVisualEditMode === true))
  15 |         .toBe(true);
  16 | 
  17 |     await page.evaluate(() => {
  18 |         try {
  19 |             localStorage.removeItem('tstat_last_screen_v1');
  20 |         } catch {
  21 |             /* ignore */
  22 |         }
  23 |         window.navigateTo('setup');
  24 |     });
  25 | 
  26 |     await expect
  27 |         .poll(async () => page.evaluate(() => window._currentScreenData?.page === 'SETUP_MENU'))
  28 |         .toBe(true);
  29 | 
  30 |     await page.click('[data-tree-node-id="w-3"]');
  31 |     await expect
  32 |         .poll(async () => page.evaluate(() => window._layoutSelectedNodeId === 'w-3'))
  33 |         .toBe(true);
  34 | 
  35 |     const focus = await page.evaluate(() => window._currentScreenFocus);
  36 |     expect(focus).toBe(1);
  37 | 
  38 |     const opacityOk = await page.evaluate(() => {
  39 |         const row = document.querySelector('[data-tree-node-id="w-3"]');
  40 |         if (!row) return false;
  41 |         const hi = row.querySelector('div[style*="position"]');
  42 |         if (!hi) return false;
  43 |         return hi.style.opacity === '1';
  44 |     });
  45 |     expect(opacityOk).toBe(true);
  46 | });
  47 | 
```