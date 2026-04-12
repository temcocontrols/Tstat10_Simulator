/**
 * Smoke-test layout tree HTML5 DnD (menu_row ↔ menu_row via label sub-row target).
 * Run with dev server up: npx --yes --package playwright node tools/tree-dnd-smoke.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.TSTAT_TEST_URL || 'http://127.0.0.1:8787';

async function main() {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health?.ok) {
        console.error('FAIL: no dev server at', BASE, '(GET /health)');
        process.exit(1);
    }

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1400, height: 900 });

    await page.goto(`${BASE}/Tstat10.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    // Bezel "Edit" enters layout mode (top bar appears with Run play control).
    await page.waitForSelector('#thermostat-shell-lock-btn', { state: 'visible', timeout: 30000 });
    await page.locator('#thermostat-shell-lock-btn').click();
    await page.waitForFunction(() => !!window._isVisualEditMode, null, { timeout: 15000 });

    await page.evaluate(() => {
        if (typeof window.navigateTo === 'function') window.navigateTo('setup');
    });
    // Tree folder for the current JSON starts collapsed unless it was the first-loaded path; expand Setup.
    const setupFolder = page.locator('.layout-tree-folder').filter({ hasText: 'Setup Menu' }).first();
    await setupFolder.locator('.layout-tree-node--screen').click();
    await page.waitForSelector('#layout-tree-content .layout-tree-node--wtype-menu_row', { timeout: 20000 });

    const before = await page.evaluate(() => {
        const w = window._currentScreenData?.widgets;
        if (!Array.isArray(w)) return null;
        const rows = w.filter((x) => x && x.type === 'menu_row');
        return rows.slice(0, 3).map((r) => ({ id: r.id, lcdRow: r.lcdRow }));
    });
    if (!before?.length) {
        console.error('FAIL: could not read menu_row widgets');
        await browser.close();
        process.exit(1);
    }

    const src = page.locator('#layout-tree-content .layout-tree-node--wtype-menu_row').first();
    const targetLabel = page.locator('#layout-tree-content .layout-tree-node--part-label').nth(1);

    await src.waitFor({ state: 'attached' });
    await targetLabel.waitFor({ state: 'attached' });
    await src.dragTo(targetLabel, {
        force: true,
        targetPosition: { x: 24, y: 6 }
    });

    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
        const w = window._currentScreenData?.widgets;
        if (!Array.isArray(w)) return null;
        const rows = w.filter((x) => x && x.type === 'menu_row');
        return rows.slice(0, 3).map((r) => ({ id: r.id, lcdRow: r.lcdRow }));
    });

    await browser.close();

    const a0 = before[0];
    const a1 = before[1];
    const b0 = after.find((r) => r.id === a0.id);
    const b1 = after.find((r) => r.id === a1.id);
    if (!b0 || !b1) {
        console.error('FAIL: lost menu_row after drag', { before, after });
        process.exit(1);
    }

    const swapped = Number(b0.lcdRow) === Number(a1.lcdRow) && Number(b1.lcdRow) === Number(a0.lcdRow);
    if (!swapped) {
        console.error('FAIL: expected first two menu_row lcdRow to swap', { before, after });
        process.exit(1);
    }

    console.log('OK: tree DnD onto label row swapped lcdRow for first two menu_row', { before, after });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
