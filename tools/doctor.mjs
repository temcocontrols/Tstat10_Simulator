#!/usr/bin/env node
/**
 * Quick environment check after clone / before CI-sensitive work.
 * Run: npm run doctor
 * Optional: npm run doctor -- --probe   (tries dev-server probe on 8787 and 8799)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

async function main() {
    const major = Number(process.versions.node.split('.')[0]);
    if (Number.isNaN(major) || major < 20) {
        console.error(`[doctor] Node 20+ recommended (found ${process.version}).`);
        process.exit(1);
    }

    const hook = path.join(root, '.husky', 'pre-commit');
    if (!fs.existsSync(hook)) {
        console.warn('[doctor] Missing .husky/pre-commit — run `npm install` to install git hooks.');
    }

    console.log(`[doctor] OK — Node ${process.version}, project ${root}`);

    if (process.argv.includes('--probe')) {
        const ports = [8787, 8799];
        for (const p of ports) {
            const u = `http://127.0.0.1:${p}/__tstat_dev_probe`;
            try {
                const r = await fetch(u, { signal: AbortSignal.timeout(2000) });
                const ok = r.status === 204 || r.ok;
                console.log(`[doctor] ${u} → HTTP ${r.status}${ok ? ' (Tstat dev server)' : ''}`);
            } catch (e) {
                console.log(`[doctor] ${u} → no response (${e.cause?.code || e.name})`);
            }
        }
    }

    process.exit(0);
}

main().catch((e) => {
    console.error('[doctor]', e);
    process.exit(1);
});
