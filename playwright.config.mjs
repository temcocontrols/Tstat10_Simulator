import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: 'e2e',
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        /* Dedicated port so `npm start` on 8787 does not collide with E2E. */
        baseURL: 'http://127.0.0.1:8799',
        trace: 'on-first-retry'
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
    webServer: {
        command: 'node tools/dev-server.mjs',
        env: { OPEN_BROWSER: '0', PORT: '8799' },
        url: 'http://127.0.0.1:8799/__tstat_dev_probe',
        reuseExistingServer: !process.env.CI,
        timeout: 60_000
    }
});
