/**
 * Disk-backed LCD icon library (served by tools/dev-server.mjs under /__tstat_lcd_lib/).
 *
 * Default folder on the machine: `<simulator>/lcd-lib/` (override when starting the server:
 * `TSTAT_LCD_LIB=C:\path\to\folder npm start`). Put SVGs in `<that folder>/icons/*.svg`.
 *
 * Browser override (same or different origin that exposes the same API shape): set
 * `localStorage.setItem('TSTAT_LCD_LIB_BASE', 'http://127.0.0.1:8787/__tstat_lcd_lib')`
 * (no trailing slash required). Clear with `removeItem` and call `invalidateLcdLibDiskCache()`.
 */

let _lcdLibMem;
/** @type {Promise<LcdLibDiskIcon[]>|null} */
let _lcdLibInflight = null;

/** @typedef {{ id: string, name: string, svg: string, fromLib?: boolean }} LcdLibDiskIcon */

/**
 * @returns {string} Absolute URL to manifest.json (honours TSTAT_LCD_LIB_BASE).
 */
export function getLcdLibManifestUrl() {
    let base = '';
    try {
        base = (typeof localStorage !== 'undefined' && localStorage.getItem('TSTAT_LCD_LIB_BASE')) || '';
    } catch {
        base = '';
    }
    const t = String(base).trim().replace(/\/+$/, '');
    if (t) {
        return `${t}/manifest.json`;
    }
    return new URL('/__tstat_lcd_lib/manifest.json', window.location.origin).href;
}

/**
 * @returns {string} Base URL for svg fetch (directory containing manifest).
 */
export function getLcdLibSvgBaseUrl() {
    const m = getLcdLibManifestUrl().split('?')[0];
    return m.replace(/\/manifest\.json$/i, '');
}

/**
 * Clears cached disk icons after changing TSTAT_LCD_LIB_BASE or switching servers.
 */
export function invalidateLcdLibDiskCache() {
    _lcdLibMem = undefined;
    _lcdLibInflight = null;
}

/**
 * @returns {LcdLibDiskIcon[]|undefined} undefined until first successful fetch attempt finished.
 */
export function getLcdLibDiskSync() {
    return _lcdLibMem;
}

/**
 * Resolves after icons are loaded (or failed — then cached list is empty).
 * @returns {Promise<LcdLibDiskIcon[]>}
 */
export function ensureLcdLibDiskCache() {
    if (_lcdLibMem !== undefined) return Promise.resolve(_lcdLibMem);
    if (_lcdLibInflight) return _lcdLibInflight;
    _lcdLibInflight = fetchLcdLibDiskIcons()
        .then((rows) => {
            _lcdLibMem = Array.isArray(rows) ? rows : [];
            return _lcdLibMem;
        })
        .catch(() => {
            _lcdLibMem = [];
            return _lcdLibMem;
        })
        .finally(() => {
            _lcdLibInflight = null;
        });
    return _lcdLibInflight;
}

/**
 * @returns {Promise<LcdLibDiskIcon[]>}
 */
async function fetchLcdLibDiskIcons() {
    const manifestUrl = getLcdLibManifestUrl();
    let icons;
    try {
        const r = await fetch(`${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}_=${Date.now()}`, {
            cache: 'no-store'
        });
        if (!r.ok) return [];
        const j = await r.json();
        icons = Array.isArray(j.icons) ? j.icons : [];
    } catch {
        return [];
    }
    const base = getLcdLibSvgBaseUrl();
    /** @type {LcdLibDiskIcon[]} */
    const out = [];
    for (const row of icons) {
        const file = row && typeof row.file === 'string' ? row.file : '';
        if (!file.toLowerCase().endsWith('.svg')) continue;
        try {
            const u = `${base}/svg?file=${encodeURIComponent(file)}`;
            const r2 = await fetch(u, { cache: 'no-store' });
            if (!r2.ok) continue;
            const svg = await r2.text();
            if (!svg.includes('<svg')) continue;
            out.push({
                id: String(row.id || `lib:${file.replace(/\.svg$/i, '')}`),
                name: String(row.name || file.replace(/\.svg$/i, '')),
                svg,
                fromLib: true
            });
        } catch {
            /* skip broken file */
        }
    }
    return out;
}

if (typeof window !== 'undefined') {
    window.temcoInvalidateLcdLibDiskCache = invalidateLcdLibDiskCache;
}
