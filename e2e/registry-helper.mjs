import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

/** @returns {{ screens: { routeKey: string, page: string, displayName: string, jsonPath: string }[], additionalPageIdsForSchema?: string[] }} */
export function loadScreensRegistry() {
    const p = path.join(root, 'screens-registry.json');
    return JSON.parse(readFileSync(p, 'utf8'));
}

export function defaultStartupJsonBasename() {
    const reg = loadScreensRegistry();
    const main = reg.screens.find((s) => s.routeKey === 'main');
    const jp = main?.jsonPath || reg.screens[0].jsonPath;
    return String(jp).replace(/^\.\//, '');
}

export function mainDisplayLocalStorageCacheKey() {
    const reg = loadScreensRegistry();
    const main = reg.screens.find((s) => s.routeKey === 'main');
    const jp = main?.jsonPath || reg.screens[0].jsonPath;
    return `tstat_cache_${jp}`;
}
