import { test, expect } from '@playwright/test';

test.describe('Simulator shell', () => {
    test('Tstat10 loads, LCD mount visible, no console/page errors', async ({ page }) => {
        const problems = [];
        page.on('console', (msg) => {
            if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
        });
        page.on('pageerror', (err) => {
            problems.push(`pageerror: ${err.message}`);
        });

        await page.goto('/Tstat10.html', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#tstat-lcd-container')).toBeVisible({ timeout: 45_000 });

        expect(problems, problems.join('\n')).toEqual([]);
    });

    test('workbench chrome and resources strip render', async ({ page }) => {
        await page.goto('/Tstat10.html', { waitUntil: 'domcontentloaded' });
        /* Top bar can be CSS-hidden in narrow viewports; still must exist in DOM. */
        await expect(page.locator('.sls-topbar__brand')).toHaveCount(1, { timeout: 45_000 });
        await expect(page.locator('.sls-assets-strip')).toContainText('main_display.json');
    });
});
