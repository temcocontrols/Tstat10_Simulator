import { test, expect } from '@playwright/test';
import { mainDisplayLocalStorageCacheKey } from './registry-helper.mjs';

const CACHE_KEY = mainDisplayLocalStorageCacheKey();

test.describe('Screen background persistence', () => {
    test('set dark background, save exit edit, reload — cache keeps #000000', async ({ page }) => {
        await page.goto('/Tstat10.html', { waitUntil: 'domcontentloaded' });
        await expect(page.locator('#tstat-lcd-container')).toBeVisible({ timeout: 45_000 });
        /* One-time clear so we start from repo JSON; do not use addInitScript — it runs again on reload and would wipe the draft. */
        await page.evaluate((key) => {
            try {
                localStorage.removeItem(key);
            } catch {
                /* ignore */
            }
        }, CACHE_KEY);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#tstat-lcd-container')).toBeVisible({ timeout: 45_000 });

        await page.locator('#thermostat-shell-lock-btn').click();
        await expect(page.locator('#editor-screen-bg')).toBeVisible({ timeout: 15_000 });

        await page.locator('#editor-screen-bg').evaluate((el) => {
            el.value = '#000000';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        });

        await expect(page.locator('#tstat-lcd-container')).toHaveCSS('background-color', /rgb\(0,\s*0,\s*0\)|rgba\(0,\s*0,\s*0/);

        await page.locator('#sls-run-preview-btn').click();
        await page.waitForFunction(() => !document.body.classList.contains('visual-edit-shell'), null, {
            timeout: 20_000
        });

        const cachedBg = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            try {
                return JSON.parse(raw)?.styles?.bg ?? null;
            } catch {
                return null;
            }
        }, CACHE_KEY);

        expect(cachedBg, 'draft should be in localStorage after save').toBeTruthy();
        expect(['#000000', '#000'].includes(String(cachedBg).toLowerCase())).toBe(true);

        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.locator('#tstat-lcd-container')).toBeVisible({ timeout: 45_000 });

        const afterReload = await page.evaluate((key) => {
            const raw = localStorage.getItem(key);
            if (!raw) return { err: 'no cache' };
            try {
                const j = JSON.parse(raw);
                return { bg: j?.styles?.bg, ok: true };
            } catch (e) {
                return { err: String(e) };
            }
        }, CACHE_KEY);

        expect(afterReload.ok, JSON.stringify(afterReload)).toBeTruthy();
        expect(['#000000', '#000'].includes(String(afterReload.bg).toLowerCase())).toBe(true);

        const lcdBg = await page.locator('#tstat-lcd-container').evaluate((el) => {
            const c = getComputedStyle(el).backgroundColor;
            return c;
        });
        expect(lcdBg).toMatch(/rgb\(0,\s*0,\s*0\)|rgba\(0,\s*0,\s*0/);
    });
});
