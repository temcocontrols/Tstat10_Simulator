/**
 * Shared append for browser console lines → logs/browser-console.log
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const LOG_DIR = path.join(ROOT, 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'browser-console.log');

export function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

/**
 * @param {string} body raw JSON POST body
 * @returns {string} formatted line (without trailing newline)
 */
export function appendBrowserLogFromBody(body) {
    const j = JSON.parse(body || '{}');
    const t = j.t != null ? new Date(j.t).toISOString() : new Date().toISOString();
    const level = String(j.level || 'log');
    const text = String(j.text != null ? j.text : '');
    const line = `[${t}] [${level}] ${text}`;
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
    return line;
}
