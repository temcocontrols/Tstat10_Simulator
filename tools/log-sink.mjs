/**
 * Shared append for browser console lines → logs/browser-console.log (human)
 * and logs/browser-console.jsonl (NDJSON for jq / tooling).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');
export const LOG_DIR = path.join(ROOT, 'logs');
export const LOG_FILE = path.join(LOG_DIR, 'browser-console.log');
export const LOG_JSONL_FILE = path.join(LOG_DIR, 'browser-console.jsonl');

const UA_MAX = 240;
const TITLE_MAX = 200;

export function ensureLogDir() {
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
    }
}

/**
 * @param {string} body raw JSON POST body from console-pipe-client
 * @param {{ userAgent?: string }} [serverMeta] from HTTP request (dev server only)
 * @returns {string} formatted human line (without trailing newline)
 */
export function appendBrowserLogFromBody(body, serverMeta = {}) {
    const j = JSON.parse(body || '{}');
    const ts = j.t != null ? new Date(j.t).toISOString() : new Date().toISOString();
    const level = String(j.level || 'log');
    const text = String(j.text != null ? j.text : '');
    const pathname = String(j.pathname != null ? j.pathname : '');
    const title = String(j.title != null ? j.title : '').slice(0, TITLE_MAX);
    const sessionId = String(j.sid != null ? j.sid : '');
    const userAgent = String(serverMeta.userAgent != null ? serverMeta.userAgent : '').slice(0, UA_MAX);

    const record = {
        ts,
        level,
        text,
        pathname,
        title,
        sessionId,
        userAgent
    };

    const pathTag = pathname || '-';
    const sidTag = sessionId || '-';
    const line = `[${ts}] [${level}] [${pathTag}] [${sidTag}] ${text}`;
    ensureLogDir();
    fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
    fs.appendFileSync(LOG_JSONL_FILE, `${JSON.stringify(record)}\n`, 'utf8');
    return line;
}
