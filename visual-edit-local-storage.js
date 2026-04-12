/**
 * Screen JSON cache, project-wide background/theme propagation, and custom icon palette persistence.
 * Split from network-settings-renderer.js.
 */

import { PROJECT_SCREEN_JSON_PATHS } from './screen-paths.js';

export function getScreenStateMap() {
    if (!window._screenStateByJsonPath) window._screenStateByJsonPath = {};
    return window._screenStateByJsonPath;
}

export function cacheKeyForJsonPath(jsonPath) {
    return `tstat_cache_${jsonPath}`;
}

export function saveScreenToCache(jsonPath, data) {
    if (!jsonPath || !data) return;
    try {
        localStorage.setItem(cacheKeyForJsonPath(jsonPath), JSON.stringify(data, null, 2));
    } catch (err) {
        console.warn('[Visual Edit] Failed to persist cache:', err);
    }
}

export function loadScreenFromCache(jsonPath) {
    try {
        const raw = localStorage.getItem(cacheKeyForJsonPath(jsonPath));
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('[Visual Edit] Failed to read cache:', err);
        return null;
    }
}

/** Workbench LCD translate (Alt+arrows / edge drag) — mirror globals ↔ `canvasProfile` so cache + JSON drafts stay aligned. */
export function syncWorkbenchNudgeIntoScreenDataForCache(data) {
    if (!data || typeof data !== 'object') return;
    if (!data.canvasProfile) data.canvasProfile = {};
    data.canvasProfile.previewOffsetX = Math.round(Number(window._tstatLcdNudgeX) || 0);
    data.canvasProfile.previewOffsetY = Math.round(Number(window._tstatLcdNudgeY) || 0);
}

export function mergeProjectBackgroundIntoScreenData(screenData, bgCss) {
    if (!screenData || typeof screenData !== 'object' || typeof bgCss !== 'string' || !bgCss.trim()) return;
    const v = bgCss.trim();
    if (!screenData.styles) screenData.styles = {};
    screenData.styles.bg = v;
    if (screenData.colorProfile && typeof screenData.colorProfile === 'object') {
        if (!screenData.colorProfile.themeTokens) screenData.colorProfile.themeTokens = {};
        screenData.colorProfile.themeTokens.bg = v;
    }
}

/** Project-wide: LCD background + row highlight (`lcdTheme.c` backgroundColor / backgroundColor1). */
export function mergeProjectFirmwareThemeIntoScreenData(screenData, bgCss, highlightCss, colorMode) {
    if (!screenData || typeof screenData !== 'object') return;
    const bg = String(bgCss || '').trim();
    const hl = String(highlightCss || '').trim();
    if (!bg || !hl) return;
    mergeProjectBackgroundIntoScreenData(screenData, bg);
    if (!screenData.styles) screenData.styles = {};
    screenData.styles.highlight = hl;
    if (screenData.colorProfile && typeof screenData.colorProfile === 'object') {
        if (!screenData.colorProfile.themeTokens) screenData.colorProfile.themeTokens = {};
        screenData.colorProfile.themeTokens.accent = hl;
        if (typeof colorMode === 'string' && (colorMode === 'indexed' || colorMode === 'reduced_rgb')) {
            screenData.colorProfile.mode = colorMode;
        }
    }
}

export function propagateProjectWideFirmwareTheme(bgCss, highlightCss, currentJsonPath, colorMode) {
    const cur = String(currentJsonPath || window._currentJsonPath || '');
    const bg = String(bgCss || '').trim();
    const hl = String(highlightCss || '').trim();
    if (!bg || !hl) return;
    for (const rel of PROJECT_SCREEN_JSON_PATHS) {
        if (rel === cur) continue;
        const cached = loadScreenFromCache(rel);
        if (cached) {
            mergeProjectFirmwareThemeIntoScreenData(cached, bg, hl, colorMode);
            saveScreenToCache(rel, cached);
        }
    }
    const missing = PROJECT_SCREEN_JSON_PATHS.filter((rel) => rel !== cur && !loadScreenFromCache(rel));
    if (missing.length === 0) return;
    Promise.all(
        missing.map((rel) =>
            fetch(`${rel}?_=${Date.now()}`)
                .then((r) => {
                    if (!r.ok) throw new Error(String(r.status));
                    return r.json();
                })
                .then((j) => {
                    mergeProjectFirmwareThemeIntoScreenData(j, bg, hl, colorMode);
                    saveScreenToCache(rel, j);
                })
                .catch(() => {})
        )
    ).then(() => {
        /* no-op */
    });
}

/**
 * SquareLine-style project theme (phase 1): one shared LCD background for every screen JSON.
 * Updates localStorage cache for each path; fetches uncached files from disk and caches them.
 * Exception pages can be added later (e.g. skip list or per-page overrides).
 */
export function propagateProjectWideBackground(bgCss, currentJsonPath) {
    const cur = String(currentJsonPath || window._currentJsonPath || '');
    const bg = String(bgCss || '').trim();
    if (!bg) return;
    for (const rel of PROJECT_SCREEN_JSON_PATHS) {
        if (rel === cur) continue;
        const cached = loadScreenFromCache(rel);
        if (cached) {
            mergeProjectBackgroundIntoScreenData(cached, bg);
            saveScreenToCache(rel, cached);
        }
    }
    const missing = PROJECT_SCREEN_JSON_PATHS.filter((rel) => rel !== cur && !loadScreenFromCache(rel));
    if (missing.length === 0) return;
    Promise.all(
        missing.map((rel) =>
            fetch(`${rel}?_=${Date.now()}`)
                .then((r) => {
                    if (!r.ok) throw new Error(String(r.status));
                    return r.json();
                })
                .then((j) => {
                    mergeProjectBackgroundIntoScreenData(j, bg);
                    saveScreenToCache(rel, j);
                })
                .catch(() => {})
        )
    ).then(() => {
        /* no-op: status already written from apply path */
    });
}

export function getIconPaletteStorageKey() {
    return 'tstat_icon_palette_custom_svgs_v2';
}

export function loadCustomPaletteSvgs() {
    try {
        const raw = localStorage.getItem(getIconPaletteStorageKey());
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        return arr
            .map((item, idx) => {
                if (typeof item === 'string' && item.includes('<svg')) {
                    return { name: `Custom ${idx + 1}`, svg: item };
                }
                if (item && typeof item === 'object' && typeof item.svg === 'string' && item.svg.includes('<svg')) {
                    return { name: String(item.name || `Custom ${idx + 1}`), svg: item.svg };
                }
                return null;
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

export function saveCustomPaletteSvgs(list) {
    try {
        const normalized = list
            .slice(0, 32)
            .map((item, idx) => ({
                name: String(item?.name || `Custom ${idx + 1}`),
                svg: String(item?.svg || '')
            }))
            .filter((item) => item.svg.includes('<svg'));
        localStorage.setItem(getIconPaletteStorageKey(), JSON.stringify(normalized));
    } catch (err) {
        console.warn('[IconPalette] Failed to persist custom SVGs:', err);
    }
}

const CUSTOM_BG_SWATCHES_LS = 'tstat10_editor_custom_bg_swatches_v1';
const CUSTOM_BG_SWATCHES_MAX = 18;

/** User-defined Screen → Background swatches (Inspector, reduced_rgb). */
export function loadCustomBgSwatches() {
    try {
        const raw = localStorage.getItem(CUSTOM_BG_SWATCHES_LS);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr
            .map((x) => {
                if (typeof x === 'string' && x.trim().startsWith('#')) return { hex: x.trim(), label: x.trim() };
                if (x && typeof x === 'object' && typeof x.hex === 'string' && x.hex.trim().startsWith('#')) {
                    return { hex: x.hex.trim(), label: String(x.label || x.hex).trim() || x.hex.trim() };
                }
                return null;
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

export function saveCustomBgSwatches(list) {
    try {
        const normalized = list
            .slice(0, CUSTOM_BG_SWATCHES_MAX)
            .map((x) => ({ hex: String(x.hex || '').trim(), label: String(x.label || x.hex || '').trim() || String(x.hex || '').trim() }))
            .filter((x) => /^#[0-9a-f]{6}$/i.test(x.hex));
        localStorage.setItem(CUSTOM_BG_SWATCHES_LS, JSON.stringify(normalized));
    } catch (err) {
        console.warn('[CustomBgSwatches] Failed to persist:', err);
    }
}

export function addCustomBgSwatchEntry(hex, label) {
    const h = String(hex || '').trim();
    if (!/^#[0-9a-f]{6}$/i.test(h)) return false;
    const norm = `#${h.slice(1).toLowerCase()}`;
    const cur = loadCustomBgSwatches();
    const key = norm.toLowerCase();
    if (cur.some((c) => c.hex.toLowerCase() === key)) return false;
    cur.unshift({ hex: norm, label: String(label || norm).slice(0, 48) });
    saveCustomBgSwatches(cur);
    return true;
}

export function removeCustomBgSwatchEntry(hex) {
    const key = String(hex || '').toLowerCase();
    const next = loadCustomBgSwatches().filter((c) => c.hex.toLowerCase() !== key);
    saveCustomBgSwatches(next);
}
