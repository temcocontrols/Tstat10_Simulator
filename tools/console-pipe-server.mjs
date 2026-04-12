#!/usr/bin/env node
/**
 * Backward-compatible entry: runs the unified dev server (static site + POST /log).
 * Prefer: npm start
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dev = path.join(__dirname, 'dev-server.mjs');

const child = spawn(process.execPath, [dev], {
    cwd: root,
    stdio: 'inherit',
    shell: false,
    env: { ...process.env }
});

child.on('exit', (code) => process.exit(code ?? 0));
