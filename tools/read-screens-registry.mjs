/**
 * Shared loader + invariants for screens-registry.json (Node tools).
 * @returns {{ screens: object[], additionalPageIdsForSchema: string[] }}
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const REGISTRY_PATH = path.join(root, 'screens-registry.json');

export function readScreensRegistry() {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    const data = JSON.parse(raw);
    verifyScreensRegistry(data);
    return data;
}

/** @param {unknown} data */
export function verifyScreensRegistry(data) {
    if (!data || typeof data !== 'object') throw new Error('screens-registry: root must be an object');
    const { screens, additionalPageIdsForSchema } = data;
    if (!Array.isArray(screens) || screens.length === 0) {
        throw new Error('screens-registry: "screens" must be a non-empty array');
    }
    const routeKeys = new Set();
    const pages = new Set();
    const jsonPaths = new Set();
    for (const s of screens) {
        if (!s || typeof s !== 'object') throw new Error('screens-registry: each screen must be an object');
        for (const key of ['routeKey', 'page', 'displayName', 'jsonPath']) {
            if (typeof s[key] !== 'string' || !String(s[key]).trim()) {
                throw new Error(`screens-registry: screen missing non-empty string "${key}": ${JSON.stringify(s)}`);
            }
        }
        if (routeKeys.has(s.routeKey)) throw new Error(`screens-registry: duplicate routeKey "${s.routeKey}"`);
        if (pages.has(s.page)) throw new Error(`screens-registry: duplicate page "${s.page}"`);
        if (jsonPaths.has(s.jsonPath)) throw new Error(`screens-registry: duplicate jsonPath "${s.jsonPath}"`);
        routeKeys.add(s.routeKey);
        pages.add(s.page);
        jsonPaths.add(s.jsonPath);
    }
    if (additionalPageIdsForSchema !== undefined) {
        if (!Array.isArray(additionalPageIdsForSchema)) {
            throw new Error('screens-registry: additionalPageIdsForSchema must be an array when present');
        }
        for (const id of additionalPageIdsForSchema) {
            if (typeof id !== 'string' || !id.trim()) throw new Error('screens-registry: additionalPageIdsForSchema must be non-empty strings');
            if (pages.has(id)) throw new Error(`screens-registry: additionalPageIdsForSchema duplicates active page "${id}"`);
        }
    }
}
