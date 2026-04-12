#!/usr/bin/env node
/**
 * First-time (or “new machine”) setup: doctor + Playwright browser for E2E.
 * Run: npm run setup
 */
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

function run(title, command, args) {
    console.log(`\n→ ${title}…`);
    const r = spawnSync(command, args, {
        cwd: root,
        stdio: 'inherit',
        env: process.env,
        shell: false
    });
    if (r.status !== 0 && r.status !== null) {
        console.error(`\n✗ Step failed (exit ${r.status}). Fix the error above, then run: npm run setup\n`);
        process.exit(r.status);
    }
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Tstat10 Simulator — setup (safe to run again anytime)    ║
╚══════════════════════════════════════════════════════════════╝
`);

run('Environment check', process.execPath, [path.join(root, 'tools', 'doctor.mjs')]);
run('Playwright Chromium (for automated browser tests)', npxCmd, ['playwright', 'install', 'chromium']);

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  Done. What runs automatically from here                   ║
╠══════════════════════════════════════════════════════════════╣
║  • git commit  → ESLint fixes staged .js files (Husky)        ║
║  • git push    → GitHub Actions runs lint + browser smoke   ║
║  • Save in VS Code / Cursor → ESLint “fix” if extension on  ║
╚══════════════════════════════════════════════════════════════╝

  Start the simulator (recommended — enables console pipe + logs):

    npm start

  Then open the URL it prints (usually http://127.0.0.1:8787/Tstat10.html ).

  Run browser smoke tests anytime:

    npm run test:e2e

  Optional — see if a dev server is already up (8787 = npm start, 8799 = E2E):

    npm run doctor -- --probe

  New here? Read: GETTING_STARTED.md
`);
