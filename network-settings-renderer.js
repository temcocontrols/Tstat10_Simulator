// network-settings-renderer.js
// Dynamically renders the Network Settings menu from network-settings.json into #tstat-lcd-container

import { updateRedboxDebugPanel } from './ui.js';
import { handleRedboxArrowKey } from './events.js';
import { setupDebugToggles } from './debug-toggles.js';
import { updateDebugPanel } from './debug-panel-fixed.js';
import {
    ensureCanonicalSchema,
    validateLayoutData,
    writeStatus,
    attachFloatingPanelDrag,
    widgetAcceptsChildren,
    normalizeWidgetTreeOrder,
    isWidgetDescendantOf,
    applyLayoutRemapToMatchCanvas
} from './lcd-editor-core.js';
import {
    LCD_PLATFORM_PRESETS,
    resolveLcdPresetSelection,
    getLcdPresetById,
    canvasPixelSizeForPresetOrientation,
    inferOrientationFromPresetAndCanvas
} from './lcd-platform-presets.js';
import {
    TSTAT10_LCD_WIDTH,
    TSTAT10_LCD_HEIGHT,
    TSTAT10_FW_BG_CSS,
    TSTAT10_FW_HIGHLIGHT_CSS,
    TSTAT10_MENU_ROW_PX_DEFAULT,
    TSTAT10_LEGACY_DEVKIT_LCD_W,
    TSTAT10_LEGACY_DEVKIT_LCD_H
} from './tstat10-firmware-display.js';
import {
    clampBackgroundToColorMode,
    quantizeCssColorToRgb565Hex,
    rgb565ToCssHex,
    LCD_THEME_RGB565_SWATCHES,
    INDEXED_BACKGROUND_SWATCHES
} from './lcd-authoring-colors.js';
import {
    FIRMWARE_LCD_COLOR_THEME_LIST,
    FIRMWARE_LCD_THEME_CUSTOM_ID,
    findMatchingFirmwareThemeId,
    applyFirmwareColorThemeToScreenData
} from './lcd-firmware-color-themes.js';
import {
    PROJECT_SCREEN_JSON_PATHS,
    ROUTE_TO_JSON_PATH,
    DEFAULT_STARTUP_JSON_PATH
} from './screen-paths.js';
import { getLcdLibDiskSync, ensureLcdLibDiskCache } from './lcd-lib-client.js';

function resolvedScreenBackgroundCss(data) {
    const raw = (data?.styles?.bg || TSTAT10_FW_BG_CSS).trim() || TSTAT10_FW_BG_CSS;
    const mode = data?.colorProfile?.mode || 'indexed';
    return clampBackgroundToColorMode(raw, mode);
}

const DEFAULT_LCD_W = TSTAT10_LCD_WIDTH;
const DEFAULT_LCD_H = TSTAT10_LCD_HEIGHT;

/** Inspector → Screen: `layout.lcdTextColumns` / `lcdTextRows` bounds (overlay + horizontal snap). */
const LCD_GRID_COLS_MIN = 4;
const LCD_GRID_COLS_MAX = 48;
const LCD_GRID_ROWS_MIN = 4;
const LCD_GRID_ROWS_MAX = 48;

function clampGridDimensionInput(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

/** Logical canvas width from screen JSON (fallback: `TSTAT10_LCD_WIDTH`). */
function canvasLogicalWidthPx(data) {
    return (
        Number(
            data?.layout?.lcdCanvas?.width ||
                data?.layout?.canvas?.width ||
                data?.canvasProfile?.width ||
                DEFAULT_LCD_W
        ) || DEFAULT_LCD_W
    );
}

/** Logical canvas height from screen JSON (fallback: `TSTAT10_LCD_HEIGHT`). */
function canvasLogicalHeightPx(data) {
    return (
        Number(
            data?.layout?.lcdCanvas?.height ||
                data?.layout?.canvas?.height ||
                data?.canvasProfile?.height ||
                DEFAULT_LCD_H
        ) || DEFAULT_LCD_H
    );
}

/** True when a stored pixel dimension is within `tol` of a legacy template value. */
function nearIntPx(a, b, tol = 2) {
    return Math.abs(Number(a) - Number(b)) < tol;
}

/** Parse #rrggbb for grid tinting; returns null if not a 6-digit hex. */
function parseHexColorRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** `#rrggbb` for `<input type="color">`, or null if the string is not a usable CSS color. */
function cssColorToHex6ForPicker(css) {
    const raw = String(css || '').trim();
    if (!raw) return null;
    const rgb = parseHexColorRgb(raw);
    if (rgb) {
        const h = (n) => ('0' + n.toString(16)).slice(-2);
        return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
    }
    const m3 = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(raw);
    if (m3) {
        const e = (c) => ('0' + parseInt(c + c, 16).toString(16)).slice(-2);
        return `#${e(m3[1])}${e(m3[2])}${e(m3[3])}`;
    }
    try {
        const el = document.createElement('span');
        el.style.color = '';
        el.style.color = raw;
        if (!el.style.color) return null;
        document.documentElement.appendChild(el);
        const computed = getComputedStyle(el).color;
        el.remove();
        const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(computed);
        if (!m) return null;
        const toH = (n) =>
            ('0' + Math.max(0, Math.min(255, parseInt(n, 10))).toString(16)).slice(-2);
        return `#${toH(m[1])}${toH(m[2])}${toH(m[3])}`;
    } catch {
        return null;
    }
}

/** Grid overlay: lighter wash from `styles.bg`, slightly brighter lines. */
function lcdGridOverlayColorsFromBg(bgCss) {
    const rgb = parseHexColorRgb(bgCss);
    if (!rgb) {
        return {
            wash: 'rgba(255,255,255,0.12)',
            line: 'rgba(255,255,255,0.35)'
        };
    }
    const mix = (t) => ({
        r: Math.round(rgb.r + (255 - rgb.r) * t),
        g: Math.round(rgb.g + (255 - rgb.g) * t),
        b: Math.round(rgb.b + (255 - rgb.b) * t)
    });
    const w = mix(0.12);
    const ln = mix(0.38);
    return {
        wash: `rgba(${w.r},${w.g},${w.b},0.35)`,
        line: `rgba(${ln.r},${ln.g},${ln.b},0.65)`
    };
}

function injectLcdSnapGridOverlay(lcdEl, screenData, widthPx, heightPx) {
    if (!lcdEl) return;
    const prev = lcdEl.querySelector('.debug-grid');
    if (prev) prev.remove();
    if (!window._tstatShowGridLayer) return;
    const data = screenData || window._currentScreenData;
    if (!data) return;
    const rows = data.layout?.lcdTextRows || 10;
    const cols = data.layout?.lcdTextColumns || 16;
    const w = Math.max(1, Number(widthPx) || DEFAULT_LCD_W);
    const h = Math.max(1, Number(heightPx) || DEFAULT_LCD_H);
    const cellW = w / cols;
    const cellH = h / rows;
    const bg = resolvedScreenBackgroundCss(data);
    const { wash, line } = lcdGridOverlayColorsFromBg(bg);

    const grid = document.createElement('div');
    grid.className = 'debug-grid';
    grid.style.zIndex = '0';
    grid.style.pointerEvents = 'none';
    grid.style.position = 'absolute';
    grid.style.left = '0';
    grid.style.top = '0';
    grid.style.width = `${w}px`;
    grid.style.height = `${h}px`;
    grid.style.background = wash;
    grid.style.boxSizing = 'border-box';

    for (let c = 1; c < cols; c++) {
        const vline = document.createElement('div');
        vline.style.position = 'absolute';
        vline.style.left = `${c * cellW}px`;
        vline.style.top = '0';
        vline.style.width = '1px';
        vline.style.height = `${h}px`;
        vline.style.background = line;
        vline.style.zIndex = '1';
        grid.appendChild(vline);
    }
    for (let r = 1; r <= rows; r++) {
        const hline = document.createElement('div');
        hline.style.position = 'absolute';
        hline.style.left = '0';
        hline.style.top = `${(r - 1) * cellH}px`;
        hline.style.width = `${w}px`;
        hline.style.height = '1px';
        hline.style.background = line;
        hline.style.zIndex = '1';
        grid.appendChild(hline);
    }
    lcdEl.insertBefore(grid, lcdEl.firstChild);
}

const SIMULATED_LR_LONG_PRESS_MS = 3000;
let _leftRightLongPressTimer = null;
let _leftArrowDown = false;
let _rightArrowDown = false;

function clearLeftRightLongPressTimer() {
    if (_leftRightLongPressTimer) {
        clearTimeout(_leftRightLongPressTimer);
        _leftRightLongPressTimer = null;
    }
}

function performMainDisplayEnterSetupMenu() {
    const page = window._currentScreenData?.page;
    if (page !== 'MAIN_DISPLAY') return;
    window._ipEditMode = false;
    window._valueEditMode = false;
    window.navigateTo('setup');
}

function tryStartLeftRightLongPressTimer() {
    if (!_leftArrowDown || !_rightArrowDown || _leftRightLongPressTimer) return;
    _leftRightLongPressTimer = setTimeout(() => {
        _leftRightLongPressTimer = null;
        if (_leftArrowDown && _rightArrowDown) {
            performMainDisplayEnterSetupMenu();
        }
    }, SIMULATED_LR_LONG_PRESS_MS);
}

/** Escape text for safe insertion into innerHTML */
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * IPv4 with aligned periods: fixed-width octet spans so dots line up vertically across rows.
 */
function formatIPv4AlignedHtml(value, activeOctetIndex = null) {
    const s = String(value).trim();
    const parts = s.split('.');
    if (parts.length !== 4) return null;
    if (!parts.every(p => /^\d{1,3}$/.test(p))) return null;
    const oct = (p, idx) => {
        const activeClass = idx === activeOctetIndex ? ' tstat-ipv4-oct--active' : '';
        return `<span class="tstat-ipv4-oct${activeClass}">${escapeHtml(p)}</span>`;
    };
    const dot = '<span class="tstat-ipv4-dot">.</span>';
    return `${oct(parts[0], 0)}${dot}${oct(parts[1], 1)}${dot}${oct(parts[2], 2)}${dot}${oct(parts[3], 3)}`;
}

function ensureIpv4AlignedStyles() {
    if (document.getElementById('tstat-ipv4-styles')) return;
    const st = document.createElement('style');
    st.id = 'tstat-ipv4-styles';
    st.textContent = `
        #tstat-lcd-container .tstat-ipv4-oct {
            display: inline-block;
            width: 3ch;
            text-align: right;
            font-variant-numeric: tabular-nums;
            border-radius: 4px;
            padding: 1px 2px;
        }
        #tstat-lcd-container .tstat-ipv4-oct--active {
            background: #f59e0b;
            color: #0f172a;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.35);
        }
        #tstat-lcd-container .tstat-ipv4-dot { display: inline-block; }
        #tstat-lcd-container .tstat-value-box.tstat-endpoint-flash {
            background: #ef4444 !important;
            color: #ffffff !important;
            box-shadow: 0 0 0 2px rgba(127, 29, 29, 0.45) inset;
        }
        #tstat-lcd-container .tstat-value-box.tstat-edit-active {
            box-shadow: 0 0 0 2px #f59e0b inset;
            border-color: #f59e0b !important;
            background: #fff7ed !important;
            color: #7c2d12 !important;
        }
    `;
    document.head.appendChild(st);
}

function getScreenStateMap() {
    if (!window._screenStateByJsonPath) window._screenStateByJsonPath = {};
    return window._screenStateByJsonPath;
}

function cacheKeyForJsonPath(jsonPath) {
    return `tstat_cache_${jsonPath}`;
}

function saveScreenToCache(jsonPath, data) {
    if (!jsonPath || !data) return;
    try {
        localStorage.setItem(cacheKeyForJsonPath(jsonPath), JSON.stringify(data, null, 2));
    } catch (err) {
        console.warn('[Visual Edit] Failed to persist cache:', err);
    }
}

function loadScreenFromCache(jsonPath) {
    try {
        const raw = localStorage.getItem(cacheKeyForJsonPath(jsonPath));
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('[Visual Edit] Failed to read cache:', err);
        return null;
    }
}

/** Workbench LCD translate (Alt+arrows / edge drag) — mirror globals ↔ `canvasProfile` so cache + JSON drafts stay aligned. */
function syncWorkbenchNudgeIntoScreenDataForCache(data) {
    if (!data || typeof data !== 'object') return;
    if (!data.canvasProfile) data.canvasProfile = {};
    data.canvasProfile.previewOffsetX = Math.round(Number(window._tstatLcdNudgeX) || 0);
    data.canvasProfile.previewOffsetY = Math.round(Number(window._tstatLcdNudgeY) || 0);
}

function mergeProjectBackgroundIntoScreenData(screenData, bgCss) {
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
function mergeProjectFirmwareThemeIntoScreenData(screenData, bgCss, highlightCss, colorMode) {
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

function propagateProjectWideFirmwareTheme(bgCss, highlightCss, currentJsonPath, colorMode) {
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
function propagateProjectWideBackground(bgCss, currentJsonPath) {
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

function getIconPaletteStorageKey() {
    return 'tstat_icon_palette_custom_svgs_v2';
}

function loadCustomPaletteSvgs() {
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

function saveCustomPaletteSvgs(list) {
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

/**
 * Simulator uses one logical framebuffer for every route (same as production Tstat10).
 * Normalizes JSON/cache so navigation never resizes the LCD or flips orientation.
 */
function enforceSimulatorFixedLcdCanvas(data) {
    if (!data || typeof data !== 'object') return;
    const w = TSTAT10_LCD_WIDTH;
    const h = TSTAT10_LCD_HEIGHT;
    if (!data.canvasProfile) data.canvasProfile = {};
    data.canvasProfile.width = w;
    data.canvasProfile.height = h;
    data.canvasProfile.orientation = 'vertical';
    data.canvasProfile.lcdPresetId = 'tstat10_fw_240';
    if (!data.layout) data.layout = {};
    data.layout.lcdCanvas = { width: w, height: h };
    data.layout.canvas = { width: w, height: h };
    data.layout.orientation = 'vertical';
}

function ensureMainDisplayIconLayout(data) {
    if (!data || data.page !== 'MAIN_DISPLAY') return;
    if (!Array.isArray(data.widgets)) data.widgets = [];
    const ch = Number(data.layout?.lcdCanvas?.height || data.canvasProfile?.height || DEFAULT_LCD_H);
    const cw = Number(data.layout?.lcdCanvas?.width || data.canvasProfile?.width || DEFAULT_LCD_W);
    const maxY = Math.max(0, ch - 64);
    const clampY = (y) => Math.max(0, Math.min(maxY, Number(y || 0)));
    const iconIds = ['main_icon_day_night', 'main_icon_occupied', 'main_icon_heat_cool', 'main_icon_fan'];
    const group = data.widgets.find((w) => w?.id === 'main_icons_group');
    const parts = data.widgets.filter((w) => iconIds.includes(w?.id));

    if (!group && parts.length === 0) {
        const stripW = Math.max(120, cw - 16);
        const innerW = Math.max(100, stripW - 24);
        data.widgets.push({
            type: 'label',
            id: 'main_icons_group',
            text: `<div style="display:flex;gap:10px;justify-content:center;align-items:center;width:${innerW}px;box-sizing:border-box;padding:0 8px"></div>`,
            x: Math.round(cw / 2),
            y: Math.min(maxY, ch - 72),
            align: 'center',
            color: '#ffffff',
            wrap: true,
            width: stripW
        });
    }

    data.widgets.forEach((w) => {
        if (!w || w.type !== 'label') return;
        const iconLikeText = typeof w.text === 'string' && (
            w.text.includes('title="Day / night"') ||
            w.text.includes('title="Occupied / unoccupied"') ||
            w.text.includes('title="Heat / cool"') ||
            w.text.includes('title="Fan"')
        );
        const iconLikeId = (typeof w.id === 'string' && w.id.startsWith('main_icon_')) || iconIds.includes(w.id);
        if (w.id === 'main_icons_group' || iconLikeId || iconLikeText) {
            w.y = clampY(w.y);
        }
    });
}

function resolveMenuRowLabel(widget) {
    const base = String(widget?.label || '');
    const custom = String(widget?.labelCustom ?? base);
    const mode = String(widget?.labelDisplayMode || '').toLowerCase();
    if (mode === 'none') return '';
    if (mode === '8char') return custom.slice(0, 8);
    if (mode === '20char') return custom.slice(0, 20);
    if (mode === 'custom') return custom;
    // Backward-compatible default behavior.
    return base;
}

function inferMenuRowTreeName(widget) {
    const id = String(widget?.id || '').toLowerCase();
    const label = String(widget?.label || '').trim();
    const value = String(widget?.value ?? '').trim();
    const known = {
        ui_item_ip: 'IP Address',
        ui_item_mask: 'Subnet Mask',
        ui_item_gw: 'Gateway',
        ui_item_dhcp: 'DHCP',
        ui_item_prov_ap: 'AP',
        ui_item_prov_pwd: 'Provisioning Password',
        ui_item_prov_ssid: 'Network (from phone)',
        ui_item_prov_pass: 'Pass',
        ui_item_prov_status: 'Status',
        ui_item_prov_rssi: 'RSSI',
        ui_item_prov_rssi_quality: 'Signal strength',
        ui_item_addr: 'Device Address',
        ui_item_baud: 'Baud Rate'
    };
    if (known[id]) return known[id];
    if (label.toUpperCase() === 'IP') return 'IP Address';
    if (label.toUpperCase() === 'MASK') return 'Subnet Mask';
    if (label.toUpperCase() === 'GATE') return 'Gateway';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return `${label || 'IPv4'} Address`;
    return label || widget?.id || 'Row';
}

function getWidgetTreeName(widget) {
    if (!widget || typeof widget !== 'object') return '(unnamed)';
    if (typeof widget.treeName === 'string' && widget.treeName.trim()) return widget.treeName.trim();
    if (widget.type === 'menu_row') return inferMenuRowTreeName(widget);
    if (widget.type === 'label' && (widget.libraryIconName || widget.libraryIconId)) {
        return `Icon ${widget.libraryIconName || widget.libraryIconId}`;
    }
    if (widget.id) return widget.id;
    if (widget.label) return widget.label;
    if (typeof widget.text === 'string' && widget.text.trim()) {
        const raw = widget.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return raw || '(unnamed)';
    }
    return '(unnamed)';
}

function getLastScreenStorageKey() {
    return 'tstat_last_screen_v1';
}

function saveLastScreenPath(jsonPath) {
    if (!jsonPath) return;
    try {
        localStorage.setItem(getLastScreenStorageKey(), String(jsonPath));
    } catch {}
}

function loadLastScreenPath() {
    try {
        const v = localStorage.getItem(getLastScreenStorageKey());
        return v || null;
    } catch {
        return null;
    }
}

function ensureT3000PointState() {
    if (!window._t3000PointState) {
        window._t3000PointState = {};
        for (let i = 1; i <= 9; i += 1) {
            window._t3000PointState[`IN${i}`] = { name: `Input ${i}`, value: i === 9 ? 22.4 : 0 };
        }
        for (let i = 1; i <= 4; i += 1) {
            window._t3000PointState[`VAR${i}`] = { name: `Variable ${i}`, value: 0 };
        }
        // Requested default: occupied icon follows VAR4.
        window._t3000PointState.VAR4.value = 1;
    }
    return window._t3000PointState;
}

function getT3000PointOptions(prefix) {
    const state = ensureT3000PointState();
    const points = Object.keys(state)
        .filter((k) => !prefix || k.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return points.map((key) => ({
        key,
        label: `${key} - ${state[key].name}: ${state[key].value}`
    }));
}

function getT3000PointValue(pointKey) {
    if (!pointKey) return null;
    const state = ensureT3000PointState();
    return state[pointKey] ? state[pointKey].value : null;
}

function asBoolean(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const normalized = String(v ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

function buildMainIconMarkup(iconKey, active) {
    const occupiedPerson = active
        ? '<circle cx="24" cy="33" r="2.5" fill="#fff"/><path d="M24 35.5v3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M21 38h6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>'
        : '<circle cx="39" cy="33" r="2.5" fill="#fff"/><path d="M39 35.5v3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M36 38h6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>';
    const iconMap = {
        day_night: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="20" r="5" fill="#fff"/><path d="M13 11v2M13 27v2M7 20h2M17 20h2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="33" cy="20" r="7" fill="#fff"/><circle cx="37" cy="20" r="6.5" fill="#2c7cc4"/></svg>',
        occupied: `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 28 L24 16 L38 28" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="12" y="28" width="24" height="12" stroke="#fff" stroke-width="1.5" fill="none"/><path d="M20 40v-7h8v7" stroke="#fff" stroke-width="1.2" fill="none"/>${occupiedPerson}</svg>`,
        heat_cool: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 30c-4-8 6-12 6-20 0 8 8 8 4 10-4-2-2-12-2-10z" fill="#fff"/><line x1="23" y1="10" x2="23" y2="38" stroke="#fff" stroke-width="2" stroke-linecap="round"/><g transform="translate(36,24)" stroke="#fff" stroke-width="1.2" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="9"/><line x1="-7.8" y1="-4.5" x2="7.8" y2="4.5"/><line x1="-7.8" y1="4.5" x2="7.8" y2="-4.5"/></g></svg>',
        fan: '<svg width="50" height="50" viewBox="0 0 52 48" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(14,24)"><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(120)"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(240)"/></g><circle cx="14" cy="24" r="2.5" fill="#fff"/><line x1="28" y1="8" x2="28" y2="40" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="31" y="10" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="19" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="28" width="11" height="8" rx="0.5" fill="#e8f4ff" stroke="#fff" stroke-width="1.2"/></svg>'
    };
    const activeBg = active ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)';
    return `<div data-icon-key="${iconKey}" style="width:54px;height:54px;border:1px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;background:${activeBg}">${iconMap[iconKey]}</div>`;
}

function renderMainIconsGroupText(widget) {
    const bindings = widget.t3IconBindings || {};
    const icons = [
        ['day_night', bindings.day_night || 'VAR1'],
        ['occupied', bindings.occupied || 'VAR4'],
        ['heat_cool', bindings.heat_cool || 'VAR2'],
        ['fan', bindings.fan || 'VAR3']
    ];
    const html = icons.map(([iconKey, point]) => buildMainIconMarkup(iconKey, asBoolean(getT3000PointValue(point)))).join('');
    const cw = canvasLogicalWidthPx(window._currentScreenData || {});
    const sx = cw / TSTAT10_LEGACY_DEVKIT_LCD_W;
    const innerW = Math.max(120, Math.round(296 * sx));
    const gap = Math.max(4, Math.round(10 * sx));
    const padH = Math.max(4, Math.round(8 * sx));
    return `<div style="display:flex;gap:${gap}px;justify-content:center;align-items:center;width:${innerW}px;box-sizing:border-box;padding:0 ${padH}px">${html}</div>`;
}

function isIpv4RowId(rowId) {
    return rowId === 'ui_item_ip' || rowId === 'ui_item_mask' || rowId === 'ui_item_gw';
}

function triggerEndpointFlash(rowId) {
    if (!rowId) return;
    const row = document.querySelector(`[data-menu-row-id="${rowId}"]`);
    if (!row) return;
    const valueEl = row.querySelector('.tstat-value-box');
    if (!valueEl) return;
    valueEl.classList.remove('tstat-endpoint-flash');
    void valueEl.offsetWidth;
    valueEl.classList.add('tstat-endpoint-flash');
    setTimeout(() => valueEl.classList.remove('tstat-endpoint-flash'), 180);
}

function ungroupMainIcons() {
    const data = window._currentScreenData;
    if (!data || data.page !== 'MAIN_DISPLAY') return false;
    const widgets = data.widgets || [];
    const groupIdx = widgets.findIndex((w) => w.type === 'label' && (w.id === 'main_icons_group' || String(w.text || '').includes('title="Day / night"')));
    if (groupIdx === -1) return false;
    const group = widgets[groupIdx];
    window._mainIconsGroupTemplate = JSON.parse(JSON.stringify(group));
    const cw = canvasLogicalWidthPx(data);
    const ch = canvasLogicalHeightPx(data);
    const sx = cw / TSTAT10_LEGACY_DEVKIT_LCD_W;
    const sy = ch / TSTAT10_LEGACY_DEVKIT_LCD_H;
    /** Positions tuned on legacy 320×480 sim; scaled to current logical canvas. */
    const iconDefs = [
        { id: 'main_icon_day_night', x: 79, y: 352, title: 'Day / night', svg: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="20" r="5" fill="#fff"/><path d="M13 11v2M13 27v2M7 20h2M17 20h2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="33" cy="20" r="7" fill="#fff"/><circle cx="37" cy="20" r="6.5" fill="#2c7cc4"/></svg>' },
        { id: 'main_icon_occupied', x: 143, y: 352, title: 'Occupied / unoccupied', svg: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 28 L24 16 L38 28" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="12" y="28" width="24" height="12" stroke="#fff" stroke-width="1.5" fill="none"/><path d="M20 40v-7h8v7" stroke="#fff" stroke-width="1.2" fill="none"/><circle cx="24" cy="33" r="2.5" fill="#fff"/><path d="M24 35.5v3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M21 38h6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>' },
        { id: 'main_icon_heat_cool', x: 207, y: 352, title: 'Heat / cool', svg: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 30c-4-8 6-12 6-20 0 8 8 8 4 10-4-2-2-12-2-10z" fill="#fff"/><line x1="23" y1="10" x2="23" y2="38" stroke="#fff" stroke-width="2" stroke-linecap="round"/><g transform="translate(36,24)" stroke="#fff" stroke-width="1.2" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="9"/><line x1="-7.8" y1="-4.5" x2="7.8" y2="4.5"/><line x1="-7.8" y1="4.5" x2="7.8" y2="-4.5"/></g></svg>' },
        { id: 'main_icon_fan', x: 271, y: 352, title: 'Fan', svg: '<svg width="50" height="50" viewBox="0 0 52 48" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(14,24)"><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(120)"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(240)"/></g><circle cx="14" cy="24" r="2.5" fill="#fff"/><line x1="28" y1="8" x2="28" y2="40" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="31" y="10" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="19" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="28" width="11" height="8" rx="0.5" fill="#e8f4ff" stroke="#fff" stroke-width="1.2"/></svg>' }
    ];
    const ungrouped = iconDefs.map((d) => ({
        type: 'label',
        id: d.id,
        text: `<div style="width:54px;height:54px;border:1px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.1)" title="${d.title}">${d.svg}</div>`,
        x: Math.round(Number(d.x) * sx),
        y: Math.round(Number(d.y) * sy),
        align: 'center',
        color: '#ffffff'
    }));
    widgets.splice(groupIdx, 1, ...ungrouped);
    return true;
}

function regroupMainIcons() {
    const data = window._currentScreenData;
    if (!data || data.page !== 'MAIN_DISPLAY') return false;
    const widgets = data.widgets || [];
    const cw = canvasLogicalWidthPx(data);
    const ch = canvasLogicalHeightPx(data);
    const sx = cw / TSTAT10_LEGACY_DEVKIT_LCD_W;
    const sy = ch / TSTAT10_LEGACY_DEVKIT_LCD_H;
    const defaultIconRowY = Math.round(352 * sy);
    const ids = ['main_icon_day_night', 'main_icon_occupied', 'main_icon_heat_cool', 'main_icon_fan'];
    const parts = widgets.filter((w) => ids.includes(w.id));
    if (parts.length !== 4) return false;
    const minX = Math.min(...parts.map((p) => Number(p.x || Math.round(160 * sx))));
    const avgY = Math.round(parts.reduce((a, b) => a + Number(b.y || defaultIconRowY), 0) / parts.length);
    const gapT = Math.max(4, Math.round(10 * sx));
    const padT = Math.max(4, Math.round(8 * sx));
    const innerWT = Math.max(120, Math.round(296 * sx));
    const template = window._mainIconsGroupTemplate || {
        type: 'label',
        id: 'main_icons_group',
        text: `<div style="display:flex;gap:${gapT}px;justify-content:center;align-items:center;width:${innerWT}px;box-sizing:border-box;padding:0 ${padT}px"></div>`,
        x: Math.round(160 * sx),
        y: defaultIconRowY,
        align: 'center',
        color: '#ffffff',
        wrap: true,
        width: Math.round(320 * sx)
    };
    const grouped = { ...template, id: 'main_icons_group', x: minX + Math.round(96 * sx), y: avgY, align: 'center' };
    const firstIdx = widgets.findIndex((w) => ids.includes(w.id));
    const filtered = widgets.filter((w) => !ids.includes(w.id));
    filtered.splice(firstIdx >= 0 ? firstIdx : filtered.length, 0, grouped);
    data.widgets = filtered;
    return true;
}

function removeExistingPropertyEditor() {
    const existing = document.getElementById('layout-property-editor');
    if (existing) existing.remove();
}

function removeExistingTreeContextMenu() {
    const existing = document.getElementById('layout-tree-context-menu');
    if (existing) existing.remove();
}

function removeExistingCanvasPickMenu() {
    const existing = document.getElementById('layout-canvas-pick-menu');
    if (existing) existing.remove();
}

/** SquareLine-style: right-click on LCD shows widgets under the cursor (overlapping pick). */
function openCanvasWidgetPickMenu(e) {
    if (!window._isVisualEditMode) return;
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const seen = new Set();
    const picks = [];
    for (const el of stack) {
        const t = el.closest?.('[data-tree-node-id]');
        if (!t) continue;
        const id = t.getAttribute('data-tree-node-id');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const data = window._currentScreenData;
        const n = data ? findLayoutTreeNodeById(id, data) : null;
        picks.push({ id, label: (n && n.text) ? String(n.text) : id });
    }
    if (picks.length === 0) return;
    e.preventDefault();
    removeExistingCanvasPickMenu();
    const menu = document.createElement('div');
    menu.id = 'layout-canvas-pick-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10040';
    menu.style.background = '#111827';
    menu.style.color = '#e5e7eb';
    menu.style.border = '1px solid #374151';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    menu.style.padding = '6px';
    menu.style.minWidth = '220px';
    menu.style.maxHeight = 'min(360px, 60vh)';
    menu.style.overflowY = 'auto';
    menu.style.fontFamily = 'Segoe UI, Inter, Arial, sans-serif';
    menu.style.fontSize = '12px';
    const title = document.createElement('div');
    title.textContent = 'Select widget';
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    title.style.color = '#a7f3d0';
    menu.appendChild(title);
    picks.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = p.label;
        btn.style.display = 'block';
        btn.style.width = '100%';
        btn.style.textAlign = 'left';
        btn.style.padding = '6px 8px';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.background = 'transparent';
        btn.style.color = '#e5e7eb';
        btn.style.cursor = 'pointer';
        btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        btn.addEventListener('click', () => {
            removeExistingCanvasPickMenu();
            if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(p.id);
            const jp = window._currentJsonPath;
            if (jp) renderScreen(jp);
        });
        menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const close = (evt) => {
        if (!menu.contains(evt.target)) {
            removeExistingCanvasPickMenu();
            document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function ensureLcdCanvasPickMenuAttached(lcd) {
    if (!lcd || lcd._slsCanvasPickBound) return;
    lcd._slsCanvasPickBound = true;
    lcd.addEventListener('contextmenu', openCanvasWidgetPickMenu);
}

function getParentIdSelectOptions(widgets, selectedIdx) {
    const opts = [{ value: '', label: '(screen root)' }];
    if (!Array.isArray(widgets) || selectedIdx < 0) return opts;
    widgets.forEach((w, i) => {
        if (!w || i === selectedIdx) return;
        if (!widgetAcceptsChildren(w)) return;
        if (isWidgetDescendantOf(widgets, i, selectedIdx)) return;
        const label = w.treeName || w.id || `widget ${i}`;
        opts.push({ value: w.id, label: `${label} (${w.type || 'item'})` });
    });
    return opts;
}

function openTreeContextMenu(e, node, jsonPath, rerender) {
    removeExistingTreeContextMenu();
    if (node?.childKind === 'lcd_outline') {
        const menu = document.createElement('div');
        menu.id = 'layout-tree-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.zIndex = '10030';
        menu.style.background = '#111827';
        menu.style.color = '#e5e7eb';
        menu.style.border = '1px solid #374151';
        menu.style.borderRadius = '8px';
        menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
        menu.style.padding = '6px';
        menu.style.minWidth = '210px';
        menu.style.fontFamily = 'Segoe UI, Inter, Arial, sans-serif';
        menu.style.fontSize = '12px';
        const addItem = (label, handler) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.style.display = 'block';
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            btn.style.padding = '6px 8px';
            btn.style.border = 'none';
            btn.style.borderRadius = '6px';
            btn.style.background = 'transparent';
            btn.style.color = '#e5e7eb';
            btn.style.cursor = 'pointer';
            btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
            btn.onclick = () => {
                handler?.();
                menu.remove();
            };
            menu.appendChild(btn);
        };
        addItem('Reset LCD position (workbench)', () => {
            window._tstatLcdNudgeX = 0;
            window._tstatLcdNudgeY = 0;
            window._persistTstatLcdNudge?.();
            window._applyTstatLcdNudgeTransform?.();
            window._syncTstatLcdEdgeDragLayer?.();
            const d = window._currentScreenData;
            if (d?.canvasProfile) {
                d.canvasProfile.previewOffsetX = 0;
                d.canvasProfile.previewOffsetY = 0;
            }
            rerender(jsonPath);
        });
        addItem('Undo', () => window._undoLayoutChange?.());
        document.body.appendChild(menu);
        setTimeout(() => {
            const closeOnOutside = (evt) => {
                if (!menu.contains(evt.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', closeOnOutside);
                }
            };
            document.addEventListener('mousedown', closeOnOutside);
        }, 0);
        return;
    }
    if (node?.childKind === 'shell_hw_group' || node?.childKind === 'shell_hw_button' || node?.childKind === 'shell_ref_photo') {
        const menu = document.createElement('div');
        menu.id = 'layout-tree-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;
        menu.style.zIndex = '10030';
        menu.style.background = '#111827';
        menu.style.color = '#e5e7eb';
        menu.style.border = '1px solid #374151';
        menu.style.borderRadius = '8px';
        menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
        menu.style.padding = '6px';
        menu.style.minWidth = '210px';
        menu.style.fontFamily = 'Segoe UI, Inter, Arial, sans-serif';
        menu.style.fontSize = '12px';
        const addItem = (label, handler) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.textContent = label;
            btn.style.display = 'block';
            btn.style.width = '100%';
            btn.style.textAlign = 'left';
            btn.style.padding = '6px 8px';
            btn.style.border = 'none';
            btn.style.borderRadius = '6px';
            btn.style.background = 'transparent';
            btn.style.color = '#e5e7eb';
            btn.style.cursor = 'pointer';
            btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
            btn.onclick = () => {
                handler?.();
                menu.remove();
            };
            menu.appendChild(btn);
        };
        if (node.childKind === 'shell_ref_photo') {
            addItem('Hide reference overlay', () => {
                if (typeof window._hideShellRefPhoto === 'function') window._hideShellRefPhoto();
            });
        }
        addItem('Undo', () => window._undoLayoutChange?.());
        document.body.appendChild(menu);
        setTimeout(() => {
            const closeOnOutside = (evt) => {
                if (!menu.contains(evt.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', closeOnOutside);
                }
            };
            document.addEventListener('mousedown', closeOnOutside);
        }, 0);
        return;
    }
    const menu = document.createElement('div');
    menu.id = 'layout-tree-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10030';
    menu.style.background = '#111827';
    menu.style.color = '#e5e7eb';
    menu.style.border = '1px solid #374151';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    menu.style.padding = '6px';
    menu.style.minWidth = '210px';
    menu.style.fontFamily = "Segoe UI, Inter, Arial, sans-serif";
    menu.style.fontSize = '12px';

    const addItem = (label, handler, danger = false) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.display = 'block';
        btn.style.width = '100%';
        btn.style.textAlign = 'left';
        btn.style.padding = '6px 8px';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.background = 'transparent';
        btn.style.color = danger ? '#fecaca' : '#e5e7eb';
        btn.style.cursor = 'pointer';
        btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        btn.onclick = () => {
            handler?.();
            menu.remove();
        };
        menu.appendChild(btn);
    };

    const addSep = () => {
        const hr = document.createElement('div');
        hr.style.height = '1px';
        hr.style.margin = '6px 2px';
        hr.style.background = '#374151';
        menu.appendChild(hr);
    };

    const isWidgetNode = node?.childKind === 'widget';
    const idxMatch = String(node?.id || '').match(/^w-(\d+)$/);
    const widgetIndex = idxMatch ? Number(idxMatch[1]) : -1;
    const widgets = window._currentScreenData?.widgets || [];
    const widget = (widgetIndex >= 0 && widgetIndex < widgets.length) ? widgets[widgetIndex] : node?.widget;

    addItem('Rename', () => {
        const next = window.prompt('Tree name', String(widget?.treeName || getWidgetTreeName(widget) || ''));
        if (next === null) return;
        if (!widget) return;
        const clean = String(next).trim();
        if (!clean) delete widget.treeName;
        else widget.treeName = clean;
        rerender(jsonPath);
    });

    if (
        widget &&
        (isWidgetNode || node?.childKind === 'label' || node?.childKind === 'value' || node?.childKind === 'group_icon')
    ) {
        addItem('Edit properties…', () => {
            openPropertyEditorMenu(e, node, () => rerender(jsonPath));
        });
    }

    if (isWidgetNode && widgetIndex >= 0) {
        addItem('Duplicate', () => {
            if (typeof window._duplicateSelectedLayoutNode === 'function') {
                window._selectLayoutNode?.(node.id);
                window._duplicateSelectedLayoutNode();
            } else {
                const copy = JSON.parse(JSON.stringify(widget));
                if (copy?.id) copy.id = `${copy.id}_copy`;
                widgets.splice(widgetIndex + 1, 0, copy);
                rerender(jsonPath);
            }
        });
        addItem('Delete', () => {
            window._selectLayoutNode?.(node.id);
            window._deleteSelectedLayoutNode?.();
        }, true);
        addSep();
        addItem('Bring To Front', () => {
            if (widgetIndex < 0 || widgetIndex >= widgets.length) return;
            const [w] = widgets.splice(widgetIndex, 1);
            widgets.push(w);
            window._layoutSelectedNodeId = `w-${widgets.length - 1}`;
            rerender(jsonPath);
        });
        addItem('Send To Back', () => {
            if (widgetIndex < 0 || widgetIndex >= widgets.length) return;
            const [w] = widgets.splice(widgetIndex, 1);
            widgets.unshift(w);
            window._layoutSelectedNodeId = 'w-0';
            rerender(jsonPath);
        });
        addItem('Move Up', () => {
            if (widgetIndex <= 0) return;
            const tmp = widgets[widgetIndex - 1];
            widgets[widgetIndex - 1] = widgets[widgetIndex];
            widgets[widgetIndex] = tmp;
            window._layoutSelectedNodeId = `w-${widgetIndex - 1}`;
            rerender(jsonPath);
        });
        addItem('Move Down', () => {
            if (widgetIndex < 0 || widgetIndex >= widgets.length - 1) return;
            const tmp = widgets[widgetIndex + 1];
            widgets[widgetIndex + 1] = widgets[widgetIndex];
            widgets[widgetIndex] = tmp;
            window._layoutSelectedNodeId = `w-${widgetIndex + 1}`;
            rerender(jsonPath);
        });
    }

    if (widget?.id === 'main_icons_group') {
        addSep();
        addItem('Ungroup Icons', () => {
            if (typeof ungroupMainIcons === 'function' && ungroupMainIcons()) rerender(jsonPath);
        });
    }

    addSep();
    addItem('Undo', () => window._undoLayoutChange?.());

    document.body.appendChild(menu);
    setTimeout(() => {
        const closeOnOutside = (evt) => {
            if (!menu.contains(evt.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        document.addEventListener('mousedown', closeOnOutside);
    }, 0);
}

/** Menu/blank rows share lcdRow vertical slots; label/header use canvas x/y (not row slots). */
function isRowSlotWidget(w) {
    return !!w && (w.type === 'menu_row' || w.type === 'blank');
}
function isLabelLikeLayoutWidget(w) {
    return !!w && (w.type === 'label' || w.type === 'header');
}

/** CSS modifier classes for SquareLine-style hierarchy row / icon chip appearance. */
function getLayoutTreeNodeLayoutClasses(n) {
    const parts = [];
    const w = n.widget;
    if (n.childKind === 'widget' && w && typeof w.type === 'string') {
        const t = w.type.replace(/[^a-z0-9_-]/gi, '');
        if (t) parts.push(`layout-tree-node--wtype-${t}`);
    }
    if (n.childKind === 'label') parts.push('layout-tree-node--part-label');
    else if (n.childKind === 'value') parts.push('layout-tree-node--part-value');
    else if (n.childKind === 'group_icon') parts.push('layout-tree-node--part-icon');
    else if (n.childKind === 'lcd_outline') parts.push('layout-tree-node--lcd-outline');
    else if (n.childKind === 'shell_hw_group') parts.push('layout-tree-node--shell-hw-group');
    else if (n.childKind === 'shell_hw_button') parts.push('layout-tree-node--shell-hw-btn');
    else if (n.childKind === 'shell_ref_photo') parts.push('layout-tree-node--shell-ref-photo');
    else if (n.childKind === 'tstat_body_folder') parts.push('layout-tree-node--tstat-body-folder');
    else if (n.childKind === 'shell_bezel') parts.push('layout-tree-node--shell-bezel');
    else if (n.childKind === 'shell_compass_logo') parts.push('layout-tree-node--shell-compass');
    else if (n.childKind === 'shell_lock_control') parts.push('layout-tree-node--shell-lock');
    return parts.join(' ');
}

/**
 * Reorder drops (tree or LCD): only swap/move among peers — rows↔rows, labels/headers↔labels/headers,
 * otherwise same widget type only (no dropping a row onto a label or mixing unrelated types).
 */
function layoutDropTargetsSameHierarchy(fromW, toW) {
    if (!fromW || !toW || fromW === toW) return false;
    if (isRowSlotWidget(fromW) && isRowSlotWidget(toW)) return true;
    if (isLabelLikeLayoutWidget(fromW) && isLabelLikeLayoutWidget(toW)) return true;
    if (isRowSlotWidget(fromW) || isLabelLikeLayoutWidget(fromW)) return false;
    if (isRowSlotWidget(toW) || isLabelLikeLayoutWidget(toW)) return false;
    return fromW.type === toW.type;
}

function normalizeLcdRowSlot(n) {
    const r = Math.round(Number(n));
    return Number.isFinite(r) && r > 0 ? r : 1;
}

/**
 * True when the LCD/hierarchy selection refers to the same widget index as `nodeId`.
 * Lets row `w-3`, `w-3-label`, and `w-3-value` all act as one selection for resize/drag handles.
 * Does not match `w-3-icon-*` to value/label (different subtree).
 */
function layoutTreeSelectionMatchesNode(selectedId, nodeId) {
    if (!selectedId || !nodeId) return true;
    if (selectedId === nodeId) return true;
    const iconRe = /^w-(\d+)-icon-/;
    if (iconRe.test(selectedId) || iconRe.test(nodeId)) return false;
    const rowRe = /^w-(\d+)$/;
    const partRe = /^w-(\d+)-(label|value)$/;
    const mSelRow = selectedId.match(rowRe);
    const mNodeRow = nodeId.match(rowRe);
    const mSelPart = selectedId.match(partRe);
    const mNodePart = nodeId.match(partRe);
    const idxSel = mSelRow?.[1] || mSelPart?.[1];
    const idxNode = mNodeRow?.[1] || mNodePart?.[1];
    if (idxSel !== undefined && idxNode !== undefined && idxSel === idxNode) {
        if (mSelRow || mNodeRow) return true;
        if (mSelPart && mNodePart) return true;
    }
    return false;
}

/** Widget array index for any hierarchy row id: `w-3`, `w-3-label`, `w-3-value`, `w-3-icon-day_night`, … */
function parseWidgetIndexFromLayoutTreeNodeId(id) {
    const m = String(id || '').match(/^w-(\d+)/);
    return m ? Number(m[1]) : -1;
}

function stripTreeNamePastePrefixes(raw) {
    return String(raw || '')
        .replace(/^row\s*::\s*/i, '')
        .replace(/^label\s*::\s*/i, '')
        .replace(/^icon\s*::\s*/i, '')
        .replace(/^menu_row\s*::\s*/i, '')
        .replace(/^header\s*::\s*/i, '')
        .trim();
}

/**
 * In-tree rename for a widget row (treeName). Used by hierarchy double-click and F2.
 * @param {HTMLElement} label
 * @param {object} widgetRef
 * @param {string} displaySnapshotText  Text restored on Escape / initial state
 * @param {string} jsonPath
 * @param {(path: string) => void} rerender
 */
function setupWidgetTreeLabelRename(label, widgetRef, displaySnapshotText, jsonPath, rerender) {
    if (!label || !widgetRef) return;
    if (label.isContentEditable === 'true') return;
    cancelDebouncedSelectLayoutRender();
    label.contentEditable = 'true';
    label.focus();
    document.getSelection()?.selectAllChildren(label);
    const commitRename = () => {
        label.contentEditable = 'false';
        const raw = label.innerText.trim();
        if (!raw) {
            delete widgetRef.treeName;
        } else {
            widgetRef.treeName = stripTreeNamePastePrefixes(raw);
        }
        rerender(jsonPath);
    };
    const cancelRename = () => {
        label.contentEditable = 'false';
        label.textContent = displaySnapshotText;
    };
    const onKey = (kevt) => {
        if (kevt.key === 'Enter') {
            kevt.preventDefault();
            label.removeEventListener('keydown', onKey);
            commitRename();
        } else if (kevt.key === 'Escape') {
            kevt.preventDefault();
            label.removeEventListener('keydown', onKey);
            cancelRename();
        }
    };
    label.addEventListener('keydown', onKey);
    label.addEventListener(
        'blur',
        () => {
            label.removeEventListener('keydown', onKey);
            commitRename();
        },
        { once: true }
    );
}

function tryLcdInlineRenameFromLayoutSelection() {
    const lcd = document.getElementById('tstat-lcd-container');
    const sel = window._layoutSelectedNodeId;
    if (!lcd || !sel) return false;
    let el = lcd.querySelector(`[data-tree-node-id="${sel}"]`);
    const idx = parseWidgetIndexFromLayoutTreeNodeId(sel);
    if (!el && idx >= 0) el = lcd.querySelector(`[data-tree-node-id="w-${idx}"]`);
    let walk = el;
    while (walk && walk !== lcd) {
        if (typeof walk._startInlineEdit === 'function') {
            walk._startInlineEdit();
            return true;
        }
        walk = walk.parentElement;
    }
    return false;
}

function explorerRenameHotkeyFocusBlocksRename() {
    const ae = document.activeElement;
    if (!ae) return false;
    if (ae.closest?.('#layout-props-panel') && (ae.closest('input, textarea, select') || ae.isContentEditable)) {
        return true;
    }
    if (ae.closest?.('#layout-widgets-panel') && ae.closest?.('input, textarea, select')) return true;
    if (ae.closest?.('#layout-tree-search')) return true;
    if (ae.matches?.('input, textarea, select')) return true;
    if (ae.isContentEditable) return true;
    return false;
}

/**
 * F2 / Explorer-style rename: tree row for widget (treeName) when that row exists, else LCD inline edit if wired.
 */
function tryBeginExplorerTreeOrLcdRename() {
    if (!window._isVisualEditMode || !document.body.classList.contains('visual-edit-shell')) return false;
    if (explorerRenameHotkeyFocusBlocksRename()) return false;
    const idx = parseWidgetIndexFromLayoutTreeNodeId(window._layoutSelectedNodeId);
    const jp = window._currentJsonPath;
    const widgets = window._currentScreenData?.widgets;
    if (idx >= 0 && Array.isArray(widgets) && widgets[idx]) {
        const row = document.querySelector(`#layout-tree-content [data-layout-node-id="w-${idx}"]`);
        const label = row?.querySelector?.('.layout-tree-node__label');
        if (label && !label.isContentEditable) {
            setupWidgetTreeLabelRename(label, widgets[idx], label.textContent, jp, renderScreen);
            return true;
        }
    }
    return tryLcdInlineRenameFromLayoutSelection();
}

function bindExplorerRenameHotkeysOnce() {
    if (window._explorerRenameHotkeysBound) return;
    window._explorerRenameHotkeysBound = true;
    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key !== 'F2') return;
            if (!window._isVisualEditMode || !document.body.classList.contains('visual-edit-shell')) return;
            if (explorerRenameHotkeyFocusBlocksRename()) return;
            if (tryBeginExplorerTreeOrLcdRename()) {
                e.preventDefault();
                e.stopPropagation();
            }
        },
        true
    );
}

/** Logical Y inside LCD (0 = top) from screen coordinates; correct when the bezel is CSS-scaled. */
function lcdClientYToLocalY(clientY, lcdElement) {
    if (!lcdElement) return 0;
    const rect = lcdElement.getBoundingClientRect();
    const logicalH = lcdElement.clientHeight || Math.max(1, rect.height);
    const dispH = Math.max(1, rect.height);
    return ((clientY - rect.top) / dispH) * logicalH;
}

/** Match label-drag math: X/Y in LCD logical pixels (uses bezel zoom). */
function lcdClientToLocalXY(clientX, clientY, lcdElement) {
    if (!lcdElement) return { x: 0, y: 0 };
    const rect = lcdElement.getBoundingClientRect();
    const zoom = Number(window._tstatZoom || 1) || 1;
    return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom
    };
}

function snapLcdCoordQuarter(valuePx, screenData) {
    const cw = canvasLogicalWidthPx(screenData);
    const cols = Number(screenData?.layout?.lcdTextColumns || 16);
    const step = Math.max(2, cw / Math.max(1, cols) / 4);
    return Math.round(Number(valuePx) / step) * step;
}

function isSvgLibraryIconLabel(widget) {
    if (!widget || widget.type !== 'label') return false;
    if (widget.id === 'main_icons_group' || widget.id === 'main_ticker_line') return false;
    if (widget.libraryIconName || widget.libraryIconId) return true;
    const t = typeof widget.text === 'string' ? widget.text.trim() : '';
    return /^<svg[\s>]/i.test(t);
}

/** Drag preset icons from the widget panel onto the live LCD (layout edit only). */
function bindLcdPaletteIconDropOnce(lcd) {
    if (!lcd || lcd._tstatPaletteIconDropBound) return;
    lcd._tstatPaletteIconDropBound = true;

    const clearHint = () => lcd.classList.remove('lcd--palette-drop-hint');

    const onDragOver = (evt) => {
        if (!window._isVisualEditMode || !window._layoutPaletteDrag) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        lcd.classList.add('lcd--palette-drop-hint');
    };

    const onDrop = (evt) => {
        if (!window._isVisualEditMode || !window._layoutPaletteDrag) return;
        evt.preventDefault();
        evt.stopPropagation();
        clearHint();
        const pal = window._layoutPaletteDrag;
        window._layoutPaletteDrag = null;
        const data = window._currentScreenData;
        const widgets = data?.widgets;
        if (!Array.isArray(widgets) || !pal?.svg) return;

        const path = window._currentJsonPath || DEFAULT_STARTUP_JSON_PATH;
        const { x: lx, y: ly } = lcdClientToLocalXY(evt.clientX, evt.clientY, lcd);
        const cw = canvasLogicalWidthPx(data);
        const ch = canvasLogicalHeightPx(data);
        const defaultW = Math.max(32, snapLcdCoordQuarter(40, data));
        let x = snapLcdCoordQuarter(lx - defaultW / 2, data);
        let y = snapLcdCoordQuarter(ly - defaultW / 2, data);
        x = Math.max(0, Math.min(Math.max(0, cw - defaultW), x));
        y = Math.max(0, Math.min(Math.max(0, ch - defaultW), y));

        const id = `palette_${Date.now()}`;
        widgets.push({
            type: 'label',
            id,
            text: pal.svg,
            libraryIconId: pal.id,
            libraryIconName: pal.name || pal.id || 'Icon',
            x,
            y,
            width: defaultW,
            align: 'left',
            color: '#ffffff'
        });
        normalizeWidgetTreeOrder(widgets);
        const newIdx = widgets.findIndex((w) => w && w.id === id);
        window._layoutSelectedNodeId = newIdx >= 0 ? `w-${newIdx}` : `w-${widgets.length - 1}`;
        renderScreen(path);
    };

    lcd.addEventListener('dragover', onDragOver, true);
    lcd.addEventListener('drop', onDrop, true);
    document.addEventListener('dragend', clearHint, true);
}

/**
 * Snap a row-slot widget to the grid row under local Y: swap lcdRow with another row at that slot, or move to an empty slot.
 * Always stores numeric lcdRow to avoid duplicate-slot bugs from string/number mismatch.
 */
function ensureFloatingPanelsDragBound() {
    if (window._floatingPanelsDragBound) return;
    window._floatingPanelsDragBound = true;
    const widgets = document.getElementById('layout-widgets-panel');
    const tree = document.getElementById('layout-tree-panel');
    const props = document.getElementById('layout-props-panel');
    const widgetsHead = widgets?.querySelector('.layout-widgets-panel__header');
    const treeHead = tree?.querySelector('.layout-tree-panel__tabs');
    const propsHead = props?.querySelector('.layout-props-panel__header');
    if (widgets && widgetsHead) attachFloatingPanelDrag(widgets, widgetsHead, { minTop: 46 });
    if (tree && treeHead) attachFloatingPanelDrag(tree, treeHead, { minTop: 46 });
    if (props && propsHead) attachFloatingPanelDrag(props, propsHead, { minTop: 46 });
}

function syncSlStudioWorkbenchChrome(jsonPath, data) {
    const fileEl = document.getElementById('sls-file-readout');
    const screenEl = document.getElementById('sls-screen-readout');
    const zoomEl = document.getElementById('sls-zoom-readout');
    if (fileEl && jsonPath) {
        const base = jsonPath.split('/').pop() || jsonPath;
        fileEl.textContent = base;
        fileEl.title = jsonPath;
    }
    if (screenEl && data) {
        const p = data.page || '';
        screenEl.textContent = p ? String(p).replace(/_/g, ' ') : 'Screen';
    }
    if (zoomEl && typeof window._tstatZoom === 'number') {
        zoomEl.textContent = `${Math.round(window._tstatZoom * 100)}%`;
    }
}

function applyRowSlotReorderAtLocalY(draggedWidget, localY, widgets, menuRowPixelHeight, canvasLogicalHeight) {
    if (!isRowSlotWidget(draggedWidget) || !Array.isArray(widgets)) return false;
    const h = Math.max(24, menuRowPixelHeight);
    const maxRow = Math.max(1, Math.floor(Math.max(h, Number(canvasLogicalHeight) || DEFAULT_LCD_H) / h));
    const targetRow = Math.max(1, Math.min(maxRow, Math.floor(localY / h) + 1));

    const blocker = widgets.find(
        (w) => normalizeLcdRowSlot(w.lcdRow) === targetRow && !isRowSlotWidget(w) && w.type !== 'button'
    );
    if (blocker) return false;

    const existingRow = widgets.find(
        (w) => w !== draggedWidget && isRowSlotWidget(w) && normalizeLcdRowSlot(w.lcdRow) === targetRow
    );

    const cur = normalizeLcdRowSlot(draggedWidget.lcdRow);
    if (existingRow) {
        const b = normalizeLcdRowSlot(existingRow.lcdRow);
        draggedWidget.lcdRow = b;
        existingRow.lcdRow = cur;
        return true;
    }
    if (cur !== targetRow) {
        draggedWidget.lcdRow = targetRow;
        return true;
    }
    return false;
}

/** Fixed shell DOM in `Tstat10.html`; tree ids match `data-tree-node-id` (not screen JSON widgets). */
const SHELL_REFERENCE_PHOTO_TREE_ID = 'shell-ref-photo';
const SHELL_HARDWARE_GROUP_TREE_ID = 'shell-hardware-buttons';
const TSTAT_BODY_FOLDER_ID = 'tstat-body';
const SHELL_HARDWARE_BUTTON_ROWS = [
    { treeId: 'shell-hw-left', role: 'left', label: '◀ Left', mapsTo: 'ArrowLeft' },
    { treeId: 'shell-hw-down', role: 'down', label: '▼ Down', mapsTo: 'ArrowDown' },
    { treeId: 'shell-hw-up', role: 'up', label: '▲ Up', mapsTo: 'ArrowUp' },
    { treeId: 'shell-hw-right', role: 'right', label: '▶ Right', mapsTo: 'ArrowRight' }
];

/** Device chrome only — shown once under **Tstatbody** in the hierarchy (not duplicated per screen JSON). */
function buildTstatShellTreeNodes() {
    const nodes = [];
    nodes.push({
        id: TSTAT_BODY_FOLDER_ID,
        text: 'Tstatbody',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 0,
        childKind: 'tstat_body_folder'
    });
    nodes.push({
        id: 'shell-device-bezel',
        text: 'Device bezel',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="5" width="7" height="6" rx="0.8" fill="currentColor" opacity=".2"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_bezel'
    });
    nodes.push({
        id: 'lcd-outline',
        text: 'LCD outline (viewport)',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'lcd_outline'
    });
    nodes.push({
        id: 'shell-compass-logo',
        text: 'Compass / logo artwork',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 3v2M8 11v2M3 8h2M11 8h2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_compass_logo'
    });
    nodes.push({
        id: SHELL_HARDWARE_GROUP_TREE_ID,
        text: 'Hardware buttons (simulated)',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="6" width="3.2" height="5" rx="0.5" fill="currentColor" opacity=".45"/><rect x="6.4" y="6" width="3.2" height="5" rx="0.5" fill="currentColor" opacity=".45"/><rect x="11.3" y="6" width="3.2" height="5" rx="0.5" fill="currentColor" opacity=".45"/><path d="M8 2.5v2.5M8 11v2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_hw_group'
    });
    SHELL_HARDWARE_BUTTON_ROWS.forEach((row) => {
        nodes.push({
            id: row.treeId,
            text: `Key :: ${row.label} → ${row.mapsTo}`,
            icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 6v4M6 8h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
            status: 'ok',
            widget: null,
            indent: 2,
            childKind: 'shell_hw_button',
            shellHwRole: row.role
        });
    });
    nodes.push({
        id: SHELL_REFERENCE_PHOTO_TREE_ID,
        text: 'Thermostat reference image',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" opacity=".35"/><path d="M9 9l4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_ref_photo'
    });
    nodes.push({
        id: 'shell-lock-control',
        text: 'Layout lock (bezel)',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="7" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 7V5a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_lock_control'
    });
    return nodes;
}

/** Screen JSON widgets only (LCD content). Shell chrome lives in `buildTstatShellTreeNodes`. */
function buildPageNodes(data) {
    const iconForWidget = (w) => {
        if (w.type === 'button') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.4"/></svg>';
        }
        if (w.type === 'menu_row') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        }
        if (w.type === 'box') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
        }
        if (w.type === 'header') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v10M13 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        }
        if (w.type === 'label' && typeof w.text === 'string' && w.text.includes('<svg')) {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l4.5 3v6L8 14l-4.5-3V5L8 2z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>';
        }
        if (w.type === 'label') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M8 4v8M5 12h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        }
        if (w.type === 'blank') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>';
        }
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
    };

    const widgets = data.widgets || [];
    const byId = new Map();
    widgets.forEach((w, i) => {
        if (w && w.id) byId.set(w.id, i);
    });
    const nodes = [];

    const nodeTitleFor = (w) => {
        if (w.type === 'label' && (w.libraryIconName || w.libraryIconId)) {
            return `Icon :: ${w.libraryIconName || w.libraryIconId}`;
        }
        if (w.type === 'label' && typeof w.text === 'string' && w.text.includes('<svg')) {
            return `Icon :: ${w.id || 'SVG Icon'}`;
        }
        if (w.type === 'menu_row') {
            return `Row :: ${getWidgetTreeName(w)}`;
        }
        return `${w.type || 'item'} :: ${getWidgetTreeName(w)}`;
    };

    const pushSyntheticForWidget = (w, i, indent) => {
        if (w.id === 'main_icons_group') {
            const parts = [
                { key: 'day_night', label: 'Icon :: Day/Night' },
                { key: 'occupied', label: 'Icon :: Occupied' },
                { key: 'heat_cool', label: 'Icon :: Heat/Cool' },
                { key: 'fan', label: 'Icon :: Fan' }
            ];
            parts.forEach((p, pIdx) => {
                const iconBinding = w.t3IconBindings?.[p.key] || '';
                nodes.push({
                    id: `w-${i}-icon-${p.key}`,
                    text: iconBinding ? `${p.label} [${iconBinding}]` : p.label,
                    icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
                    status: 'ok',
                    widget: w,
                    indent,
                    childKind: 'group_icon',
                    groupPartIndex: pIdx
                });
            });
        }
        if (w.type === 'menu_row') {
            nodes.push({
                id: `w-${i}-label`,
                text: `label text :: ${w.label || ''}`,
                icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M8 4v8M5 12h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
                status: 'ok',
                widget: w,
                indent,
                childKind: 'label'
            });
            nodes.push({
                id: `w-${i}-value`,
                text: `edit box :: ${(w.t3ValueBinding ? `[${w.t3ValueBinding}] ` : '')}${(w.value ?? '').toString()}`,
                icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.2"/></svg>',
                status: 'ok',
                widget: w,
                indent,
                childKind: 'value'
            });
        }
    };

    const MAX_TREE_DEPTH = 96;
    /** True only when this widget can be a parent in the tree (parentId links use string ids). */
    const canBeParent = (w) => {
        const id = w && w.id;
        return typeof id === 'string' && id.length > 0;
    };
    const emitSubtree = (w, i, depth, visited) => {
        if (!w) return;
        if (depth > MAX_TREE_DEPTH) {
            console.warn('[buildPageNodes] Max widget tree depth exceeded; check parentId chain at index', i);
            return;
        }
        if (visited.has(i)) {
            console.warn('[buildPageNodes] parentId cycle detected; skipping subtree at index', i);
            return;
        }
        visited.add(i);
        try {
            const nodeTitle = nodeTitleFor(w);
            nodes.push({
                id: `w-${i}`,
                text: nodeTitle,
                icon: iconForWidget(w),
                status: (w.id || w.label || w.text) ? 'ok' : 'warn',
                widget: w,
                widgetIndex: i,
                indent: depth,
                childKind: 'widget'
            });
            pushSyntheticForWidget(w, i, depth + 1);
            const parentId = canBeParent(w) ? w.id : null;
            const children = widgets
                .map((child, idx) => ({ child, idx }))
                .filter(({ child }) => child && parentId != null && child.parentId === parentId)
                .sort((a, b) => a.idx - b.idx);
            children.forEach(({ idx }) => emitSubtree(widgets[idx], idx, depth + 1, visited));
        } finally {
            visited.delete(i);
        }
    };

    const rootIndices = [];
    widgets.forEach((w, i) => {
        if (!w) return;
        if (!w.parentId || !byId.has(w.parentId)) rootIndices.push(i);
    });
    rootIndices.sort((a, b) => a - b);
    rootIndices.forEach((i) => emitSubtree(widgets[i], i, 0, new Set()));
    return nodes;
}

function findLayoutTreeNodeById(id, data) {
    if (!id) return null;
    const shellHit = buildTstatShellTreeNodes().find((n) => n.id === id);
    if (shellHit) return shellHit;
    return buildPageNodes(data).find((n) => n.id === id);
}

function openPropertyEditorMenu(e, node, onApply) {
    const widget = node.widget;
    const childKind = node.childKind || 'widget';
    removeExistingPropertyEditor();
    const menu = document.createElement('div');
    menu.id = 'layout-property-editor';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10020';
    menu.style.background = '#fff';
    menu.style.border = '1px solid #cbd5e1';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 6px 24px rgba(0,0,0,0.18)';
    menu.style.padding = '8px';
    menu.style.minWidth = '260px';
    menu.style.fontFamily = "ui-monospace, 'Cascadia Code', Consolas, monospace";
    menu.style.fontSize = '12px';

    // SquareLine-like action menu for grouped main icons.
    if (widget?.id === 'main_icons_group') {
        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.margin = '2px 0 8px';
        title.textContent = 'Main Icons Group';
        menu.appendChild(title);

        const info = document.createElement('div');
        info.style.marginBottom = '10px';
        info.style.color = '#475569';
        info.textContent = 'Use actions for this group. Geometry is edited in the right inspector.';
        menu.appendChild(info);

        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.gap = '8px';
        actionRow.style.justifyContent = 'flex-end';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => menu.remove();
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.style.background = '#7f1d1d';
        deleteBtn.style.color = '#fff';
        deleteBtn.onclick = () => {
            if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(node.id);
            if (typeof window._deleteSelectedLayoutNode === 'function') window._deleteSelectedLayoutNode();
            menu.remove();
        };

        const ungroupBtn = document.createElement('button');
        ungroupBtn.textContent = 'Ungroup';
        ungroupBtn.style.background = '#0f766e';
        ungroupBtn.style.color = '#fff';
        ungroupBtn.onclick = () => {
            if (typeof ungroupMainIcons === 'function' && ungroupMainIcons()) onApply();
            menu.remove();
        };

        actionRow.appendChild(closeBtn);
        actionRow.appendChild(deleteBtn);
        actionRow.appendChild(ungroupBtn);
        menu.appendChild(actionRow);
        document.body.appendChild(menu);
        setTimeout(() => {
            const closeOnOutside = (evt) => {
                if (!menu.contains(evt.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', closeOnOutside);
                }
            };
            document.addEventListener('mousedown', closeOnOutside);
        }, 0);
        return;
    }

    const baseFields = [
        { key: 'x', label: 'x', type: 'number' },
        { key: 'y', label: 'y', type: 'number' },
        { key: 'fontSize', label: 'fontSize', type: 'number' },
        { key: 'color', label: 'color', type: 'text' }
    ];
    const labelFields = [
        { key: 'label', label: 'label', type: 'text' },
        { key: 'labelWidth', label: 'labelWidth', type: 'number' },
        { key: 'labelAlign', label: 'labelAlign', type: 'text' },
        { key: 'labelOffsetX', label: 'labelOffsetX', type: 'number' },
        { key: 'labelOffsetY', label: 'labelOffsetY', type: 'number' }
    ];
    const valueFields = [
        { key: 'value', label: 'value', type: 'text' },
        { key: 'valueWidth', label: 'valueWidth', type: 'number' },
        { key: 'valueAlign', label: 'valueAlign', type: 'text' },
        { key: 'valueOffsetX', label: 'valueOffsetX', type: 'number' },
        { key: 'valueOffsetY', label: 'valueOffsetY', type: 'number' }
    ];
    const highlightFields = [
        { key: 'highlightInsetX', label: 'highlightInsetX', type: 'number' },
        { key: 'highlightInsetY', label: 'highlightInsetY', type: 'number' },
        { key: 'highlightWidthAdjust', label: 'highlightWidthAdjust', type: 'number' },
        { key: 'highlightHeightAdjust', label: 'highlightHeightAdjust', type: 'number' },
        { key: 'highlightRadius', label: 'highlightRadius', type: 'number' }
    ];
    let fields = [...baseFields, ...labelFields, ...valueFields, ...highlightFields];
    if (childKind === 'label') fields = [...labelFields];
    if (childKind === 'value') fields = [...valueFields];

    fields.forEach((f) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '88px 1fr';
        row.style.gap = '6px';
        row.style.marginBottom = '6px';
        const lab = document.createElement('label');
        lab.textContent = f.label;
        const input = document.createElement('input');
        input.type = f.type;
        input.dataset.key = f.key;
        input.value = widget[f.key] ?? '';
        input.style.width = '100%';
        row.appendChild(lab);
        row.appendChild(input);
        menu.appendChild(row);
    });

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.justifyContent = 'flex-end';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => {
        menu.querySelectorAll('input[data-key]').forEach((inp) => {
            const k = inp.dataset.key;
            const val = inp.value;
            if (val === '') {
                delete widget[k];
                return;
            }
            widget[k] = inp.type === 'number' ? Number(val) : val;
        });
        onApply();
        menu.remove();
    };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => menu.remove();
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.background = '#7f1d1d';
    deleteBtn.style.color = '#fff';
    deleteBtn.onclick = () => {
        if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(node.id);
        if (typeof window._deleteSelectedLayoutNode === 'function') window._deleteSelectedLayoutNode();
        menu.remove();
    };
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.onclick = () => {
        if (typeof window._undoLayoutChange === 'function') window._undoLayoutChange();
        menu.remove();
    };
    btnRow.appendChild(closeBtn);
    btnRow.appendChild(undoBtn);
    btnRow.appendChild(deleteBtn);
    btnRow.appendChild(applyBtn);
    menu.appendChild(btnRow);
    document.body.appendChild(menu);

    setTimeout(() => {
        const closeOnOutside = (evt) => {
            if (!menu.contains(evt.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        document.addEventListener('mousedown', closeOnOutside);
    }, 0);
}

function renderLayoutTreePanel(data, jsonPath, rerender) {
    const panel = document.getElementById('layout-tree-panel');
    const widgetsPanel = document.getElementById('layout-widgets-panel');
    const content = document.getElementById('layout-tree-content');
    const searchInput = document.getElementById('layout-tree-search');
    if (!panel || !content) return;
    const isEdit = !!window._isVisualEditMode;
    if (widgetsPanel) widgetsPanel.classList.toggle('debug-ui-hidden', !isEdit);
    panel.classList.toggle('debug-ui-hidden', !isEdit);
    if (!isEdit) return;
    content.innerHTML = '';

    const screenNodes = [
        { key: 'main', name: 'Home' },
        { key: 'setup', name: 'Setup Menu' },
        { key: 'ethernet', name: 'WiFi Setup' },
        { key: 'provisioning', name: 'Provisioning' },
        { key: 'settings', name: 'RS485 Settings' },
        { key: 'clock', name: 'Clock Setup' },
        { key: 'oat', name: 'Outside Air Temp' },
        { key: 'tbd', name: 'To Be Done' }
    ];
    if (!window._layoutTreeExpandedPages) window._layoutTreeExpandedPages = { [jsonPath]: true };
    if (typeof window._layoutTreeExpandedTstatbody !== 'boolean') window._layoutTreeExpandedTstatbody = true;
    const pageNodes = buildPageNodes(data);
    const query = (searchInput?.value || '').trim().toLowerCase();
    const filteredNodes = !query ? pageNodes : pageNodes.filter((n) => n.text.toLowerCase().includes(query));
    const allShellNodes = buildTstatShellTreeNodes();
    const shellFolderRow = allShellNodes[0];
    const shellChildNodes = allShellNodes.slice(1);
    const shellFiltered =
        !query ?
            shellChildNodes
        :   shellChildNodes.filter(
                (n) => n.text.toLowerCase().includes(query) || 'tstatbody'.includes(query)
            );
    const shellExpanded =
        query ? shellFiltered.length > 0 || 'tstatbody'.includes(query) : !!window._layoutTreeExpandedTstatbody;

    const mountRow = (n) => {
        const div = document.createElement('div');
        const typeMods = getLayoutTreeNodeLayoutClasses(n);
        div.className = `layout-tree-node${n.indent ? ' layout-tree-node--child' : ''}${typeMods ? ` ${typeMods}` : ''}`.trim();
        div.dataset.layoutNodeId = n.id;
        div.style.paddingLeft = `${8 + (n.indent || 0) * 16}px`;
        const chevronSp = document.createElement('span');
        chevronSp.className = 'layout-tree-node__chevron';
        chevronSp.setAttribute('aria-hidden', 'true');
        const icon = document.createElement('span');
        icon.className = 'layout-tree-node__icon';
        icon.innerHTML = n.icon;
        const label = document.createElement('span');
        label.className = 'layout-tree-node__label';
        label.textContent = n.text;
        if (n.childKind === 'widget') {
            label.title = 'Double-click to rename in tree';
            label.addEventListener('dblclick', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                cancelDebouncedSelectLayoutRender();
                const widgetRef = n.widget;
                if (!widgetRef) return;
                label.contentEditable = 'true';
                label.focus();
                document.getSelection()?.selectAllChildren(label);
                const commitRename = () => {
                    label.contentEditable = 'false';
                    const raw = label.innerText.trim();
                    if (!raw) {
                        delete widgetRef.treeName;
                    } else {
                        widgetRef.treeName = raw
                            .replace(/^row\s*::\s*/i, '')
                            .replace(/^label\s*::\s*/i, '')
                            .replace(/^icon\s*::\s*/i, '')
                            .trim();
                    }
                    rerender(jsonPath);
                };
                const cancelRename = () => {
                    label.contentEditable = 'false';
                    label.textContent = n.text;
                };
                const onKey = (kevt) => {
                    if (kevt.key === 'Enter') {
                        kevt.preventDefault();
                        label.removeEventListener('keydown', onKey);
                        commitRename();
                    } else if (kevt.key === 'Escape') {
                        kevt.preventDefault();
                        label.removeEventListener('keydown', onKey);
                        cancelRename();
                    }
                };
                label.addEventListener('keydown', onKey);
                label.addEventListener('blur', () => {
                    label.removeEventListener('keydown', onKey);
                    commitRename();
                }, { once: true });
            });
        }
        const status = document.createElement('span');
        status.className = `layout-tree-node__status ${n.status === 'warn' ? 'is-warning' : 'is-event'}`;
        div.appendChild(chevronSp);
        div.appendChild(icon);
        div.appendChild(label);
        div.appendChild(status);
        const treeDropIdx = parseWidgetIndexFromLayoutTreeNodeId(n.id);
        const isDraggableWidgetRow = n.childKind === 'widget' && treeDropIdx >= 0;
        if (isDraggableWidgetRow) {
            div.draggable = true;
            div.addEventListener('dragstart', (evt) => {
                window._layoutTreeDragNodeId = n.id;
                try {
                    evt.dataTransfer.setData('text/plain', n.id);
                    evt.dataTransfer.setData('application/x-tstat-tree-node', n.id);
                } catch {
                    /* ignore */
                }
                evt.dataTransfer.effectAllowed = 'move';
                setTimeout(() => {
                    div.style.opacity = '0.45';
                }, 0);
            });
            div.addEventListener('dragend', () => {
                div.style.opacity = '';
                const ended = n.id;
                setTimeout(() => {
                    if (window._layoutTreeDragNodeId === ended) window._layoutTreeDragNodeId = null;
                }, 0);
            });
        }
        if (treeDropIdx >= 0) {
            div.addEventListener('dragover', (evt) => {
                const widgetsOv = window._currentScreenData?.widgets;
                const toIdx = treeDropIdx;
                if (toIdx < 0) return;
                const toW = widgetsOv?.[toIdx];
                const rect = div.getBoundingClientRect();
                const y = evt.clientY - rect.top;
                const inside = y > rect.height * 0.28 && y < rect.height * 0.72;

                if (window._layoutPaletteDrag) {
                    if (!widgetAcceptsChildren(toW) || !inside) return;
                    evt.preventDefault();
                    evt.dataTransfer.dropEffect = 'copy';
                    content.querySelectorAll('.layout-tree-node--drop-line-top, .layout-tree-node--drop-line-bottom, .layout-tree-node--drop-inside')
                        .forEach((el) => el.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside'));
                    div.classList.add('layout-tree-node--drop-inside');
                    return;
                }

                const draggedId =
                    window._layoutTreeDragNodeId ||
                    (() => {
                        try {
                            return evt.dataTransfer.getData('application/x-tstat-tree-node') || evt.dataTransfer.getData('text/plain');
                        } catch {
                            return '';
                        }
                    })();
                if (!draggedId) return;
                const fromIdx = parseWidgetIndexFromLayoutTreeNodeId(draggedId);
                if (fromIdx < 0 || toIdx < 0) return;
                if (fromIdx === toIdx) return;
                const fromW = widgetsOv?.[fromIdx];
                if (inside && widgetAcceptsChildren(toW) && !isWidgetDescendantOf(widgetsOv, toIdx, fromIdx)) {
                    evt.preventDefault();
                    evt.dataTransfer.dropEffect = 'copy';
                    content.querySelectorAll('.layout-tree-node--drop-line-top, .layout-tree-node--drop-line-bottom, .layout-tree-node--drop-inside')
                        .forEach((el) => el.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside'));
                    div.classList.add('layout-tree-node--drop-inside');
                    return;
                }
                if (!layoutDropTargetsSameHierarchy(fromW, toW)) return;
                evt.preventDefault();
                evt.dataTransfer.dropEffect = 'move';
                const side = y < rect.height / 2 ? 'top' : 'bottom';
                content.querySelectorAll('.layout-tree-node--drop-line-top, .layout-tree-node--drop-line-bottom, .layout-tree-node--drop-inside')
                    .forEach((el) => el.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside'));
                div.classList.add(side === 'top' ? 'layout-tree-node--drop-line-top' : 'layout-tree-node--drop-line-bottom');
            });
            div.addEventListener('dragleave', () => {
                div.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside');
            });
            div.addEventListener('drop', (evt) => {
                evt.preventDefault();
                div.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside');
                const widgets = window._currentScreenData?.widgets;
                if (!Array.isArray(widgets)) return;
                const toIdx = treeDropIdx;
                if (toIdx < 0) return;
                const toWidget = widgets[toIdx];
                const rect = div.getBoundingClientRect();
                const y = evt.clientY - rect.top;
                const inside = y > rect.height * 0.28 && y < rect.height * 0.72;

                if (window._layoutPaletteDrag) {
                    if (!inside || !widgetAcceptsChildren(toWidget)) return;
                    const pal = window._layoutPaletteDrag;
                    const id = `palette_${Date.now()}`;
                    widgets.push({
                        type: 'label',
                        id,
                        text: pal.svg || '',
                        libraryIconId: pal.id,
                        libraryIconName: pal.name || pal.id || 'Icon',
                        x: 32,
                        y: 48,
                        width: Math.max(32, snapLcdCoordQuarter(40, window._currentScreenData)),
                        align: 'left',
                        parentId: toWidget.id,
                        color: '#ffffff'
                    });
                    window._layoutPaletteDrag = null;
                    normalizeWidgetTreeOrder(widgets);
                    const newIdx = widgets.findIndex((w) => w && w.id === id);
                    window._layoutSelectedNodeId = newIdx >= 0 ? `w-${newIdx}` : `w-${widgets.length - 1}`;
                    window._layoutTreeDragNodeId = null;
                    rerender(jsonPath);
                    return;
                }

                let draggedId = window._layoutTreeDragNodeId;
                if (!draggedId) {
                    try {
                        draggedId =
                            evt.dataTransfer.getData('application/x-tstat-tree-node') || evt.dataTransfer.getData('text/plain');
                    } catch {
                        draggedId = '';
                    }
                }
                if (!draggedId) return;
                const fromIdx = parseWidgetIndexFromLayoutTreeNodeId(draggedId);
                if (fromIdx < 0 || toIdx < 0 || fromIdx >= widgets.length || toIdx >= widgets.length) return;
                if (fromIdx === toIdx) return;
                const fromWidget = widgets[fromIdx];
                if (inside && widgetAcceptsChildren(toWidget) && !isWidgetDescendantOf(widgets, toIdx, fromIdx)) {
                    fromWidget.parentId = toWidget.id;
                    normalizeWidgetTreeOrder(widgets);
                    const ni = widgets.indexOf(fromWidget);
                    window._layoutSelectedNodeId = ni >= 0 ? `w-${ni}` : n.id;
                    window._layoutTreeDragNodeId = null;
                    rerender(jsonPath);
                    return;
                }

                if (!layoutDropTargetsSameHierarchy(fromWidget, toWidget)) return;
                const fromIsRow = fromWidget?.type === 'menu_row' || fromWidget?.type === 'blank';
                const toIsRow = toWidget?.type === 'menu_row' || toWidget?.type === 'blank';
                const fromIsLabelLike = fromWidget?.type === 'label' || fromWidget?.type === 'header';
                const toIsLabelLike = toWidget?.type === 'label' || toWidget?.type === 'header';
                if (fromIsRow && toIsRow) {
                    const aRow = normalizeLcdRowSlot(fromWidget.lcdRow);
                    const bRow = normalizeLcdRowSlot(toWidget.lcdRow);
                    fromWidget.lcdRow = bRow;
                    toWidget.lcdRow = aRow;
                } else if (fromIsLabelLike && toIsLabelLike) {
                    fromWidget.parentId = toWidget.parentId;
                    const ax = Number(fromWidget.x || 0);
                    const ay = Number(fromWidget.y || 0);
                    const bx = Number(toWidget.x || 0);
                    const by = Number(toWidget.y || 0);
                    fromWidget.x = bx;
                    fromWidget.y = by;
                    toWidget.x = ax;
                    toWidget.y = ay;
                } else {
                    fromWidget.parentId = toWidget.parentId;
                    const tmp = widgets[fromIdx];
                    widgets[fromIdx] = widgets[toIdx];
                    widgets[toIdx] = tmp;
                    normalizeWidgetTreeOrder(widgets);
                }
                window._layoutSelectedNodeId = `w-${toIdx}`;
                window._layoutTreeDragNodeId = null;
                rerender(jsonPath);
            });
        }
        div.addEventListener('click', () => {
            if (typeof window._selectLayoutNode === 'function') {
                window._selectLayoutNode(n.id);
            } else {
                window._layoutSelectedNodeId = n.id;
                renderLayoutTreePanel(data, jsonPath, rerender);
                renderLayoutPropertiesPanel(data, jsonPath, rerender);
            }
        });
        div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(n.id);
            openTreeContextMenu(e, n, jsonPath, rerender);
        });
        if (window._layoutSelectedNodeId === n.id) {
            div.classList.add('layout-tree-node--selected');
        }
        return div;
    };

    const tstatFolder = document.createElement('div');
    tstatFolder.className = 'layout-tree-folder';
    const tstatRow = document.createElement('div');
    tstatRow.className = 'layout-tree-node layout-tree-node--screen layout-tree-node--tstat-body-folder';
    const tChev = document.createElement('span');
    tChev.className = 'layout-tree-node__chevron';
    tChev.setAttribute('aria-hidden', 'true');
    tChev.textContent = shellExpanded ? '▼' : '▶';
    const tIcon = document.createElement('span');
    tIcon.className = 'layout-tree-node__icon layout-tree-node__icon--screen';
    tIcon.innerHTML = shellFolderRow.icon;
    const tLabel = document.createElement('span');
    tLabel.className = 'layout-tree-node__label';
    tLabel.textContent = shellFolderRow.text;
    const tStat = document.createElement('span');
    tStat.className = 'layout-tree-node__status';
    tStat.textContent = 'shell';
    tstatRow.appendChild(tChev);
    tstatRow.appendChild(tIcon);
    tstatRow.appendChild(tLabel);
    tstatRow.appendChild(tStat);
    tstatRow.addEventListener('click', () => {
        if (!query) window._layoutTreeExpandedTstatbody = !window._layoutTreeExpandedTstatbody;
        renderLayoutTreePanel(data, jsonPath, rerender);
    });
    tstatFolder.appendChild(tstatRow);
    const tstatChildren = document.createElement('div');
    tstatChildren.className = 'layout-tree-folder__children';
    tstatChildren.style.display = shellExpanded ? '' : 'none';
    if (!query || shellFiltered.length) {
        (query ? shellFiltered : shellChildNodes).forEach((n) => tstatChildren.appendChild(mountRow(n)));
    } else {
        const sh = document.createElement('div');
        sh.className = 'layout-tree-node layout-tree-node--child';
        sh.style.paddingLeft = '24px';
        sh.innerHTML =
            '<span class="layout-tree-node__chevron" aria-hidden="true"></span><span class="layout-tree-node__icon">…</span><span class="layout-tree-node__label">No shell matches</span><span class="layout-tree-node__status"></span>';
        tstatChildren.appendChild(sh);
    }
    tstatFolder.appendChild(tstatChildren);
    content.appendChild(tstatFolder);

    screenNodes.forEach((s) => {
        const folder = document.createElement('div');
        folder.className = 'layout-tree-folder';
        const row = document.createElement('div');
        const targetPath = ROUTE_TO_JSON_PATH[s.key];
        const isCurrent = targetPath === jsonPath;
        const expanded = !!window._layoutTreeExpandedPages[targetPath];
        row.className = `layout-tree-node layout-tree-node--screen${isCurrent ? ' layout-tree-node--screen-active' : ''}`;
        const chev = document.createElement('span');
        chev.className = 'layout-tree-node__chevron';
        chev.setAttribute('aria-hidden', 'true');
        chev.textContent = expanded ? '▼' : '▶';
        const screenIcon = document.createElement('span');
        screenIcon.className = 'layout-tree-node__icon layout-tree-node__icon--screen';
        screenIcon.innerHTML =
            '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
        const screenLabel = document.createElement('span');
        screenLabel.className = 'layout-tree-node__label';
        screenLabel.textContent = s.name;
        const screenStatus = document.createElement('span');
        screenStatus.className = `layout-tree-node__status${isCurrent ? ' is-screen-current' : ''}`;
        row.appendChild(chev);
        row.appendChild(screenIcon);
        row.appendChild(screenLabel);
        row.appendChild(screenStatus);
        row.addEventListener('click', () => {
            window._layoutTreeExpandedPages[targetPath] = !expanded;
            if (!isCurrent) window.navigateTo(s.key);
            else renderLayoutTreePanel(data, jsonPath, rerender);
        });
        folder.appendChild(row);

        const children = document.createElement('div');
        children.className = 'layout-tree-folder__children';
        children.style.display = expanded ? '' : 'none';
        if (isCurrent) {
            filteredNodes.forEach((n) => children.appendChild(mountRow(n)));
        } else {
            const hint = document.createElement('div');
            hint.className = 'layout-tree-node layout-tree-node--child';
            hint.innerHTML = '<span class="layout-tree-node__chevron" aria-hidden="true"></span><span class="layout-tree-node__icon">…</span><span class="layout-tree-node__label">Open page to view objects</span><span class="layout-tree-node__status"></span>';
            children.appendChild(hint);
        }
        folder.appendChild(children);
        content.appendChild(folder);
    });
    const selectedTreeEl = content.querySelector('.layout-tree-node--selected');
    if (selectedTreeEl) selectedTreeEl.scrollIntoView({ block: 'nearest' });
    if (searchInput && !searchInput._layoutTreeSearchBound) {
        searchInput.addEventListener('input', () => renderLayoutTreePanel(data, jsonPath, rerender));
        searchInput._layoutTreeSearchBound = true;
    }
    const ensureIconPaletteUi = () => {
        const host = document.getElementById('layout-icon-palette-host');
        if (!host) return;
        const assetsShell = `
                <div class="layout-sl-assets__toolbar">
                    <label class="layout-tree-panel__search layout-sl-assets__search">
                        <span class="layout-tree-panel__search-icon" aria-hidden="true">
                            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10Zm0-1.2A3.8 3.8 0 1 1 7 3.2a3.8 3.8 0 0 1 0 7.6Z" fill="currentColor" opacity=".55"/><path d="m10.9 11.1 3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".55"/></svg>
                        </span>
                        <input id="layout-assets-filter" type="search" placeholder="Filter images…" autocomplete="off" />
                    </label>
                    <div class="layout-sl-assets__toolbar-actions">
                        <button type="button" id="icon-palette-import">Add file…</button>
                    </div>
                </div>
                <p class="layout-sl-assets__hint">Images list (SquareLine-style). Project folder: <code>lcd-lib/icons</code>. Other folder: set <code>TSTAT_LCD_LIB</code> when starting <code>npm start</code>.</p>
                <div id="layout-sl-asset-list" class="layout-sl-asset-list" role="list"></div>
                <input id="icon-palette-file" type="file" accept=".svg,image/svg+xml" style="display:none" />
        `;
        let palette = document.getElementById('layout-icon-palette');
        if (!palette) {
            palette = document.createElement('div');
            palette.id = 'layout-icon-palette';
            palette.className = 'layout-sl-assets';
            palette.innerHTML = assetsShell;
            host.appendChild(palette);
        } else if (palette.parentNode !== host) {
            host.appendChild(palette);
        }
        if (!palette.querySelector('#layout-sl-asset-list')) {
            palette.className = 'layout-sl-assets';
            palette.innerHTML = assetsShell;
        }
        const list = document.getElementById('layout-sl-asset-list');
        const importBtn = document.getElementById('icon-palette-import');
        const fileInput = document.getElementById('icon-palette-file');
        if (!list || !importBtn || !fileInput) return;

        // SquareLine-style preset symbols: use currentColor so tiles (light/dark) and LCD (widget.color) both work.
        const presets = [
            { id: 'wifi', name: 'Wi‑Fi', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.55a11 11 0 0 1 14.08 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M1.42 9a16 16 0 0 1 21.16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/></svg>' },
            { id: 'gauge', name: 'Gauge', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 15a8 8 0 1 1 16 0" stroke="currentColor" stroke-width="1.6"/><path d="M12 12l5-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>' },
            { id: 'fan', name: 'Fan', svg: '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(13,13)"><ellipse cx="0" cy="-4" rx="2.2" ry="6" fill="currentColor"/><ellipse cx="0" cy="-4" rx="2.2" ry="6" fill="currentColor" transform="rotate(120)"/><ellipse cx="0" cy="-4" rx="2.2" ry="6" fill="currentColor" transform="rotate(240)"/></g><circle cx="13" cy="13" r="1.6" fill="currentColor"/></svg>' },
            { id: 'thermo', name: 'Thermo', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5a2 2 0 0 0-2 2v7.2a4 4 0 1 0 4 0V7a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="17" r="1.8" fill="currentColor"/></svg>' },
            { id: 'home', name: 'Home', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 11.5L12 4l9 7.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5.5 10.5V20h13v-9.5" stroke="currentColor" stroke-width="1.6"/></svg>' },
            { id: 'settings', name: 'Settings', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>' },
            { id: 'power', name: 'Power', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
            { id: 'lock', name: 'Lock', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>' },
            { id: 'unlock', name: 'Unlock', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 11V8a5 5 0 0 1 9.9-1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>' },
            { id: 'back', name: 'Back', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'forward', name: 'Next', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'menu', name: 'Menu', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'close', name: 'Close', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'check', name: 'OK', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 13l5 5L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'heat', name: 'Heat', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-2 4-4 5-4 9a4 4 0 0 0 8 0c0-4-2-5-4-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'cool', name: 'Cool', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
            { id: 'humid', name: 'Humid', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-4 6-7 8-7 12a7 7 0 0 0 14 0c0-4-3-6-7-12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'sun', name: 'Sun', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.9 17.6l-1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'moon', name: 'Moon', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 6.5 6.5 0 1 0 21 14.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'cloud', name: 'Cloud', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 18h11a4 4 0 0 0 .2-8 5 5 0 0 0-9.7-1.5A3.5 3.5 0 0 0 7 18z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'phone', name: 'Phone', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M10 18h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'bt', name: 'Bluetooth', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 7l10 5-5 2.5V7zm0 10l10-5-5-2.5V17zM12 3v18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'signal', name: 'Signal', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 20V12M9 20V9M13 20V6M17 20v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'alert', name: 'Alert', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4l9 14H3L12 4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 10v3M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'info', name: 'Info', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'clock', name: 'Clock', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
            { id: 'calendar', name: 'Cal', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'play', name: 'Play', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7L8 5z" fill="currentColor"/></svg>' },
            { id: 'pause', name: 'Pause', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>' },
            { id: 'auto', name: 'Auto', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8a8 8 0 0 1 8-4v4M20 16a8 8 0 0 1-8 4v-4M4 16l2-2M20 8l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'bolt', name: 'Boost', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L4 14h7l-1 8 10-12h-7l0-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>' },
            { id: 'chart', name: 'Graph', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 19h16M6 17l4-6 4 3 5-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'target', name: 'Setpt', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' },
            { id: 'up', name: 'Up', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'down', name: 'Down', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M18 13l-6 6-6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'search', name: 'Search', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.6"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'user', name: 'User', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'eye', name: 'View', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>' },
            { id: 'brightness', name: 'Bright', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' },
            { id: 'battery', name: 'Battery', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M21 10v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' },
            { id: 'link', name: 'Link', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 14a4 4 0 0 1 0-5l2-2a4 4 0 0 1 5.5.2 4 4 0 0 1 0 5.6L16 14M14 10a4 4 0 0 1 0 5l-2 2a4 4 0 0 1-5.5-.2 4 4 0 0 1 0-5.6L8 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'filter', name: 'Filter', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'vent', name: 'Vent', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8h16M4 12h12M4 16h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M18 10l2 2-2 2M18 14l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' }
        ];
        const custom = loadCustomPaletteSvgs().map((item, idx) => ({ id: `custom-${idx}`, name: item.name, svg: item.svg, custom: true }));
        const diskRaw = getLcdLibDiskSync();
        const disk = Array.isArray(diskRaw) ? diskRaw : [];
        const initialDiskSig = disk.map((x) => x.id).join('\n');
        if (!window._selectedPaletteIcon || !window._selectedPaletteIcon.svg) window._selectedPaletteIcon = { id: presets[0].id, name: presets[0].name, svg: presets[0].svg };

        const assetMatches = (item, q) => {
            if (!q) return true;
            const blob = `${item.id} ${item.name || ''} ${item.custom ? 'imported' : ''} ${item.fromLib ? 'library' : 'built-in'}`.toLowerCase();
            return blob.includes(q);
        };

        const drawRow = (item) => {
            const row = document.createElement('div');
            row.className = 'layout-sl-asset-row';
            row.setAttribute('role', 'listitem');
            row.draggable = true;
            const sel = window._selectedPaletteIcon;
            if (sel && (String(sel.id) === String(item.id) || sel.svg === item.svg)) row.classList.add('is-selected');

            const thumb = document.createElement('div');
            thumb.className = 'layout-sl-asset-row__thumb';
            thumb.innerHTML = item.svg;

            const meta = document.createElement('div');
            meta.className = 'layout-sl-asset-row__meta';
            const nameEl = document.createElement('div');
            nameEl.className = 'layout-sl-asset-row__name';
            nameEl.textContent = item.name || item.id;
            const src = document.createElement('div');
            src.className = 'layout-sl-asset-row__src';
            src.textContent = item.custom ? 'Imported' : item.fromLib ? 'Library' : 'Built-in';
            meta.append(nameEl, src);
            row.append(thumb, meta);

            row.title =
                'Click to select for the Icon widget · drag onto LCD or hierarchy · right-click imported row to remove';
            row.addEventListener('dragstart', (e) => {
                window._layoutPaletteDrag = { svg: item.svg, name: item.name || item.id, id: item.id };
                try {
                    e.dataTransfer.setData('text/plain', 'palette-icon');
                    e.dataTransfer.effectAllowed = 'copy';
                } catch {
                    /* ignore */
                }
                row.classList.add('layout-sl-asset-row--dragging');
            });
            row.addEventListener('dragend', () => {
                row.classList.remove('layout-sl-asset-row--dragging');
                window._layoutPaletteDrag = null;
            });
            row.addEventListener('click', () => {
                window._selectedPaletteIcon = { id: item.id, name: item.name || item.id, svg: item.svg };
                renderLayoutTreePanel(data, jsonPath, rerender);
            });
            if (item.custom) {
                row.addEventListener('contextmenu', (evt) => {
                    evt.preventDefault();
                    const now = loadCustomPaletteSvgs();
                    const next = now.filter((s) => s.svg !== item.svg);
                    saveCustomPaletteSvgs(next);
                    if (window._selectedPaletteIcon?.svg === item.svg) {
                        window._selectedPaletteIcon = { id: presets[0].id, name: presets[0].name, svg: presets[0].svg };
                    }
                    renderLayoutTreePanel(data, jsonPath, rerender);
                });
            }
            list.appendChild(row);
        };

        const repaintAssetList = () => {
            list.innerHTML = '';
            const filtEl = document.getElementById('layout-assets-filter');
            const q = (filtEl?.value || '').trim().toLowerCase();
            const presetsF = presets.filter((it) => assetMatches(it, q));
            const diskF = disk.filter((it) => assetMatches(it, q));
            const customF = custom.filter((it) => assetMatches(it, q));
            const appendSection = (title) => {
                const h = document.createElement('div');
                h.className = 'layout-sl-assets-section-title';
                h.textContent = title;
                list.appendChild(h);
            };
            if (presetsF.length) {
                appendSection('Built-in symbols');
                presetsF.forEach(drawRow);
            }
            if (diskF.length) {
                appendSection('Library (lcd-lib/icons)');
                diskF.forEach(drawRow);
            }
            if (customF.length) {
                appendSection('Imported (this browser)');
                customF.forEach(drawRow);
            }
            if (!presetsF.length && !diskF.length && !customF.length) {
                const empty = document.createElement('div');
                empty.className = 'layout-sl-assets-empty';
                empty.textContent = q
                    ? 'No images match the filter.'
                    : 'No images yet — add SVG files to lcd-lib/icons or use Add file…';
                list.appendChild(empty);
            }
        };

        repaintAssetList();

        const filtEl = document.getElementById('layout-assets-filter');
        if (filtEl && !filtEl._assetsFilterBound) {
            filtEl.addEventListener('input', repaintAssetList);
            filtEl._assetsFilterBound = true;
        }

        if (!importBtn._boundPaletteImport) {
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async () => {
                const f = fileInput.files?.[0];
                if (!f) return;
                const txt = await f.text();
                if (!txt.includes('<svg')) return;
                const now = loadCustomPaletteSvgs();
                const base = (f.name || 'Custom').replace(/\.svg$/i, '').trim() || 'Custom';
                now.unshift({ name: base, svg: txt });
                saveCustomPaletteSvgs(now);
                window._selectedPaletteIcon = { id: `custom-${Date.now()}`, name: base, svg: txt };
                fileInput.value = '';
                renderLayoutTreePanel(data, jsonPath, rerender);
            });
            importBtn._boundPaletteImport = true;
        }

        ensureLcdLibDiskCache().then(() => {
            const d2 = getLcdLibDiskSync();
            if (!Array.isArray(d2)) return;
            const sig = d2.map((x) => x.id).join('\n');
            if (sig === initialDiskSig) return;
            renderLayoutTreePanel(data, jsonPath, rerender);
        });
    };
    ensureIconPaletteUi();
    const factories = {
        text: (row, idx) => ({
            type: 'label',
            id: `label_${idx}`,
            text: 'New Text',
            x: 160,
            y: row * 20,
            align: 'center',
            color: '#ffffff'
        }),
        icon: (row, idx) => ({
            type: 'label',
            id: `icon_${idx}`,
            text:
                window._selectedPaletteIcon?.svg ||
                '<svg width="20" height="20" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
            libraryIconId: window._selectedPaletteIcon?.id || 'icon',
            libraryIconName: window._selectedPaletteIcon?.name || 'Icon',
            x: 280,
            y: row * 20,
            align: 'right',
            width: 40,
            color: '#ffffff'
        }),
        box: (row, idx) => ({
            type: 'menu_row',
            id: `row_${idx}`,
            label: 'New Param',
            value: '0',
            lcdRow: row,
            labelWidth: 140,
            valueWidth: 140
        }),
        row: (row, idx) => ({
            type: 'menu_row',
            id: `item_${idx}`,
            label: `Item ${idx}`,
            value: '',
            lcdRow: row,
            labelWidth: 240,
            valueWidth: 30
        })
    };
    document.querySelectorAll('[data-widget-add]').forEach((btn) => {
        const kind = btn.getAttribute('data-widget-add');
        const factory = factories[kind];
        if (!factory || btn._boundAddWidget) return;
        btn.addEventListener('click', () => {
            const path = window._currentJsonPath || jsonPath;
            const widgets = window._currentScreenData?.widgets || [];
            const nextRow = Math.min(8, Math.max(2, ...widgets.map((w) => Number(w.lcdRow) || 2)) + 1);
            widgets.push(factory(nextRow, widgets.length));
            rerender(path);
        });
        btn._boundAddWidget = true;
    });
}

function renderLayoutPropertiesPanel(data, jsonPath, rerender) {
    const panel = document.getElementById('layout-props-panel');
    const content = document.getElementById('layout-props-content');
    const header = panel?.querySelector('.layout-props-panel__header');
    if (!panel || !content) return;
    /* Inspector drag: attachFloatingPanelDrag(layout-props header) in ensureFloatingPanelsDragBound */
    const isEdit = !!window._isVisualEditMode;
    panel.classList.toggle('debug-ui-hidden', !isEdit);
    if (!isEdit) return;

    const nodes = buildPageNodes(data);
    const selected = nodes.find((n) => n.id === window._layoutSelectedNodeId);
    if (!selected) {
        content.innerHTML = '<div>Select an item in the tree to edit properties.</div>';
        return;
    }
    if (selected.childKind === 'lcd_outline') {
        content.innerHTML = '';
        const title = document.createElement('div');
        title.style.marginBottom = '10px';
        title.style.fontWeight = '700';
        title.textContent = 'LCD outline (workbench)';
        content.appendChild(title);
        const hint = document.createElement('p');
        hint.style.margin = '0 0 12px';
        hint.style.color = '#475569';
        hint.style.fontSize = '12px';
        hint.style.lineHeight = '1.45';
        hint.textContent =
            'Drag the highlighted edge strips on the device to move the LCD in the shell. Alt+arrow keys still nudge; Fit resets pan, zoom, and this offset.';
        content.appendChild(hint);
        const sec = document.createElement('div');
        sec.className = 'layout-props-section';
        const h = document.createElement('div');
        h.className = 'layout-props-section__title';
        h.textContent = 'Workbench offset (px)';
        sec.appendChild(h);
        const rowX = document.createElement('div');
        rowX.className = 'layout-props-row';
        const labX = document.createElement('label');
        labX.textContent = 'nudge X';
        const inX = document.createElement('input');
        inX.type = 'number';
        inX.id = 'layout-lcd-nudge-x';
        inX.value = String(Math.round(Number(window._tstatLcdNudgeX) || 0));
        rowX.appendChild(labX);
        rowX.appendChild(inX);
        sec.appendChild(rowX);
        const rowY = document.createElement('div');
        rowY.className = 'layout-props-row';
        const labY = document.createElement('label');
        labY.textContent = 'nudge Y';
        const inY = document.createElement('input');
        inY.type = 'number';
        inY.id = 'layout-lcd-nudge-y';
        inY.value = String(Math.round(Number(window._tstatLcdNudgeY) || 0));
        rowY.appendChild(labY);
        rowY.appendChild(inY);
        sec.appendChild(rowY);
        content.appendChild(sec);
        const actions = document.createElement('div');
        actions.className = 'layout-props-actions';
        const apply = document.createElement('button');
        apply.textContent = 'Apply';
        apply.onclick = () => {
            const nx = Math.round(Number(inX.value) || 0);
            const ny = Math.round(Number(inY.value) || 0);
            window._tstatLcdNudgeX = nx;
            window._tstatLcdNudgeY = ny;
            const d = window._currentScreenData;
            if (d) {
                if (!d.canvasProfile) d.canvasProfile = {};
                d.canvasProfile.previewOffsetX = nx;
                d.canvasProfile.previewOffsetY = ny;
            }
            window._persistTstatLcdNudge?.();
            window._applyTstatLcdNudgeTransform?.();
            window._syncTstatLcdEdgeDragLayer?.();
            rerender(jsonPath);
        };
        const reset = document.createElement('button');
        reset.textContent = 'Reset offset';
        reset.onclick = () => {
            inX.value = '0';
            inY.value = '0';
            apply.click();
        };
        actions.appendChild(apply);
        actions.appendChild(reset);
        content.appendChild(actions);
        return;
    }
    if (selected.childKind === 'shell_hw_group') {
        content.innerHTML = '';
        const title = document.createElement('div');
        title.style.marginBottom = '10px';
        title.style.fontWeight = '700';
        title.textContent = 'Hardware buttons (simulated)';
        content.appendChild(title);
        const p = document.createElement('p');
        p.style.margin = '0';
        p.style.color = '#475569';
        p.style.fontSize = '12px';
        p.style.lineHeight = '1.5';
        p.textContent =
            'The four on-device keys sit on the device chrome (not the LCD JSON). They dispatch the same arrow-key events as the real product. Select each key under this group in the tree to highlight it on the canvas.';
        content.appendChild(p);
        return;
    }
    if (selected.childKind === 'shell_hw_button') {
        content.innerHTML = '';
        const title = document.createElement('div');
        title.style.marginBottom = '10px';
        title.style.fontWeight = '700';
        title.textContent = selected.text;
        content.appendChild(title);
        const p = document.createElement('p');
        p.style.margin = '0';
        p.style.color = '#475569';
        p.style.fontSize = '12px';
        p.style.lineHeight = '1.5';
        p.textContent =
            'Simulated hardware control. In layout edit mode you can click the key on the device to select it; the button still sends navigation keys to the UI.';
        content.appendChild(p);
        return;
    }
    if (selected.childKind === 'shell_ref_photo') {
        content.innerHTML = '';
        const title = document.createElement('div');
        title.style.marginBottom = '10px';
        title.style.fontWeight = '700';
        title.textContent = 'Thermostat reference image';
        content.appendChild(title);
        const hint = document.createElement('p');
        hint.style.margin = '0 0 12px';
        hint.style.color = '#475569';
        hint.style.fontSize = '12px';
        hint.style.lineHeight = '1.45';
        hint.textContent =
            'Full-device overlay (#ref-photo) for aligning the LCD to a photo. When visible, click the image in edit mode to select it. Settings persist in this browser (localStorage).';
        content.appendChild(hint);
        const img = document.getElementById('ref-photo');
        const sec = document.createElement('div');
        sec.className = 'layout-props-section';
        const h = document.createElement('div');
        h.className = 'layout-props-section__title';
        h.textContent = 'Overlay';
        sec.appendChild(h);
        const rowVis = document.createElement('div');
        rowVis.className = 'layout-props-row';
        const labVis = document.createElement('label');
        labVis.textContent = 'Visible';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id = 'shell-ref-visible';
        cb.checked = img ? img.style.display !== 'none' : false;
        rowVis.appendChild(labVis);
        rowVis.appendChild(cb);
        sec.appendChild(rowVis);
        const rowOp = document.createElement('div');
        rowOp.className = 'layout-props-row';
        const labOp = document.createElement('label');
        labOp.textContent = 'Opacity';
        const inOp = document.createElement('input');
        inOp.type = 'number';
        inOp.min = '0';
        inOp.max = '1';
        inOp.step = '0.05';
        inOp.id = 'shell-ref-opacity';
        const op = img ? parseFloat(img.style.opacity) : NaN;
        inOp.value = String(Number.isFinite(op) ? op : 0.5);
        rowOp.appendChild(labOp);
        rowOp.appendChild(inOp);
        sec.appendChild(rowOp);
        const rowSrc = document.createElement('div');
        rowSrc.className = 'layout-props-row layout-props-row--stack';
        rowSrc.style.flexDirection = 'column';
        rowSrc.style.alignItems = 'stretch';
        const labSrc = document.createElement('label');
        labSrc.textContent = 'Image src (URL or data URI)';
        const ta = document.createElement('textarea');
        ta.id = 'shell-ref-src';
        ta.rows = 4;
        ta.style.width = '100%';
        ta.style.fontFamily = 'ui-monospace, Consolas, monospace';
        ta.style.fontSize = '11px';
        ta.value = img?.src || '';
        rowSrc.appendChild(labSrc);
        rowSrc.appendChild(ta);
        sec.appendChild(rowSrc);
        content.appendChild(sec);
        const actions = document.createElement('div');
        actions.className = 'layout-props-actions';
        const apply = document.createElement('button');
        apply.textContent = 'Apply';
        apply.onclick = () => {
            const el = document.getElementById('ref-photo');
            if (!el) return;
            const vis = cb.checked;
            const o = Math.min(1, Math.max(0, Number(inOp.value) || 0));
            const src = String(ta.value || '').trim();
            el.style.opacity = String(o);
            if (src) el.src = src;
            if (vis) {
                el.style.display = 'block';
                el.classList.add('ref-photo--visible');
            } else {
                el.style.display = 'none';
                el.classList.remove('ref-photo--visible');
            }
            if (typeof window._persistShellRefPhoto === 'function') window._persistShellRefPhoto();
            applySelectionOutline();
        };
        const hide = document.createElement('button');
        hide.textContent = 'Hide';
        hide.onclick = () => {
            cb.checked = false;
            apply.click();
        };
        actions.appendChild(apply);
        actions.appendChild(hide);
        content.appendChild(actions);
        return;
    }
    const widget = selected.widget;
    const isValueChild = selected.childKind === 'value';
    const isIconChild = selected.childKind === 'group_icon';
    content.innerHTML = '';
    const title = document.createElement('div');
    title.style.marginBottom = '10px';
    title.style.fontWeight = '700';
    const titleText = (() => {
        if (widget.type === 'label' && (widget.libraryIconName || widget.libraryIconId)) {
            return `Icon :: ${widget.libraryIconName || widget.libraryIconId}`;
        }
        return `${selected.text}`;
    })();
    title.textContent = titleText;
    content.appendChild(title);

    const widgetsArr = data.widgets || [];
    let wIdx = typeof selected.widgetIndex === 'number' ? selected.widgetIndex : widgetsArr.indexOf(widget);
    if (wIdx < 0) {
        const m = String(selected.id || '').match(/^w-(\d+)(?:-|$)/);
        if (m) wIdx = Number(m[1]);
    }

    const appendSection = (heading) => {
        const sec = document.createElement('div');
        sec.className = 'layout-props-section';
        const h = document.createElement('div');
        h.className = 'layout-props-section__title';
        h.textContent = heading;
        sec.appendChild(h);
        content.appendChild(sec);
        return sec;
    };

    const appendField = (parentEl, key, type) => {
        const row = document.createElement('div');
        row.className = 'layout-props-row';
        const label = document.createElement('label');
        label.textContent = key;
        const input = document.createElement('input');
        input.type = type === 'number' ? 'number' : 'text';
        input.dataset.key = key;
        if (key === 'optionsCsv') input.value = Array.isArray(widget.options) ? widget.options.join(', ') : '';
        else input.value = widget[key] ?? '';
        row.appendChild(label);
        row.appendChild(input);
        parentEl.appendChild(row);
    };

    const identitySec = appendSection('Identity');
    appendField(identitySec, 'treeName', 'text');
    appendField(identitySec, 'id', 'text');
    appendField(identitySec, 'type', 'text');

    if (wIdx >= 0 && selected.childKind !== 'group_icon') {
        const hierSec = appendSection('Hierarchy');
        const row = document.createElement('div');
        row.className = 'layout-props-row';
        const lab = document.createElement('label');
        lab.textContent = 'parentId';
        const sel = document.createElement('select');
        sel.dataset.key = 'parentId';
        getParentIdSelectOptions(widgetsArr, wIdx).forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            sel.appendChild(opt);
        });
        sel.value = widget.parentId || '';
        row.appendChild(lab);
        row.appendChild(sel);
        hierSec.appendChild(row);
    }

    const transformSec = appendSection('Transform');
    ['x', 'y', 'lcdRow', 'width', 'height', 'labelWidth', 'valueWidth'].forEach((k) => appendField(transformSec, k, 'number'));
    ['align', 'labelAlign', 'valueAlign'].forEach((k) => appendField(transformSec, k, 'text'));
    ['labelOffsetX', 'labelOffsetY', 'valueOffsetX', 'valueOffsetY'].forEach((k) => appendField(transformSec, k, 'number'));

    const contentSec = appendSection('Content');
    appendField(contentSec, 'label', 'text');
    appendField(contentSec, 'value', 'text');
    appendField(contentSec, 'text', 'text');

    const styleSec = appendSection('Style');
    ['fontSize', 'fontFamily', 'fontWeight'].forEach((k) => appendField(styleSec, k, k === 'fontSize' ? 'number' : 'text'));
    ['color', 'bg', 'borderColor', 'borderWidth', 'borderRadius'].forEach((k) => appendField(styleSec, k, k.includes('Width') || k.includes('Radius') ? 'number' : 'text'));
    ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].forEach((k) => appendField(styleSec, k, 'number'));

    const advSec = appendSection('Layout extras');
    ['highlightInsetX', 'highlightInsetY', 'highlightWidthAdjust', 'highlightHeightAdjust', 'highlightRadius'].forEach((k) => appendField(advSec, k, 'number'));
    appendField(advSec, 'optionsCsv', 'text');

    const makeSelectRow = (key, labelText, options, currentValue) => {
        const row = document.createElement('div');
        row.className = 'layout-props-row';
        const label = document.createElement('label');
        label.textContent = labelText;
        const sel = document.createElement('select');
        sel.dataset.key = key;
        options.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt.key;
            o.textContent = opt.label;
            sel.appendChild(o);
        });
        if (currentValue) sel.value = currentValue;
        row.appendChild(label);
        row.appendChild(sel);
        content.appendChild(row);
    };

    if (widget.type === 'menu_row' && isValueChild) {
        makeSelectRow('t3ValueBinding', 't3000Binding', getT3000PointOptions('VAR'), widget.t3ValueBinding || '');
    }
    if (widget.type === 'menu_row') {
        makeSelectRow(
            'labelDisplayMode',
            'labelDisplayMode',
            [
                { key: '', label: '(default)' },
                { key: '20char', label: '20char' },
                { key: '8char', label: '8char' },
                { key: 'none', label: 'none' },
                { key: 'custom', label: 'custom' }
            ],
            widget.labelDisplayMode || ''
        );
    }
    if (widget.type === 'label' && typeof widget.text === 'string' && widget.text.includes('id="temp_val"')) {
        makeSelectRow('t3ValueBinding', 't3000Binding', getT3000PointOptions('IN'), widget.t3ValueBinding || '');
    }
    if (widget.id === 'main_icons_group' && isIconChild) {
        const iconKey = selected.id.split('-icon-')[1] || 'day_night';
        const current = widget.t3IconBindings?.[iconKey] || '';
        makeSelectRow(`t3IconBinding:${iconKey}`, `${iconKey}Binding`, getT3000PointOptions('VAR'), current);
    }

    const actions = document.createElement('div');
    actions.className = 'layout-props-actions';
    const apply = document.createElement('button');
    apply.textContent = 'Apply';
    apply.onclick = () => {
        const widgetsApply = window._currentScreenData?.widgets;
        content.querySelectorAll('[data-key]').forEach((inp) => {
            const k = inp.dataset.key;
            const raw = inp.value;
            if (k === 'parentId') {
                if (!raw) delete widget.parentId;
                else widget.parentId = raw;
                if (Array.isArray(widgetsApply)) normalizeWidgetTreeOrder(widgetsApply);
                return;
            }
            if (k === 'optionsCsv') {
                if (!raw.trim()) delete widget.options;
                else widget.options = raw.split(',').map((s) => s.trim()).filter(Boolean);
                return;
            }
            if (k === 't3ValueBinding') {
                if (!raw) delete widget.t3ValueBinding;
                else widget.t3ValueBinding = raw;
                return;
            }
            if (k.startsWith('t3IconBinding:')) {
                const iconKey = k.split(':')[1];
                if (!widget.t3IconBindings) widget.t3IconBindings = {};
                if (!raw) delete widget.t3IconBindings[iconKey];
                else widget.t3IconBindings[iconKey] = raw;
                return;
            }
            if (raw === '') {
                delete widget[k];
                return;
            }
            widget[k] = inp.type === 'number' ? Number(raw) : raw;
        });
        rerender(jsonPath);
    };
    actions.appendChild(apply);
    const testBtn = document.createElement('button');
    testBtn.textContent = 'Run UI Self-Test';
    testBtn.onclick = () => {
        const steps = [];
        try {
            if (!window._isVisualEditMode) {
                const shell = document.getElementById('thermostat-shell-lock-btn');
                if (shell && !shell.classList.contains('thermostat-shell-lock-btn--hidden')) {
                    shell.click();
                    steps.push('bezel-lock');
                } else {
                    const lb = document.getElementById('btn-lock-save');
                    if (lb) {
                        lb.click();
                        steps.push('btn-lock-save');
                    }
                }
            }
            const treeNode = document.querySelector('.layout-tree-node:not(.layout-tree-node--screen)');
            if (treeNode) { treeNode.dispatchEvent(new MouseEvent('click', { bubbles: true })); steps.push('tree-select'); }
            const nextBtn = document.getElementById('btn_next');
            if (nextBtn) { nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); steps.push('next-click'); }
            console.log(`[Self-Test] OK: ${steps.join(', ')}`);
        } catch (err) {
            console.error('[Self-Test] FAIL:', err?.message || err);
        }
    };
    actions.appendChild(testBtn);
    const scenarioBtn = document.createElement('button');
    scenarioBtn.textContent = 'Run Scenario Test';
    scenarioBtn.onclick = async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const log = [];
        try {
            console.log('[Scenario] starting...');
            // 1) Go Home
            window.navigateTo('main');
            await wait(120);
            if (window._currentScreenData?.page !== 'MAIN_DISPLAY') throw new Error('not on MAIN_DISPLAY');
            log.push('home');
            // 2) Go Setup
            window.navigateTo('setup');
            await wait(120);
            if (window._currentScreenData?.page !== 'SETUP_MENU') throw new Error('not on SETUP_MENU');
            log.push('setup');
            // 3) Go WiFi
            window.navigateTo('ethernet');
            await wait(120);
            if (window._currentScreenData?.page !== 'WIFI_SETTINGS') throw new Error('not on WIFI_SETTINGS');
            log.push('wifi');
            // 4) Enter edit mode (bezel lock or panel Edit — Widgets panel is hidden until edit)
            if (!window._isVisualEditMode) {
                const shell = document.getElementById('thermostat-shell-lock-btn');
                if (shell && !shell.classList.contains('thermostat-shell-lock-btn--hidden')) shell.click();
                else document.getElementById('btn-lock-save')?.click();
            }
            await wait(150);
            if (!window._isVisualEditMode) throw new Error('edit mode not enabled');
            log.push('edit-on');
            // 5) Adjust width field
            const before = Number((window._currentScreenData.widgets || []).find((w) => w.id === 'ui_item_dhcp')?.valueWidth || 0);
            window._layoutSelectedNodeId = (() => {
                const nodes = buildPageNodes(window._currentScreenData);
                return nodes.find((n) => n.childKind === 'value' && n.widget?.id === 'ui_item_dhcp')?.id || null;
            })();
            renderScreen(window._currentJsonPath);
            await wait(120);
            const input = document.querySelector('#layout-props-content input[data-key="valueWidth"]');
            if (!input) throw new Error('valueWidth input not found');
            input.value = String(before + 4);
            const applyBtn = Array.from(document.querySelectorAll('#layout-props-content .layout-props-actions button')).find((b) => b.textContent === 'Apply');
            if (!applyBtn) throw new Error('Apply button not found');
            applyBtn.click();
            await wait(140);
            const after = Number((window._currentScreenData.widgets || []).find((w) => w.id === 'ui_item_dhcp')?.valueWidth || 0);
            if (after === before) throw new Error('valueWidth did not change');
            log.push('resize');
            // 6) Run / save (exit edit)
            const runBtn = document.getElementById('sls-run-preview-btn');
            if (runBtn && window._isVisualEditMode) runBtn.click();
            await wait(200);
            if (window._isVisualEditMode) throw new Error('run/save did not complete');
            log.push('save');
            console.log(`[Scenario] PASS: ${log.join(' -> ')}`);
        } catch (err) {
            console.error('[Scenario] FAIL:', err?.message || err);
        }
    };
    actions.appendChild(scenarioBtn);
    content.appendChild(actions);
}

/** Clears pending selection→full `renderScreen` (see `selectLayoutNode` inside `renderScreen`). */
function cancelDebouncedSelectLayoutRender() {
    if (window._layoutSelectRenderDebounceTimer) {
        clearTimeout(window._layoutSelectRenderDebounceTimer);
        window._layoutSelectRenderDebounceTimer = null;
    }
}

function applySelectionOutline() {
    document.querySelectorAll('.layout-selected-el').forEach((el) => el.classList.remove('layout-selected-el'));
    const selectedId = window._layoutSelectedNodeId;
    if (!selectedId) return;
    let target = null;
    if (selectedId === 'lcd-outline') {
        target = document.getElementById('tstat-lcd-edge-layer') || document.getElementById('tstat-lcd-container');
    }
    if (!target) target = document.querySelector(`[data-tree-node-id="${selectedId}"]`);
    if (!target && selectedId.includes('-icon-')) {
        const parentId = selectedId.split('-').slice(0, 2).join('-');
        const iconKey = selectedId.split('-icon-')[1];
        target = document.querySelector(`[data-tree-node-id="${parentId}"] [data-icon-key="${iconKey}"]`) ||
            document.querySelector(`[data-tree-node-id="${parentId}"]`);
    }
    if (!target && (selectedId.includes('-label') || selectedId.includes('-value'))) {
        const parentId = selectedId.split('-').slice(0, 2).join('-');
        target = document.querySelector(`[data-tree-node-id="${selectedId}"]`) ||
            document.querySelector(`[data-tree-node-id="${parentId}"]`);
    }
    if (target) {
        target.classList.add('layout-selected-el');
        target.classList.add('layout-selected-pulse');
        setTimeout(() => target.classList.remove('layout-selected-pulse'), 260);
    }
}

window._cancelDebouncedSelectLayoutRender = cancelDebouncedSelectLayoutRender;

function setupMainTickerSimulation(data) {
    if (!data || data.page !== 'MAIN_DISPLAY') {
        if (window._tickerTimer) {
            clearInterval(window._tickerTimer);
            window._tickerTimer = null;
        }
        return;
    }
    const tickerHost = document.querySelector('#tstat-lcd-container [data-tree-node-id][id="main_ticker_line"], #main_ticker_line');
    if (!tickerHost) return;

    // Ensure we can safely render animated text inside the ticker box.
    const tickerInner = tickerHost.querySelector('div');
    if (!tickerInner) return;
    if (tickerInner.dataset.tickerInit !== '1') {
        const initial = (tickerInner.textContent || '168.0.151').trim();
        tickerInner.innerHTML = `<span class="tstat-ticker-text">${escapeHtml(initial)}</span>`;
        tickerInner.style.position = 'relative';
        tickerInner.style.overflow = 'hidden';
        tickerInner.dataset.tickerInit = '1';
    }
    const tickerText = tickerInner.querySelector('.tstat-ticker-text');
    if (!tickerText) return;

    const messages = [
        '168.0.151',
        'WIFI: LINK OK',
        'SYNC: CLOUD OK',
        'SENSOR: NORMAL',
        'ALARM: NONE'
    ];
    if (typeof window._tickerMsgIndex !== 'number') window._tickerMsgIndex = 0;
    if (typeof window._tickerOffsetX !== 'number') window._tickerOffsetX = tickerInner.clientWidth;

    const stopTicker = () => {
        if (window._tickerTimer) {
            clearInterval(window._tickerTimer);
            window._tickerTimer = null;
        }
        tickerInner.style.overflow = 'hidden';
        tickerText.style.position = 'relative';
        tickerText.style.display = 'inline-block';
        tickerText.style.whiteSpace = 'normal';
        tickerText.style.transform = '';
    };

    if (window._isVisualEditMode) {
        stopTicker();
        return;
    }

    if (window._tickerTimer) return;
    tickerInner.style.overflow = 'hidden';
    tickerText.style.position = 'absolute';
    tickerText.style.left = '0';
    tickerText.style.top = '50%';
    tickerText.style.transform = 'translateY(-50%)';
    tickerText.style.whiteSpace = 'nowrap';

    const restartLine = () => {
        const boxW = tickerInner.clientWidth || 240;
        window._tickerMsgIndex = (window._tickerMsgIndex + 1) % messages.length;
        tickerText.textContent = messages[window._tickerMsgIndex];
        window._tickerOffsetX = boxW;
    };

    // Start with current index without skipping.
    tickerText.textContent = messages[window._tickerMsgIndex % messages.length];
    window._tickerOffsetX = tickerInner.clientWidth || 240;

    // Requested: run ticker at 1/3 of prior speed.
    window._tickerTimer = setInterval(() => {
        const textW = Math.max(60, tickerText.scrollWidth);
        window._tickerOffsetX -= (1 / 3);
        tickerText.style.transform = `translate(${window._tickerOffsetX}px, -50%)`;
        if (window._tickerOffsetX < -textW - 12) {
            restartLine();
        }
    }, 18);
}

// Central navigation function
window.navigateTo = function(screenName) {
    const jsonPath = ROUTE_TO_JSON_PATH[screenName];
    if (jsonPath) {
        saveLastScreenPath(jsonPath);
        // Restore per-screen focus state when returning to this screen.
        const state = getScreenStateMap()[jsonPath] || {};
        window._currentScreenFocus = typeof state.focusIndex === 'number' ? state.focusIndex : 0;
        window._ipEditOctetIndex = typeof state.ipOctetIndex === 'number' ? state.ipOctetIndex : 0;
        window._ipEditMode = !!state.ipEditMode;
        window._wifiRowEditMode = !!state.wifiRowEditMode;
        window._valueEditMode = !!state.valueEditMode;
        if (jsonPath.includes('provisioning_setup')) {
            window._provisioningButtonFocus = typeof state.provisioningButtonFocus === 'number' ? state.provisioningButtonFocus : 0;
        }
        renderScreen(jsonPath);
    } else {
        console.error(`[Navigate] Unknown screen: ${screenName}`);
    }
}

function syncVisualEditShellClass() {
    document.body.classList.toggle('visual-edit-shell', !!window._isVisualEditMode);
    if (typeof window._applyTstatViewTransform === 'function') {
        queueMicrotask(() => window._applyTstatViewTransform());
    }
}

/** Debug UI lives inside #layout-props-panel; visibility follows layout edit. */
function syncDebugEventPanelVisibility() {
    /* no-op: #debug-event-panel is nested in layout-props-panel */
}

const TSTAT_SKIP_SAVE_SERVER_KEY = 'tstat_skip_optional_save_server_v1';

/**
 * Optional: POST JSON to save-server (see `npm run save-server`) on port 5001 so edits write to disk.
 * If nothing listens, the browser logs one failed network request; we then skip further tries for this tab session to avoid spam.
 * Data is always persisted via saveScreenToCache (localStorage) regardless.
 */
function postToOptionalLocalSaveServer(activeJsonPath, jsonString) {
    if (window._tstatAlwaysTrySaveServer === false) return;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(TSTAT_SKIP_SAVE_SERVER_KEY) === '1') return;
    const targetFile = activeJsonPath.split('/').pop();
    fetch(`http://localhost:5001/save_settings?file=${targetFile}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonString
    })
        .then((resp) => {
            if (!resp.ok) throw new Error(`save HTTP ${resp.status}`);
        })
        .catch(() => {
            try {
                sessionStorage.setItem(TSTAT_SKIP_SAVE_SERVER_KEY, '1');
            } catch (_) {
                /* ignore */
            }
            console.debug(
                '[Visual Edit] Optional disk save (localhost:5001) unavailable — edits remain in browser localStorage. Run `npm run save-server` to write JSON files.',
                { file: targetFile }
            );
        });
}
window.__tstat_resetOptionalSaveServerProbe = () => {
    try {
        sessionStorage.removeItem(TSTAT_SKIP_SAVE_SERVER_KEY);
    } catch (_) {
        /* ignore */
    }
};

/** Show Hierarchy + Inspector as soon as layout edit toggles, even if renderScreen() returns early (e.g. JSON fetch error). */
function syncLayoutEditPanelsShellVisibility() {
    const widgets = document.getElementById('layout-widgets-panel');
    const tree = document.getElementById('layout-tree-panel');
    const props = document.getElementById('layout-props-panel');
    const isEdit = !!window._isVisualEditMode;
    if (widgets) widgets.classList.toggle('debug-ui-hidden', !isEdit);
    if (tree) tree.classList.toggle('debug-ui-hidden', !isEdit);
    if (props) props.classList.toggle('debug-ui-hidden', !isEdit);
    if (typeof window._syncTstatLcdEdgeDragLayer === 'function') window._syncTstatLcdEdgeDragLayer();
}

/**
 * Tstat10-only: toggle runtime vs visual layout edit (not in SquareLine).
 * Shared by the bezel lock/play control, Widgets panel Edit, top bar Run (play), and debug tools — do not rely on .click() delegation.
 */
function runVisualEditLockToggle() {
    const activeJsonPath = window._currentJsonPath || DEFAULT_STARTUP_JSON_PATH;
    window._isVisualEditMode = !window._isVisualEditMode;
    syncVisualEditShellClass();
    const gridToggle = document.getElementById('toggle-grid-layer');
    if (window._isVisualEditMode) {
        window._gridBeforeVisualEdit = !!window._tstatShowGridLayer;
        window._tstatShowGridLayer = true;
        document.body.classList.add('debug-active');
        if (gridToggle) {
            window._tstatSuppressGridToggleRender = true;
            try {
                gridToggle.checked = true;
            } finally {
                window._tstatSuppressGridToggleRender = false;
            }
        }
    } else {
        const restore = typeof window._gridBeforeVisualEdit === 'boolean' ? window._gridBeforeVisualEdit : false;
        window._tstatShowGridLayer = restore;
        if (restore) document.body.classList.add('debug-active');
        else document.body.classList.remove('debug-active');
        if (gridToggle) {
            window._tstatSuppressGridToggleRender = true;
            try {
                gridToggle.checked = restore;
            } finally {
                window._tstatSuppressGridToggleRender = false;
            }
        }
    }
    if (!window._isVisualEditMode) {
        const d = window._currentScreenData;
        if (d && typeof validateLayoutData === 'function') {
            const vr = validateLayoutData(d);
            if (!vr.valid && typeof writeStatus === 'function') {
                writeStatus(`Layout validation: ${vr.errors.join('; ') || 'errors'}`, true);
            }
        }
        const jsonString = JSON.stringify(window._currentScreenData, null, 2);
        syncWorkbenchNudgeIntoScreenDataForCache(window._currentScreenData);
        saveScreenToCache(activeJsonPath, window._currentScreenData);
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage({ action: 'save_settings', data: window._currentScreenData });
        } else {
            postToOptionalLocalSaveServer(activeJsonPath, jsonString);
        }
    }
    syncDebugEventPanelVisibility();
    syncLayoutEditPanelsShellVisibility();
    renderScreen(activeJsonPath);
}
window.runVisualEditLockToggle = runVisualEditLockToggle;

/** Capture-phase handler so nothing can sit above the lock in the bubble chain; works with touch + mouse. */
function bindGlobalVisualEditLockControlsOnce() {
    if (window._visualEditLockControlsBound) return;
    window._visualEditLockControlsBound = true;
    const onActivate = (e) => {
        const raw = e.target;
        const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
        const t =
            el &&
            el.closest &&
            el.closest('#sls-run-preview-btn, #btn-lock-save, #thermostat-shell-lock-btn');
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof runVisualEditLockToggle === 'function') runVisualEditLockToggle();
    };
    document.addEventListener('click', onActivate, true);
}
bindGlobalVisualEditLockControlsOnce();

/** Simulated RSSI label + wifi_N icon file (no extension) vs provisioning status. */
function getProvisioningRssiPresentation(statusValue) {
    const s = String(statusValue || 'Ready').trim();
    const table = {
        Ready: { icon: 'wifi_2', text: '-68 dBm', quality: 'Good' },
        Connecting: { icon: 'wifi_1', text: '-74 dBm', quality: 'Weak' },
        Requesting: { icon: 'wifi_3', text: '-59 dBm', quality: 'Good' },
        Success: { icon: 'wifi_4', text: '-52 dBm', quality: 'Strong' },
        Failed: { icon: 'wifi_none', text: 'No signal', quality: 'No signal' },
        'WiFi connected': { icon: 'wifi_4', text: '-46 dBm', quality: 'Excellent' }
    };
    return table[s] || table.Ready;
}

/** Insert defaults from legacy 320×480 sim; `ensureProvisioningSetupHasRssi` scales to current canvas. */
const PROV_RSSI_ICON_WIDGET = {
    type: 'label',
    id: 'prov_rssi_icon',
    text: '',
    x: 308,
    y: 8,
    align: 'right',
    width: 36,
    color: '#ffffff'
};
const PROV_RSSI_ROW_WIDGET = {
    type: 'menu_row',
    id: 'ui_item_prov_rssi',
    label: 'RSSI',
    value: '-68 dBm',
    lcdRow: 6,
    labelWidth: 52,
    valueWidth: 248,
    notes: 'Simulated dBm; wide value for dBm / No signal'
};
const PROV_RSSI_QUALITY_ROW_WIDGET = {
    type: 'menu_row',
    id: 'ui_item_prov_rssi_quality',
    label: 'Signal',
    value: 'Good',
    lcdRow: 7,
    labelWidth: 56,
    valueWidth: 244,
    notes: 'Qualitative RSSI (Weak … Excellent) vs provisioning status'
};

/**
 * Heal stale copies (other worktrees, cached localStorage) that predate RSSI widgets.
 * Canonical order: AP=3, Pass=4, Status=5, RSSI=6, Signal=7.
 */
function ensureProvisioningSetupHasRssi(data) {
    if (data?.page !== 'PROVISIONING_SETUP' || !Array.isArray(data.widgets)) return;
    const widgets = data.widgets;
    const cw = canvasLogicalWidthPx(data);
    const ch = canvasLogicalHeightPx(data);
    const sx = cw / TSTAT10_LEGACY_DEVKIT_LCD_W;
    const sy = ch / TSTAT10_LEGACY_DEVKIT_LCD_H;
    const headerIdx = widgets.findIndex((x) => x && x.type === 'header');

    if (!widgets.some((x) => x && x.id === 'prov_rssi_icon')) {
        const ins = headerIdx >= 0 ? headerIdx + 1 : 0;
        widgets.splice(ins, 0, { ...PROV_RSSI_ICON_WIDGET });
    }
    if (!widgets.some((x) => x && x.id === 'ui_item_prov_rssi')) {
        const iconI = widgets.findIndex((x) => x && x.id === 'prov_rssi_icon');
        const ins = iconI >= 0 ? iconI + 1 : (headerIdx >= 0 ? headerIdx + 1 : 0);
        widgets.splice(ins, 0, { ...PROV_RSSI_ROW_WIDGET });
    }
    if (!widgets.some((x) => x && x.id === 'ui_item_prov_rssi_quality')) {
        const rssiI = widgets.findIndex((x) => x && x.id === 'ui_item_prov_rssi');
        const ins = rssiI >= 0 ? rssiI + 1 : 0;
        widgets.splice(ins, 0, { ...PROV_RSSI_QUALITY_ROW_WIDGET });
    }

    const ap = widgets.find((x) => x && x.id === 'ui_item_prov_ap');
    const pass = widgets.find((x) => x && x.id === 'ui_item_prov_pass');
    const st = widgets.find((x) => x && x.id === 'ui_item_prov_status');
    const rssi = widgets.find((x) => x && x.id === 'ui_item_prov_rssi');
    const qual = widgets.find((x) => x && x.id === 'ui_item_prov_rssi_quality');
    const icon = widgets.find((x) => x && x.id === 'prov_rssi_icon');
    if (ap) ap.lcdRow = 3;
    if (pass) {
        pass.lcdRow = 4;
        if (String(pass.label || '') === 'Password') pass.label = 'Pass';
        if (Number(pass.labelWidth) > Math.round(80 * sx)) {
            pass.labelWidth = Math.round(52 * sx);
            pass.valueWidth = Math.round(248 * sx);
        }
    }
    if (st) st.lcdRow = 5;
    if (rssi) {
        rssi.lcdRow = 6;
        /* Heal stale narrow template; scale legacy 52/248 to current canvas without clobbering custom inspector widths. */
        if (nearIntPx(rssi.valueWidth, 118) && nearIntPx(rssi.labelWidth, 44)) {
            rssi.labelWidth = Math.round(52 * sx);
            rssi.valueWidth = Math.round(248 * sx);
        } else if (nearIntPx(rssi.labelWidth, 52) && nearIntPx(rssi.valueWidth, 248)) {
            rssi.labelWidth = Math.round(52 * sx);
            rssi.valueWidth = Math.round(248 * sx);
        }
    }
    if (qual) {
        qual.lcdRow = 7;
        if (nearIntPx(qual.labelWidth, 56) && nearIntPx(qual.valueWidth, 244)) {
            qual.labelWidth = Math.round(56 * sx);
            qual.valueWidth = Math.round(244 * sx);
        }
    }
    if (icon) {
        const iw = Math.max(20, Math.round(36 * sx));
        icon.width = iw;
        icon.y = Math.max(4, Math.round(8 * sy));
        icon.x = Math.max(0, Math.round(cw - iw - 4 * sx));
    }

    const c = widgets.find((x) => x && x.id === 'btn_connect_phone');
    const b = widgets.find((x) => x && x.id === 'btn_back');
    if (c) c.y = Math.round(352 * sy);
    if (b) b.y = Math.round(408 * sy);
}

function shouldProvSimulateFailure() {
    try {
        if (window._provSimulateFailure === true) return true;
        return new URLSearchParams(window.location.search).get('provFail') === '1';
    } catch {
        return false;
    }
}

function clearProvisioningFlowTimers() {
    window.clearTimeout(window._provConnectTimer);
    window.clearTimeout(window._provConnectTimer2);
    window.clearTimeout(window._provOutcomeTimer);
    window.clearTimeout(window._provWifiTimer);
}

/** After Requesting: apply password from phone app (simulated); then Success → WiFi connected. */
function runProvisioningSuccessExchange(jsonPath) {
    const path = jsonPath || window._currentJsonPath || ROUTE_TO_JSON_PATH.provisioning;
    const data = window._currentScreenData;
    if (!data?.widgets) return;
    if (data.page !== 'PROVISIONING_SETUP' && !String(path).includes('provisioning_setup')) return;

    const pass = data.widgets.find((w) => w && w.id === 'ui_item_prov_pass');
    const st = data.widgets.find((w) => w && w.id === 'ui_item_prov_status');
    if (pass) pass.value = '********';
    if (st) st.value = 'Success';

    saveScreenToCache(path, data);
    renderScreen(path);

    window.clearTimeout(window._provWifiTimer);
    window._provWifiTimer = window.setTimeout(() => {
        const d = window._currentScreenData;
        if (!d || d.page !== 'PROVISIONING_SETUP') return;
        const st2 = d.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
        if (st2 && String(st2.value) === 'Success') {
            st2.value = 'WiFi connected';
            saveScreenToCache(window._currentJsonPath || path, d);
            renderScreen(window._currentJsonPath || path);
        }
    }, 1200);
}

function startProvisioningConnectFlow(jsonPath) {
    const path = jsonPath || window._currentJsonPath || ROUTE_TO_JSON_PATH.provisioning;
    const data = window._currentScreenData;
    if (!data || data.page !== 'PROVISIONING_SETUP') return;
    const st0 = data.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
    const busy = st0 && ['Connecting', 'Requesting'].includes(String(st0.value));
    if (busy) return;

    clearProvisioningFlowTimers();
    const st = data.widgets.find((w) => w && w.id === 'ui_item_prov_status');
    if (st) st.value = 'Connecting';
    saveScreenToCache(path, data);
    renderScreen(path);

    window._provConnectTimer = window.setTimeout(() => {
        const d = window._currentScreenData;
        if (!d || d.page !== 'PROVISIONING_SETUP') return;
        const s2 = d.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
        if (s2 && String(s2.value) === 'Connecting') {
            s2.value = 'Requesting';
            saveScreenToCache(window._currentJsonPath || path, d);
            renderScreen(window._currentJsonPath || path);
        }
    }, 900);

    window._provConnectTimer2 = window.setTimeout(() => {
        const d = window._currentScreenData;
        if (!d || d.page !== 'PROVISIONING_SETUP') return;
        const s3 = d.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
        if (!s3 || String(s3.value) !== 'Requesting') return;
        if (shouldProvSimulateFailure()) {
            s3.value = 'Failed';
            saveScreenToCache(window._currentJsonPath || path, d);
            renderScreen(window._currentJsonPath || path);
            return;
        }
        runProvisioningSuccessExchange(window._currentJsonPath || path);
    }, 900 + 1000);
}

/** Arrow keys: focus Connect ↔ Back; Enter activates; Left exits to setup. */
function handleProvisioningArrowKey(e) {
    if (window._isVisualEditMode) return false;
    const path = window._currentJsonPath;
    if (!path) return false;
    let bf = typeof window._provisioningButtonFocus === 'number' ? window._provisioningButtonFocus : 0;
    bf = bf ? 1 : 0;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.key === 'ArrowRight') {
            bf = (bf + 1) % 2;
        } else if (e.key === 'ArrowDown') {
            bf = Math.min(1, bf + 1);
        } else {
            bf = Math.max(0, bf - 1);
        }
        window._provisioningButtonFocus = bf;
        const sm = getScreenStateMap();
        sm[path] = { ...sm[path], provisioningButtonFocus: bf };
        renderScreen(path);
        return true;
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        window._ipEditMode = false;
        window._valueEditMode = false;
        window.navigateTo('setup');
        return true;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        bf = typeof window._provisioningButtonFocus === 'number' ? window._provisioningButtonFocus : 0;
        if (bf === 0) {
            startProvisioningConnectFlow(path);
        } else {
            window.navigateTo('setup');
        }
        return true;
    }
    return false;
}

/** Provisioning uses automatic flow; hide the extra bezel lock control on that screen. */
function syncThermostatShellLockButtonVisibility() {
    const btn = document.getElementById('thermostat-shell-lock-btn');
    if (!btn) return;
    const path = String(window._currentJsonPath || '');
    const page = window._currentScreenData?.page;
    const onProv = page === 'PROVISIONING_SETUP' || path.includes('provisioning_setup');
    btn.classList.toggle('thermostat-shell-lock-btn--hidden', onProv);
}

export async function renderScreen(jsonPath) {
    if (window._tstatRenderScreenInFlight) {
        window._tstatRenderScreenQueuedPath = jsonPath;
        return;
    }
    window._tstatRenderScreenInFlight = true;
    try {
    cancelDebouncedSelectLayoutRender();
    bindExplorerRenameHotkeysOnce();
    // Track active screen path immediately so lock/save actions always apply to current page.
    window._currentJsonPath = jsonPath;
    saveLastScreenPath(jsonPath);
    // Prepare LCD container
    const lcdGrid = document.getElementById('tstat-lcd-container');
    if (!lcdGrid) {
        const ph = document.getElementById('thermostat-shell-lock-btn');
        if (ph) ph.classList.add('thermostat-shell-lock-btn--hidden');
        return;
    }
    ensureFloatingPanelsDragBound();
    syncVisualEditShellClass();
    syncDebugEventPanelVisibility();
    syncLayoutEditPanelsShellVisibility();

    // Inject VS Code styling for debug tools and context menus to make them larger and monospaced
    if (!document.getElementById('vscode-debug-styles')) {
        const style = document.createElement('style');
        style.id = 'vscode-debug-styles';
        style.innerHTML = `
            /* Keep monospace only for editor/debug surfaces, not the LCD UI itself */
            /* SquareLine-style UI uses system sans for hierarchy/inspector; monospace reserved for validation output */
            #layout-widgets-panel,
            #layout-tree-panel,
            #layout-props-panel {
                font-family: 'Segoe UI', 'Inter', system-ui, sans-serif !important;
                font-size: 12px;
            }
            
            /* VS Code style for visual edit context menus */
            #visual-edit-context-menu {
                font-family: inherit !important;
                font-size: 14px !important;
                min-width: 180px;
                padding: 8px !important;
            }
            #visual-edit-context-menu button {
                font-family: inherit !important;
                font-size: 14px !important;
                padding: 6px 12px !important;
                margin: 4px 2px !important;
                cursor: pointer;
                background: #f3f3f3;
                border: 1px solid #ccc;
                border-radius: 4px;
            }
            #visual-edit-context-menu button:hover {
                background: #e5e5e5;
            }
            
            /* Target specific debug elements to ensure legibility */
            [id*="debug-"], [id*="toggle"] {
                font-size: 14px !important;
            }
            #btn-lock-save.layout-widgets-panel__play-btn {
                font-size: 11px !important;
                padding: 4px 10px !important;
                font-weight: 600 !important;
                border-radius: 4px !important;
                display: inline-flex !important;
                align-items: center !important;
                justify-content: center !important;
                gap: 4px !important;
            }
            #btn-lock-save .layout-widgets-panel__play-icon {
                display: block !important;
            }
        `;
        document.head.appendChild(style);
    }
    // Remove any previous grid overlay
    const prevGrid = lcdGrid.querySelector('.debug-grid');
    if (prevGrid) prevGrid.remove();
    // Do NOT clear lcdGrid.innerHTML here—main UI will be rendered below

    // --- Lens outline ("redbox"): framed glass, aligned to top of thermostat body ---
    const deviceBezel = lcdGrid.closest('.device-bezel');
    const prevLensLegacy = lcdGrid.querySelector('.tstat-lens-outline');
    if (prevLensLegacy) prevLensLegacy.remove();
    if (deviceBezel) {
        const prevLens = deviceBezel.querySelector('.tstat-lens-outline');
        if (prevLens) prevLens.remove();
        const lens = document.createElement('div');
        lens.className = 'tstat-lens-outline';
        lens.setAttribute('aria-hidden', 'true');
        const lensCw = canvasLogicalWidthPx(window._currentScreenData || {});
        const lensCh = canvasLogicalHeightPx(window._currentScreenData || {});
        const lensW = Math.round((475 * lensCw) / TSTAT10_LEGACY_DEVKIT_LCD_W);
        const lensHLegacy = Math.round(484 * 1.3 * 1.2 * 0.95);
        const lensH = Math.round((lensHLegacy * lensCh) / TSTAT10_LEGACY_DEVKIT_LCD_H);
        lens.style.position = 'absolute';
        lens.style.top = '0';
        lens.style.left = '50%';
        lens.style.transform = 'translateX(-50%)';
        lens.style.width = `${lensW}px`;
        lens.style.height = `${lensH}px`; /* same relative scale as legacy 475×717 outline vs 320×480 canvas */
        lens.style.border = '3px solid #c4c4c4';
        lens.style.background = 'transparent';
        lens.style.boxSizing = 'border-box';
        lens.style.pointerEvents = 'none';
        lens.style.zIndex = '15';
        deviceBezel.appendChild(lens);
    }
    // Show LCD redbox coordinates in debug panel if present
    setTimeout(() => {
        if (typeof updateRedboxDebugPanel === 'function') updateRedboxDebugPanel();
    }, 0);
    // Redbox debug flag: always sync with checkbox state if present
    const redboxToggle = document.getElementById('toggle-redbox');
    if (redboxToggle) {
        if (!redboxToggle._redboxListenerAttached) {
            redboxToggle.addEventListener('change', (e) => {
                window._tstatShowRedbox = redboxToggle.checked;
                renderScreen(jsonPath);
            });
            redboxToggle._redboxListenerAttached = true;
        }
        redboxToggle.checked = !!window._tstatShowRedbox;
    } else {
        window._tstatShowRedbox = window._tstatShowRedbox ?? false;
    }
    // Update debug event panel if present using reusable routine
    setTimeout(() => {
        if (typeof updateDebugPanel === 'function') updateDebugPanel(window._currentScreenData);
    }, 0);

    const lcd = document.getElementById('tstat-lcd-container');
    if (!lcd) return;
    bindLcdPaletteIconDropOnce(lcd);
    ensureLcdCanvasPickMenuAttached(lcd);

    // Clear old UI elements, but preserve the grid overlay (lens lives on .device-bezel)
    Array.from(lcd.children).forEach(child => {
        if (!child.classList.contains('debug-grid')) child.remove();
    });

    // Debug layer flags (global for toggling) - allow toggles to control overlays
    if (typeof window._tstatShowGridLayer === 'undefined') {
        window._tstatShowGridLayer = false; // Default grid OFF
    }
    document.body.classList.add('debug-active');
    window._tstatShowCoordsLayer = window._tstatShowCoordsLayer ?? false;

    // Attach debug layer toggle listeners (grid, coords) using reusable routine
    setupDebugToggles(() => renderScreen(jsonPath));
    // Sync grid toggle button state after refresh (suppress change → renderScreen feedback loops)
    const gridToggle = document.getElementById('toggle-grid-layer');
    if (gridToggle) {
        window._tstatSuppressGridToggleRender = true;
        try {
            gridToggle.checked = !!window._tstatShowGridLayer;
        } finally {
            window._tstatSuppressGridToggleRender = false;
        }
    }

    const PLAY_ICON_SVG =
        '<svg class="layout-widgets-panel__play-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5z" fill="currentColor"/></svg>';
    const THERMOSTAT_SHELL_LOCK_ICON_SVG =
        '<svg class="thermostat-shell-lock-btn__icon" width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>';
    const PLAY_ICON_SHELL_SVG =
        '<svg class="thermostat-shell-lock-btn__icon" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5z" fill="currentColor"/></svg>';
    const lockBtn = document.getElementById('btn-lock-save');
    if (lockBtn) {
        if (window._isVisualEditMode) {
            lockBtn.innerHTML = PLAY_ICON_SVG;
            lockBtn.title = 'Run — save and exit layout edit (same as top bar play)';
            lockBtn.setAttribute('aria-label', 'Run, save and exit layout edit');
            lockBtn.classList.add('is-active');
        } else {
            lockBtn.textContent = 'Edit';
            lockBtn.title = 'Edit layout';
            lockBtn.setAttribute('aria-label', 'Edit layout');
            lockBtn.classList.remove('is-active');
        }
    }
    const shellLockBtn = document.getElementById('thermostat-shell-lock-btn');
    if (shellLockBtn) {
        if (window._isVisualEditMode) {
            shellLockBtn.innerHTML = PLAY_ICON_SHELL_SVG;
            shellLockBtn.title = 'Run — save and exit layout edit (same as top bar play)';
            shellLockBtn.setAttribute('aria-label', 'Run, save and exit layout edit');
            shellLockBtn.classList.add('is-active');
        } else {
            shellLockBtn.innerHTML = THERMOSTAT_SHELL_LOCK_ICON_SVG;
            shellLockBtn.title = 'Enter layout edit — tap again (play) to run and save';
            shellLockBtn.setAttribute('aria-label', 'Enter layout edit mode');
            shellLockBtn.classList.remove('is-active');
        }
    }

    // Only fetch JSON and set window._networkSettingsData if not already set (preserve user changes)
    let data;
    // Check if we already have the data loaded for this specific screen
    if (!window._currentScreenData || window._lastLoadedJsonPath !== jsonPath) {
        const applyFetched = (parsed) => {
            data = parsed;
            window._currentScreenData = data;
            window._lastLoadedJsonPath = jsonPath;
        };
        const loadFromCache = () => {
            const cached = loadScreenFromCache(jsonPath);
            if (cached) {
                applyFetched(cached);
                return true;
            }
            return false;
        };
        const loadFromNetwork = async () => {
            const resp = await fetch(jsonPath + '?_=' + Date.now());
            applyFetched(await resp.json());
        };

        // Prefer browser draft (localStorage) whenever present so Inspector edits (bg, theme, workbench offsets)
        // survive reload, exiting layout edit, and navigation — same as layout edit. Fetch only when no cache.
        if (!loadFromCache()) {
            try {
                await loadFromNetwork();
            } catch (e) {
                if (loadFromCache()) {
                    console.warn(`[Simulator] Fetch failed, loaded ${jsonPath} from local cache.`);
                } else {
                    lcd.innerHTML = `<div style="color:red; padding: 20px;">Failed to load ${jsonPath}</div>`;
                    console.error(e);
                    return;
                }
            }
        }
    }
    data = window._currentScreenData;
    ensureCanonicalSchema(data);
    enforceSimulatorFixedLcdCanvas(data);
    ensureProvisioningSetupHasRssi(data);
    ensureMainDisplayIconLayout(data);
    // LCD nudge is global (`tstat10_lcd_bezel_nudge_px` in ui-bridge); never re-read per-screen JSON/cache
    // on navigation — that used to jump the framebuffer between routes.
    // Persist working copy continuously so refresh does not drop recent edits.
    syncWorkbenchNudgeIntoScreenDataForCache(data);
    saveScreenToCache(jsonPath, data);
    ensureIpv4AlignedStyles();
    syncSlStudioWorkbenchChrome(jsonPath, data);
    renderLayoutTreePanel(data, jsonPath, renderScreen);
    renderLayoutPropertiesPanel(data, jsonPath, renderScreen);
    const gridCols = data.layout?.lcdTextColumns || 16;
    const gridRows = data.layout?.lcdTextRows || 10;
    const canvasWidthPx = canvasLogicalWidthPx(data);
    const canvasHeightPx = canvasLogicalHeightPx(data);
    const gridCellW = canvasWidthPx / gridCols;
    const gridCellH = canvasHeightPx / gridRows;
    const quarterCharStep = gridCellW / 4;

    function snapToGrid(valuePx, stepPx) {
        return Math.round(valuePx / stepPx) * stepPx;
    }
    /** Keep keypad/Next focus in sync with the row you select in the tree or on the LCD (fixes highlight/row vanishing when editing). */
    function syncMenuFocusFromLayoutNodeId(nodeId, screenData) {
        if (!nodeId || !screenData || !Array.isArray(screenData.widgets)) return;
        const m = String(nodeId).match(/^w-(\d+)/);
        if (!m) return;
        const widgetIdx = Number(m[1]);
        if (Number.isNaN(widgetIdx) || widgetIdx < 0 || widgetIdx >= screenData.widgets.length) return;
        const w = screenData.widgets[widgetIdx];
        if (!w || w.type !== 'menu_row') return;
        const menuRows = screenData.widgets
            .filter((x) => x && x.type === 'menu_row')
            .sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
        const fi = menuRows.findIndex((r) => r === w || (r.id && w.id && r.id === w.id));
        if (fi >= 0) window._currentScreenFocus = fi;
    }
    function selectLayoutNode(nodeId) {
        const prev = window._layoutSelectedNodeId;
        window._layoutSelectedNodeId = nodeId;
        syncMenuFocusFromLayoutNodeId(nodeId, window._currentScreenData || data);
        if (prev === nodeId) {
            applySelectionOutline();
            return;
        }
        cancelDebouncedSelectLayoutRender();
        applySelectionOutline();
        // Keep hierarchy + inspector in lockstep with canvas/shell selection immediately (AGENTS.md item 4).
        // Debounced renderScreen only rebuilds LCD DOM; authors should not wait ~320ms for tree highlight / inspector.
        const syncData = window._currentScreenData || data;
        const syncPath = window._currentJsonPath || jsonPath;
        if (syncData) {
            renderLayoutTreePanel(syncData, syncPath, renderScreen);
            renderLayoutPropertiesPanel(syncData, syncPath, renderScreen);
        }
        window._layoutSelectRenderDebounceTimer = setTimeout(() => {
            window._layoutSelectRenderDebounceTimer = null;
            renderScreen(jsonPath);
        }, 320);
    }
    window._selectLayoutNode = selectLayoutNode;
    const pushUndoSnapshot = () => {
        if (!window._layoutUndoStack) window._layoutUndoStack = [];
        window._layoutUndoStack.push({
            jsonPath,
            data: JSON.parse(JSON.stringify(window._currentScreenData || data || {})),
            selectedId: window._layoutSelectedNodeId || null
        });
        if (window._layoutUndoStack.length > 60) window._layoutUndoStack.shift();
    };
    const undoLayoutChange = () => {
        const stack = window._layoutUndoStack || [];
        if (!stack.length) return false;
        const snap = stack.pop();
        if (!snap || !snap.data) return false;
        window._currentScreenData = snap.data;
        window._lastLoadedJsonPath = snap.jsonPath || jsonPath;
        window._layoutSelectedNodeId = snap.selectedId || null;
        renderScreen(window._lastLoadedJsonPath);
        return true;
    };
    const deleteSelectedLayoutNode = () => {
        const selectedId = String(window._layoutSelectedNodeId || '');
        if (!selectedId.startsWith('w-')) return false;
        const m = selectedId.match(/^w-(\d+)/);
        if (!m) return false;
        const idx = Number(m[1]);
        const widgets = Array.isArray(window._currentScreenData?.widgets) ? window._currentScreenData.widgets : null;
        if (!widgets || Number.isNaN(idx) || idx < 0 || idx >= widgets.length) return false;
        pushUndoSnapshot();
        widgets.splice(idx, 1);
        window._layoutSelectedNodeId = null;
        renderScreen(jsonPath);
        return true;
    };
    const duplicateSelectedLayoutNode = () => {
        const selectedId = String(window._layoutSelectedNodeId || '');
        if (!selectedId.startsWith('w-')) return false;
        const m = selectedId.match(/^w-(\d+)/);
        if (!m) return false;
        const idx = Number(m[1]);
        const widgets = Array.isArray(window._currentScreenData?.widgets) ? window._currentScreenData.widgets : null;
        if (!widgets || Number.isNaN(idx) || idx < 0 || idx >= widgets.length) return false;
        const src = widgets[idx];
        pushUndoSnapshot();
        const copy = JSON.parse(JSON.stringify(src));
        if (copy && typeof copy.id === 'string' && copy.id.length) {
            let candidate = `${copy.id}_copy`;
            let seq = 2;
            const existing = new Set(widgets.map((w) => String(w?.id || '')));
            while (existing.has(candidate)) {
                candidate = `${copy.id}_copy${seq}`;
                seq += 1;
            }
            copy.id = candidate;
        }
        widgets.splice(idx + 1, 0, copy);
        window._layoutSelectedNodeId = `w-${idx + 1}`;
        renderScreen(jsonPath);
        return true;
    };
    window._undoLayoutChange = undoLayoutChange;
    window._deleteSelectedLayoutNode = deleteSelectedLayoutNode;
    window._duplicateSelectedLayoutNode = duplicateSelectedLayoutNode;

    function installLcdSelectionSync() {
        if (!lcd || lcd._selectionSyncBound) return;
        lcd._selectionSyncBound = true;
        lcd.addEventListener('mousedown', (evt) => {
            if (!window._isVisualEditMode) return;
            const target = evt.target;
            if (!target || !target.closest) return;
            const nodeEl = target.closest('[data-tree-node-id]');
            const nodeId = nodeEl?.dataset?.treeNodeId;
            if (!nodeId) return;
            if (window._layoutSelectedNodeId !== nodeId) {
                selectLayoutNode(nodeId);
            }
        }, true);
    }
    installLcdSelectionSync();
    function installTstatShellSelectionSync() {
        const host = document.getElementById('tstat-container');
        if (!host || host._tstatShellSelectionSyncBound) return;
        host._tstatShellSelectionSyncBound = true;
        host.addEventListener(
            'mousedown',
            (evt) => {
                if (!window._isVisualEditMode) return;
                const t = evt.target;
                if (!t || !t.closest) return;
                const nodeEl = t.closest('[data-tree-node-id]');
                if (!nodeEl || !host.contains(nodeEl)) return;
                if (lcd.contains(nodeEl)) return;
                const nid = nodeEl.dataset?.treeNodeId;
                if (!nid || !nid.startsWith('shell-')) return;
                if (window._layoutSelectedNodeId !== nid) {
                    selectLayoutNode(nid);
                }
            },
            true
        );
    }
    installTstatShellSelectionSync();
    const ensureEditHint = () => {
        const hint = document.getElementById('layout-edit-hint');
        if (!window._isVisualEditMode) {
            if (hint) hint.remove();
            return;
        }
        if (hint) hint.remove();
    };
    ensureEditHint();

    function enableInlineTextEdit(el, initialGetter, commitFn) {
        if (!el || el._inlineEditBound) return;
        el._inlineEditBound = true;
        el.contentEditable = 'false';
        const startEditing = () => {
            if (el._inlineEditing) return;
            cancelDebouncedSelectLayoutRender();
            el._inlineEditing = true;
            el.contentEditable = 'true';
            el.style.cursor = 'text';
            if (typeof initialGetter === 'function') {
                const txt = initialGetter();
                if (typeof txt === 'string' && txt.length) el.innerText = txt;
            }
            el.focus();
            document.getSelection()?.selectAllChildren(el);
        };
        const stopEditing = (commit) => {
            if (!el._inlineEditing) return;
            el._inlineEditing = false;
            el.contentEditable = 'false';
            el.style.cursor = 'grab';
            if (commit && typeof commitFn === 'function') commitFn(el.innerText);
        };
        el._startInlineEdit = startEditing;
        el.addEventListener('dblclick', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            startEditing();
        });
        el.addEventListener('keydown', (evt) => {
            if (!el._inlineEditing) return;
            if (evt.key === 'Enter') {
                evt.preventDefault();
                stopEditing(true);
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                stopEditing(false);
            }
        });
        el.addEventListener('blur', () => stopEditing(true));
    }

    function attachWidthDragResize(el, widgetRef, widthKey, defaultWidth, options = {}) {
        const EDGE_HIT_PX = 12;
        let resizing = false;
        let startX = 0;
        let startWidth = 0;
        let startSide = 'right';
        let startOffset = 0;
        let startAnchorX = 0;
        let startAlign = 'left';
        if (!el || !widgetRef) return;
        const computedPos = window.getComputedStyle(el).position;
        if (!computedPos || computedPos === 'static') el.style.position = 'relative';
        // Ensure the resize handle remains clickable at the edge.
        el.style.overflow = 'visible';

        const xKey = options.xKey || null;
        const alignKey = options.alignKey || null;
        const defaultAlign = options.defaultAlign || 'left';
        const offsetKey = options.offsetKey || null;
        const edgeBehavior = options.edgeBehavior || 'default';
        const nodeId = options.nodeId || null;
        const selectedOnly = options.selectedOnly !== false;

        const resolveAlign = () => (alignKey ? (widgetRef[alignKey] || defaultAlign) : defaultAlign);
        const widthForCalc = () => Number(widgetRef[widthKey] || defaultWidth || Math.max(40, el.offsetWidth || 80));
        const anchorXForCalc = () => Number(widgetRef[xKey] || 0);
        const offsetForCalc = () => Number(widgetRef[offsetKey] || 0);

        const previewApply = (side, dx) => {
            const baseWidth = startWidth;
            let newWidth = baseWidth;
            if (side === 'left') newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth - dx, quarterCharStep));
            else newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth + dx, quarterCharStep));
            el.style.width = `${newWidth}px`;
            if (xKey) {
                const oldW = Math.max(quarterCharStep, baseWidth);
                const align = startAlign;
                const centerX = startAnchorX;
                const leftBefore = align === 'center' ? (centerX - oldW / 2) : (align === 'right' ? (centerX - oldW) : centerX);
                const rightBefore = leftBefore + oldW;
                const leftAfter = side === 'left' ? (rightBefore - newWidth) : leftBefore;
                const xPreview = align === 'center' ? (leftAfter + (newWidth / 2)) : (align === 'right' ? (leftAfter + newWidth) : leftAfter);
                el.style.left = `${xPreview}px`;
            }
            if (offsetKey && (side === 'left' || edgeBehavior === 'flexAutoRight')) {
                const deltaForOffset = edgeBehavior === 'flexAutoRight'
                    ? (side === 'right' ? (newWidth - baseWidth) : 0)
                    : dx;
                const newOffset = snapToGrid(startOffset + deltaForOffset, quarterCharStep);
                el.style.transform = `translate(${newOffset}px, ${Number(widgetRef[offsetKey.replace('X', 'Y')] || 0)}px)`;
            }
        };

        /** Visible handles + edge resize cursor/drag only when this node is the selected tree item (not just same row). */
        const widthHandleTargetStrictFocus = () =>
            !selectedOnly || !nodeId || window._layoutSelectedNodeId === nodeId;

        const commitApply = (side, dx) => {
            const baseWidth = startWidth;
            let newWidth = baseWidth;
            if (side === 'left') newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth - dx, quarterCharStep));
            else newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth + dx, quarterCharStep));
            widgetRef[widthKey] = newWidth;

            // Floating labels: keep the opposite edge anchored to avoid centroid drift.
            if (xKey) {
                const oldW = Math.max(quarterCharStep, baseWidth);
                const align = startAlign;
                const centerX = startAnchorX;
                const leftBefore = align === 'center' ? (centerX - oldW / 2) : (align === 'right' ? (centerX - oldW) : centerX);
                const rightBefore = leftBefore + oldW;
                const leftAfter = side === 'left' ? (rightBefore - newWidth) : leftBefore;
                if (align === 'center') widgetRef[xKey] = leftAfter + (newWidth / 2);
                else if (align === 'right') widgetRef[xKey] = leftAfter + newWidth;
                else widgetRef[xKey] = leftAfter;
            }

            // Inline row boxes: left edge drag updates offset independently.
            if (offsetKey && (side === 'left' || edgeBehavior === 'flexAutoRight')) {
                const deltaForOffset = edgeBehavior === 'flexAutoRight'
                    ? (side === 'right' ? (newWidth - baseWidth) : 0)
                    : dx;
                widgetRef[offsetKey] = snapToGrid(startOffset + deltaForOffset, quarterCharStep);
            }
        };

        el.addEventListener('mousemove', (evt) => {
            if (!widthHandleTargetStrictFocus()) {
                el.style.cursor = '';
                return;
            }
            const rect = el.getBoundingClientRect();
            const nearLeftEdge = evt.clientX <= rect.left + EDGE_HIT_PX;
            const nearRightEdge = evt.clientX >= rect.right - EDGE_HIT_PX;
            el.style.cursor = (nearLeftEdge || nearRightEdge) ? 'ew-resize' : 'grab';
        });

        el.addEventListener('mousedown', (evt) => {
            if (selectedOnly && nodeId && !layoutTreeSelectionMatchesNode(window._layoutSelectedNodeId, nodeId)) {
                selectLayoutNode(nodeId);
                return;
            }
            const rect = el.getBoundingClientRect();
            const nearLeftEdge = evt.clientX <= rect.left + EDGE_HIT_PX;
            const nearRightEdge = evt.clientX >= rect.right - EDGE_HIT_PX;
            if (!nearLeftEdge && !nearRightEdge) return;
            if (!widthHandleTargetStrictFocus()) return;
            evt.preventDefault();
            evt.stopPropagation();
            resizing = true;
            startSide = nearLeftEdge ? 'left' : 'right';
            startX = evt.clientX;
            startWidth = widthForCalc();
            startOffset = offsetForCalc();
            startAnchorX = anchorXForCalc();
            startAlign = resolveAlign();
            document.body.style.userSelect = 'none';

            const onMove = (moveEvt) => {
                if (!resizing) return;
                const delta = moveEvt.clientX - startX;
                previewApply(startSide, delta);
            };
            const onUp = (upEvt) => {
                if (!resizing) return;
                resizing = false;
                const delta = upEvt.clientX - startX;
                commitApply(startSide, delta);
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                renderScreen(jsonPath);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        if (!widthHandleTargetStrictFocus()) return;

        // Add a visible right drag handle.
        if (!el.querySelector('.tstat-width-handle')) {
            const handle = document.createElement('span');
            handle.className = 'tstat-width-handle';
            handle.style.position = 'absolute';
            handle.style.right = '-2px';
            handle.style.top = '50%';
            handle.style.transform = 'translateY(-50%)';
            handle.style.width = '10px';
            handle.style.height = '20px';
            handle.style.borderRadius = '3px';
            handle.style.background = 'rgba(245, 158, 11, 0.85)';
            handle.style.cursor = 'ew-resize';
            handle.style.zIndex = '4';
            handle.style.pointerEvents = 'auto';
            el.appendChild(handle);
            handle.addEventListener('mousedown', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (!widthHandleTargetStrictFocus()) return;
                resizing = true;
                startSide = 'right';
                startX = evt.clientX;
                startWidth = widthForCalc();
                startOffset = offsetForCalc();
                startAnchorX = anchorXForCalc();
                startAlign = resolveAlign();
                document.body.style.userSelect = 'none';
                const onMove = (moveEvt) => {
                    if (!resizing) return;
                    const delta = moveEvt.clientX - startX;
                    previewApply('right', delta);
                };
                const onUp = (upEvt) => {
                    if (!resizing) return;
                    resizing = false;
                    const delta = upEvt.clientX - startX;
                    commitApply('right', delta);
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    renderScreen(jsonPath);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
        // Add a visible left drag handle.
        if (!el.querySelector('.tstat-width-handle-left')) {
            const handleL = document.createElement('span');
            handleL.className = 'tstat-width-handle-left';
            handleL.style.position = 'absolute';
            handleL.style.left = '-2px';
            handleL.style.top = '50%';
            handleL.style.transform = 'translateY(-50%)';
            handleL.style.width = '10px';
            handleL.style.height = '20px';
            handleL.style.borderRadius = '3px';
            handleL.style.background = 'rgba(56, 189, 248, 0.9)';
            handleL.style.cursor = 'ew-resize';
            handleL.style.zIndex = '4';
            handleL.style.pointerEvents = 'auto';
            el.appendChild(handleL);
            handleL.addEventListener('mousedown', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (!widthHandleTargetStrictFocus()) return;
                resizing = true;
                startSide = 'left';
                startX = evt.clientX;
                startWidth = widthForCalc();
                startOffset = offsetForCalc();
                startAnchorX = anchorXForCalc();
                startAlign = resolveAlign();
                document.body.style.userSelect = 'none';
                const onMove = (moveEvt) => {
                    if (!resizing) return;
                    const delta = moveEvt.clientX - startX;
                    previewApply('left', delta);
                };
                const onUp = (upEvt) => {
                    if (!resizing) return;
                    resizing = false;
                    const delta = upEvt.clientX - startX;
                    commitApply('left', delta);
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    renderScreen(jsonPath);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }

    function attachOffsetDrag(el, widgetRef, xKey, yKey) {
        const nodeId = el?.dataset?.treeNodeId || null;
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let baseX = 0;
        let baseY = 0;
        el.addEventListener('mousedown', (evt) => {
            if (evt.target && evt.target.classList && (evt.target.classList.contains('tstat-width-handle') || evt.target.classList.contains('tstat-width-handle-left'))) return;
            if (nodeId && !layoutTreeSelectionMatchesNode(window._layoutSelectedNodeId, nodeId)) {
                selectLayoutNode(nodeId);
                return;
            }
            evt.preventDefault();
            evt.stopPropagation();
            dragging = true;
            startX = evt.clientX;
            startY = evt.clientY;
            baseX = Number(widgetRef[xKey] || 0);
            baseY = Number(widgetRef[yKey] || 0);
            document.body.style.userSelect = 'none';
            const onMove = (mv) => {
                if (!dragging) return;
                const dx = snapToGrid(mv.clientX - startX, quarterCharStep);
                const dy = snapToGrid(mv.clientY - startY, quarterCharStep);
                el.style.transform = `translate(${baseX + dx}px, ${baseY + dy}px)`;
            };
            const onUp = (up) => {
                if (!dragging) return;
                dragging = false;
                const dx = snapToGrid(up.clientX - startX, quarterCharStep);
                const dy = snapToGrid(up.clientY - startY, quarterCharStep);
                widgetRef[xKey] = baseX + dx;
                widgetRef[yKey] = baseY + dy;
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                renderScreen(jsonPath);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    const bindEditorControls = () => {
        if (window._lcdEditorPanelBound) return;
        window._lcdEditorPanelBound = true;

        const canvasSizeReadout = document.getElementById('editor-canvas-size-readout');
        const orientationInput = document.getElementById('editor-orientation');
        const colorModeInput = document.getElementById('editor-color-mode');
        const bgInput = document.getElementById('editor-screen-bg');
        const bgPicker = document.getElementById('editor-screen-bg-picker');
        const bgPalette = document.getElementById('editor-screen-bg-palette');
        const presetSelect = document.getElementById('editor-lcd-preset');
        const presetHint = document.getElementById('editor-lcd-preset-hint');
        const canvasSizeHint = document.getElementById('editor-canvas-size-hint');
        const gridColsInput = document.getElementById('editor-grid-cols');
        const gridRowsInput = document.getElementById('editor-grid-rows');
        const firmwareThemeSelect = document.getElementById('editor-lcd-firmware-theme');
        if (!canvasSizeReadout || !orientationInput || !colorModeInput || !presetSelect) return;

        if (presetSelect && presetSelect.options.length === 0) {
            for (const p of LCD_PLATFORM_PRESETS) {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.label;
                presetSelect.appendChild(opt);
            }
        }

        if (firmwareThemeSelect && firmwareThemeSelect.options.length <= 1) {
            for (const t of FIRMWARE_LCD_COLOR_THEME_LIST) {
                const opt = document.createElement('option');
                opt.value = t.id;
                opt.textContent = t.label;
                firmwareThemeSelect.appendChild(opt);
            }
        }

        const syncFirmwareThemeSelect = () => {
            const d = window._currentScreenData;
            if (!firmwareThemeSelect || !d) return;
            firmwareThemeSelect.value = findMatchingFirmwareThemeId(d);
        };

        const setPresetHint = (preset) => {
            if (!presetHint) return;
            const note = preset?.paletteNote || '';
            presetHint.textContent = note;
            presetHint.hidden = !note;
        };

        const syncBgPickerFromText = () => {
            if (!bgPicker || !bgInput) return;
            const mode = colorModeInput.value || 'indexed';
            if (mode === 'indexed') {
                bgPicker.hidden = true;
                return;
            }
            bgPicker.hidden = false;
            const q =
                quantizeCssColorToRgb565Hex(bgInput.value) ||
                quantizeCssColorToRgb565Hex(TSTAT10_FW_BG_CSS);
            if (q) bgPicker.value = q;
        };

        const updateBgSwatchActiveState = () => {
            if (!bgPalette || !bgInput) return;
            const mode = colorModeInput.value || 'indexed';
            const raw = (bgInput.value || '').trim();
            let cur = null;
            if (!raw) {
                cur = clampBackgroundToColorMode(TSTAT10_FW_BG_CSS, mode);
            } else if (mode === 'indexed') {
                cur = clampBackgroundToColorMode(raw, 'indexed');
            } else {
                const q = quantizeCssColorToRgb565Hex(raw);
                cur = q !== null ? q : null;
            }
            const curL = cur ? cur.toLowerCase() : '';
            for (const el of bgPalette.querySelectorAll('.layout-props-screen-section__bg-swatch')) {
                const target = (el.dataset.bgCss || '').toLowerCase();
                const match = curL !== '' && target === curL;
                el.classList.toggle('is-active', match);
                el.setAttribute('aria-pressed', match ? 'true' : 'false');
            }
        };

        const rebuildEditorBgPalette = () => {
            if (!bgPalette) return;
            const mode = colorModeInput.value || 'indexed';
            bgPalette.replaceChildren();
            if (mode === 'indexed') {
                for (const s of INDEXED_BACKGROUND_SWATCHES) {
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'layout-props-screen-section__bg-swatch';
                    b.title = s.label;
                    b.setAttribute('aria-label', s.label);
                    b.dataset.bgCss = s.css;
                    b.style.backgroundColor = s.css;
                    b.addEventListener('click', () => {
                        if (bgInput) bgInput.value = s.css;
                        syncBgPickerFromText();
                        onFieldChange();
                        commitProjectWideBackgroundIfPossible();
                        updateBgSwatchActiveState();
                    });
                    bgPalette.appendChild(b);
                }
            } else {
                for (const t of LCD_THEME_RGB565_SWATCHES) {
                    const css = rgb565ToCssHex(t.word);
                    const b = document.createElement('button');
                    b.type = 'button';
                    b.className = 'layout-props-screen-section__bg-swatch';
                    b.title = `${t.label} — 0x${t.word.toString(16)}`;
                    b.setAttribute('aria-label', t.label);
                    b.dataset.bgCss = css;
                    b.style.backgroundColor = css;
                    b.addEventListener('click', () => {
                        if (bgInput) bgInput.value = css;
                        syncBgPickerFromText();
                        onFieldChange();
                        commitProjectWideBackgroundIfPossible();
                        updateBgSwatchActiveState();
                    });
                    bgPalette.appendChild(b);
                }
            }
            if (bgPicker) bgPicker.hidden = mode === 'indexed';
            syncBgPickerFromText();
            updateBgSwatchActiveState();
        };

        const syncCanvasSizeReadout = () => {
            if (!canvasSizeReadout) return;
            const d = window._currentScreenData;
            if (!d?.canvasProfile) {
                canvasSizeReadout.textContent = '—';
                return;
            }
            const w = Number(d.canvasProfile.width);
            const h = Number(d.canvasProfile.height);
            if (!w || !h) {
                canvasSizeReadout.textContent = '—';
                return;
            }
            canvasSizeReadout.textContent = `${w} × ${h}`;
        };

        const syncCanvasSizeHint = () => {
            if (!canvasSizeHint) return;
            const d = window._currentScreenData;
            const preset = d ? resolveLcdPresetSelection(d.canvasProfile || {}) : null;
            const isCustom = preset?.id === 'custom';
            if (isCustom) {
                canvasSizeHint.hidden = false;
                canvasSizeHint.textContent =
                    'Custom LCD size comes from this screen JSON; change preset or orientation above, or edit JSON for explicit width/height.';
            } else {
                canvasSizeHint.hidden = true;
                canvasSizeHint.textContent = '';
            }
        };

        const updateInputsFromData = () => {
            if (!window._currentScreenData) return;
            const d = window._currentScreenData;
            const cw = Number(d.canvasProfile?.width || DEFAULT_LCD_W);
            const ch = Number(d.canvasProfile?.height || DEFAULT_LCD_H);
            const resolved = resolveLcdPresetSelection(d.canvasProfile || {});
            if (presetSelect) {
                presetSelect.value = resolved.id;
                setPresetHint(resolved);
            }
            const inferred = inferOrientationFromPresetAndCanvas(resolved, cw, ch);
            const storedOrient =
                d.canvasProfile?.orientation === 'horizontal' || d.canvasProfile?.orientation === 'vertical'
                    ? d.canvasProfile.orientation
                    : null;
            const squarePreset =
                resolved.id !== 'custom' &&
                resolved.width != null &&
                resolved.height != null &&
                resolved.width === resolved.height;
            const orientationValue =
                squarePreset && storedOrient
                    ? storedOrient
                    : inferred != null
                      ? inferred
                      : storedOrient || 'vertical';
            orientationInput.value = orientationValue;
            syncCanvasSizeReadout();
            syncCanvasSizeHint();
            colorModeInput.value = d.colorProfile?.mode || 'indexed';
            if (bgInput) bgInput.value = d.styles?.bg || TSTAT10_FW_BG_CSS;
            syncBgPickerFromText();
            if (gridColsInput) {
                gridColsInput.value = String(
                    clampGridDimensionInput(
                        d.layout?.lcdTextColumns,
                        LCD_GRID_COLS_MIN,
                        LCD_GRID_COLS_MAX,
                        16
                    )
                );
            }
            if (gridRowsInput) {
                gridRowsInput.value = String(
                    clampGridDimensionInput(
                        d.layout?.lcdTextRows,
                        LCD_GRID_ROWS_MIN,
                        LCD_GRID_ROWS_MAX,
                        10
                    )
                );
            }
            rebuildEditorBgPalette();
            syncFirmwareThemeSelect();
        };

        const applyCanvasFromInputs = () => {
            const d = window._currentScreenData;
            if (!d) return;
            if (!d.canvasProfile) d.canvasProfile = {};
            if (!d.colorProfile) d.colorProfile = {};
            if (presetSelect && presetSelect.value) {
                d.canvasProfile.lcdPresetId = presetSelect.value;
            }
            const preset = getLcdPresetById(d.canvasProfile.lcdPresetId || 'custom');
            const orient = orientationInput.value || 'vertical';
            d.canvasProfile.orientation = orient;
            if (preset.id !== 'custom') {
                const dim = canvasPixelSizeForPresetOrientation(preset, orient);
                if (dim) {
                    d.canvasProfile.width = dim.width;
                    d.canvasProfile.height = dim.height;
                }
            } else {
                const a = Math.max(1, Number(d.canvasProfile.width || DEFAULT_LCD_W));
                const b = Math.max(1, Number(d.canvasProfile.height || DEFAULT_LCD_H));
                const min = Math.min(a, b);
                const max = Math.max(a, b);
                const portrait = orient !== 'horizontal';
                if (portrait) {
                    d.canvasProfile.width = min;
                    d.canvasProfile.height = max;
                } else {
                    d.canvasProfile.width = max;
                    d.canvasProfile.height = min;
                }
            }
            d.colorProfile.mode = colorModeInput.value || 'indexed';
            if (!d.layout) d.layout = {};
            if (gridColsInput) {
                d.layout.lcdTextColumns = clampGridDimensionInput(
                    gridColsInput.value,
                    LCD_GRID_COLS_MIN,
                    LCD_GRID_COLS_MAX,
                    16
                );
                gridColsInput.value = String(d.layout.lcdTextColumns);
            }
            if (gridRowsInput) {
                d.layout.lcdTextRows = clampGridDimensionInput(
                    gridRowsInput.value,
                    LCD_GRID_ROWS_MIN,
                    LCD_GRID_ROWS_MAX,
                    10
                );
                gridRowsInput.value = String(d.layout.lcdTextRows);
            }
            if (bgInput) {
                if (!d.styles) d.styles = {};
                d.styles.bg = (bgInput.value || '').trim() || TSTAT10_FW_BG_CSS;
                mergeProjectBackgroundIntoScreenData(d, d.styles.bg);
            }
            const resolved = resolveLcdPresetSelection(d.canvasProfile);
            d.canvasProfile.lcdPresetId = resolved.id;
            if (presetSelect) {
                presetSelect.value = resolved.id;
                setPresetHint(resolved);
            }
            ensureCanonicalSchema(d);
            syncFirmwareThemeSelect();
            syncCanvasSizeReadout();
            syncCanvasSizeHint();
            writeStatus(
                'Screen canvas updated. Use “Apply layout” if widget positions should scale to the new size.'
            );
            renderScreen(window._currentJsonPath || jsonPath);
        };

        const commitProjectWideBackgroundIfPossible = () => {
            const d = window._currentScreenData;
            const p = window._currentJsonPath || jsonPath;
            if (!d?.styles?.bg || !p) return;
            const hl = String(d.styles?.highlight || '').trim();
            const mode = d.colorProfile?.mode;
            if (hl && (mode === 'indexed' || mode === 'reduced_rgb')) {
                propagateProjectWideFirmwareTheme(d.styles.bg, hl, p, mode);
                writeStatus(
                    'Theme (background + highlight) applied project-wide (cached screens updated; others load from disk in background).',
                    false
                );
            } else {
                propagateProjectWideBackground(d.styles.bg, p);
                writeStatus(
                    'Background applied project-wide (all screen JSON in browser cache; uncached pages load from disk in background).',
                    false
                );
            }
        };

        const onFieldChange = () => applyCanvasFromInputs();
        orientationInput.addEventListener('change', onFieldChange);
        colorModeInput.addEventListener('change', () => {
            onFieldChange();
            rebuildEditorBgPalette();
        });
        if (gridColsInput) gridColsInput.addEventListener('change', onFieldChange);
        if (gridRowsInput) gridRowsInput.addEventListener('change', onFieldChange);
        if (bgInput) {
            bgInput.addEventListener('change', () => {
                syncBgPickerFromText();
                onFieldChange();
                commitProjectWideBackgroundIfPossible();
                updateBgSwatchActiveState();
            });
            bgInput.addEventListener('input', () => {
                syncBgPickerFromText();
                onFieldChange();
                updateBgSwatchActiveState();
            });
        }
        if (bgPicker) {
            bgPicker.addEventListener('input', () => {
                const q = quantizeCssColorToRgb565Hex(bgPicker.value);
                if (bgInput && q) bgInput.value = q;
                onFieldChange();
                updateBgSwatchActiveState();
            });
            bgPicker.addEventListener('change', () => {
                syncBgPickerFromText();
                onFieldChange();
                commitProjectWideBackgroundIfPossible();
                updateBgSwatchActiveState();
            });
        }

        if (presetSelect) {
            presetSelect.addEventListener('change', () => {
                const d = window._currentScreenData;
                if (!d) return;
                const p = getLcdPresetById(presetSelect.value);
                if (!d.canvasProfile) d.canvasProfile = {};
                d.canvasProfile.lcdPresetId = p.id;
                if (p.id !== 'custom' && p.width != null && p.height != null) {
                    const orient = orientationInput.value || 'vertical';
                    const dim = canvasPixelSizeForPresetOrientation(p, orient);
                    if (dim) {
                        d.canvasProfile.width = dim.width;
                        d.canvasProfile.height = dim.height;
                        d.canvasProfile.orientation = orient;
                    }
                }
                if (p.colorMode && colorModeInput) {
                    colorModeInput.value = p.colorMode;
                    d.colorProfile = d.colorProfile || {};
                    d.colorProfile.mode = p.colorMode;
                }
                if (p.driver && String(p.driver).trim()) {
                    d.compatibility = d.compatibility || {};
                    d.compatibility.lcdDriver = String(p.driver).trim();
                }
                setPresetHint(p);
                ensureCanonicalSchema(d);
                syncCanvasSizeReadout();
                syncCanvasSizeHint();
                writeStatus(
                    p.id === 'custom'
                        ? 'LCD: custom — pixel size stays from this screen JSON; use Apply layout if you edit JSON elsewhere.'
                        : `LCD preview: ${d.canvasProfile.width}×${d.canvasProfile.height}${p.driver ? ` (${p.driver})` : ''}. Use “Apply layout” to rescale widgets.`
                );
                renderScreen(window._currentJsonPath || jsonPath);
                rebuildEditorBgPalette();
            });
        }

        if (firmwareThemeSelect) {
            firmwareThemeSelect.addEventListener('change', () => {
                const v = firmwareThemeSelect.value;
                if (v === FIRMWARE_LCD_THEME_CUSTOM_ID) return;
                const d = window._currentScreenData;
                const p = window._currentJsonPath || jsonPath;
                if (!d || !p) return;
                if (!applyFirmwareColorThemeToScreenData(d, v)) return;
                try {
                    syncWorkbenchNudgeIntoScreenDataForCache(d);
                    saveScreenToCache(p, d);
                } catch {
                    /* ignore */
                }
                propagateProjectWideFirmwareTheme(
                    d.styles.bg,
                    d.styles.highlight,
                    p,
                    d.colorProfile?.mode || 'reduced_rgb'
                );
                ensureCanonicalSchema(d);
                if (colorModeInput) colorModeInput.value = d.colorProfile?.mode || 'reduced_rgb';
                if (bgInput) bgInput.value = d.styles?.bg || TSTAT10_FW_BG_CSS;
                syncBgPickerFromText();
                rebuildEditorBgPalette();
                updateBgSwatchActiveState();
                syncFirmwareThemeSelect();
                writeStatus(
                    'Firmware color theme applied to all cached screen JSON (background + row highlight; color mode → reduced_rgb).',
                    false
                );
                renderScreen(p);
            });
        }

        const applyRemapBtn = document.getElementById('editor-apply-layout-remap');
        if (applyRemapBtn && !applyRemapBtn.dataset.bound) {
            applyRemapBtn.dataset.bound = '1';
            applyRemapBtn.addEventListener('click', () => {
                const d = window._currentScreenData;
                if (!d) return;
                const r = applyLayoutRemapToMatchCanvas(d);
                writeStatus(r.message, !r.ok);
                if (r.ok) renderScreen(window._currentJsonPath || jsonPath);
            });
        }

        window._syncLcdEditorInputs = updateInputsFromData;
        updateInputsFromData();
    };

    bindEditorControls();
    if (typeof window._syncLcdEditorInputs === 'function') {
        window._syncLcdEditorInputs();
    }

    lcd.style.background = resolvedScreenBackgroundCss(data);
    lcd.style.color = '#fff';
    /* Keep CSS bezel slot (`simulator.css`: absolute + top); `relative` broke LCD placement in the mock shell. */
    lcd.style.removeProperty('position');
    lcd.style.fontFamily = data.styles?.fontFamily || 'Segoe UI, Arial, sans-serif';
    lcd.style.padding = '0';
    const lcdCanvasWidth =
        Number(data.canvasProfile?.width ||
            data.layout?.lcdCanvas?.width ||
            data.layout?.canvas?.width ||
            DEFAULT_LCD_W) || DEFAULT_LCD_W;
    const lcdCanvasHeight =
        Number(data.canvasProfile?.height ||
            data.layout?.lcdCanvas?.height ||
            data.layout?.canvas?.height ||
            DEFAULT_LCD_H) || DEFAULT_LCD_H;
    lcd.style.width = lcdCanvasWidth + 'px';
    lcd.style.height = lcdCanvasHeight + 'px';
    if (data.page === 'MAIN_DISPLAY') {
        lcd.style.overflow = 'hidden';
    } else {
        lcd.style.removeProperty('overflow');
    }
    if (typeof window._applyTstatLcdNudgeTransform === 'function') {
        window._applyTstatLcdNudgeTransform();
    }

    // Helper to show the alignment context menu during Visual Edit Mode
    const showAlignmentMenu = (e, widget, alignKey) => {
        e.preventDefault();
        let existingMenu = document.getElementById('visual-edit-context-menu');
        if (existingMenu) existingMenu.remove();
        
        const menu = document.createElement('div');
        menu.id = 'visual-edit-context-menu';
        menu.style.position = 'fixed';
        menu.style.left = e.pageX + 'px';
        menu.style.top = e.pageY + 'px';
        menu.style.background = '#fff';
        menu.style.color = '#000';
        menu.style.border = '1px solid #ccc';
        menu.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
        menu.style.zIndex = '10006';
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';
        menu.style.padding = '5px';
        
        ['left', 'center', 'right'].forEach(align => {
            const btn = document.createElement('button');
            btn.textContent = 'Align ' + align;
            btn.style.margin = '2px';
            btn.style.cursor = 'pointer';
            btn.onclick = () => {
                widget[alignKey] = align;
                renderScreen(jsonPath);
                menu.remove();
            };
            menu.appendChild(btn);
        });

        // Add Width Nudging to fine-tune the exact horizontal spacing between text and values
        if (alignKey === 'labelAlign' || alignKey === 'valueAlign') {
            const hr = document.createElement('hr');
            hr.style.margin = '4px 0';
            menu.appendChild(hr);
            
            const widthKey = alignKey === 'labelAlign' ? 'labelWidth' : 'valueWidth';
            const defaultWidth = alignKey === 'labelAlign' ? (data.layout?.labelColumn?.width || 120) : (data.layout?.valueColumn?.width || 120);
            const charWidth = canvasLogicalWidthPx(data) / (data.layout?.lcdTextColumns || 16);
            
            const growBtn = document.createElement('button');
            growBtn.textContent = 'Grow Width (+1 char)';
            growBtn.style.margin = '2px';
            growBtn.onclick = () => { widget[widthKey] = (widget[widthKey] || defaultWidth) + charWidth; renderScreen(jsonPath); menu.remove(); };
            menu.appendChild(growBtn);
            
            const shrinkBtn = document.createElement('button');
            shrinkBtn.textContent = 'Shrink Width (-1 char)';
            shrinkBtn.style.margin = '2px';
            shrinkBtn.onclick = () => { widget[widthKey] = Math.max(charWidth, (widget[widthKey] || defaultWidth) - charWidth); renderScreen(jsonPath); menu.remove(); };
            menu.appendChild(shrinkBtn);
        }
        document.body.appendChild(menu);
        
        setTimeout(() => {
            const closeMenu = (evt) => {
                if (!menu.contains(evt.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            };
            document.addEventListener('click', closeMenu);
        }, 0);
    };

    // Render all widgets using LVGL-style layout
    // Only menu_row widgets are focusable, in JSON order (provisioning: rows shown but focus is on Connect/Back only).
    const menuRowsAll = (data.widgets || []).filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    const menuRows = data.page === 'PROVISIONING_SETUP' ? [] : menuRowsAll;
    console.log('Menu row order (by lcdRow):', menuRowsAll.map(r => `${r.label} (row ${r.lcdRow})`));
    // Focus is index in sorted menuRows array
    let menuRowsFocusedIndex = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
    if (menuRows.length > 0) {
        menuRowsFocusedIndex = ((menuRowsFocusedIndex % menuRows.length) + menuRows.length) % menuRows.length;
        window._currentScreenFocus = menuRowsFocusedIndex;
        const stateMap = getScreenStateMap();
        const existing = stateMap[jsonPath] || {};
        stateMap[jsonPath] = {
            ...existing,
            focusIndex: menuRowsFocusedIndex,
            ipOctetIndex: typeof window._ipEditOctetIndex === 'number' ? window._ipEditOctetIndex : 0,
            ipEditMode: !!window._ipEditMode,
            wifiRowEditMode: !!window._wifiRowEditMode,
            valueEditMode: !!window._valueEditMode
        };
    } else if (data.page === 'PROVISIONING_SETUP') {
        if (typeof window._provisioningButtonFocus !== 'number') window._provisioningButtonFocus = 0;
        const stateMap = getScreenStateMap();
        const existing = stateMap[jsonPath] || {};
        stateMap[jsonPath] = {
            ...existing,
            provisioningButtonFocus: window._provisioningButtonFocus
        };
    }
    const focusedMenuRowId = menuRows[menuRowsFocusedIndex]?.id || null;
    let menuRowCounter = 0;
    const menuRowGap = data.layout?.menuRowGap || 0;
    const menuRowPixelHeight = Math.max(8, Number(data.layout?.menuRowPixelHeight) || TSTAT10_MENU_ROW_PX_DEFAULT);
    const headerY = 0; // Top row
    const menuRowsTop = headerY + menuRowPixelHeight;
    data.widgets.forEach((widget, idx) => {
            const lcdRow = widget.lcdRow || 1;
            const yPos = (lcdRow - 1) * menuRowPixelHeight;
            console.log(`[DEBUG] Widget: type=${widget.type}, label=${widget.label || widget.text || ''}, lcdRow=${lcdRow}, Y=${yPos}`);
        if (widget.type === 'header') {
            const headerRow = widget.lcdRow || 1;
            console.log(`[DEBUG] Rendering HEADER '${widget.text}' at lcdRow ${headerRow}, pixel top: ${(headerRow - 1) * menuRowPixelHeight}`);
            const header = document.createElement('div');
            header.style.position = 'absolute';
            header.style.left = '0px';
            header.style.width = canvasLogicalWidthPx(data) + 'px';
            const lcdRow = widget.lcdRow || 1;
            header.style.top = ((lcdRow - 1) * menuRowPixelHeight) + 'px';
            header.style.textAlign = widget.align || data.layout?.headerLayout?.align || 'center';
            header.style.fontWeight = widget.font || data.layout?.header?.font || 'bold';
            header.style.fontSize = data.styles?.fontSize || '22px';
            header.style.whiteSpace = 'nowrap';
            header.innerHTML = widget.text.replace(/\n/g, '<br>');
            header.dataset.treeNodeId = `w-${idx}`;
            if (window._isVisualEditMode) {
                header.style.cursor = 'pointer';
                header.addEventListener('mousedown', (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    const nid = `w-${idx}`;
                    if (window._layoutSelectedNodeId !== nid) selectLayoutNode(nid);
                });
            }

            if (window._isVisualEditMode) {
                header.style.outline = '1px dashed lightgrey';
                header.style.cursor = 'grab';
                enableInlineTextEdit(header, () => widget.text || '', (txt) => { widget.text = txt; renderScreen(jsonPath); });
                header.addEventListener('contextmenu', (e) => {
                    selectLayoutNode(`w-${idx}`);
                    showAlignmentMenu(e, widget, 'align');
                });
            }
            lcd.appendChild(header);
        } else if (widget.type === 'label') {
            const label = document.createElement('div');
            if (widget.id) label.id = widget.id;
            label.dataset.treeNodeId = `w-${idx}`;
            if (window._isVisualEditMode) {
                label.style.cursor = 'pointer';
                label.addEventListener('mousedown', (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    if (widget.id === 'main_icons_group') {
                        const part = evt.target?.closest?.('[data-icon-key]');
                        if (part?.dataset?.iconKey) {
                            selectLayoutNode(`w-${idx}-icon-${part.dataset.iconKey}`);
                            return;
                        }
                    }
                    const nid = `w-${idx}`;
                    if (window._layoutSelectedNodeId !== nid) selectLayoutNode(nid);
                });
            }
            label.style.position = 'absolute';
            const xPos = widget.x || 0;
            let yPos = widget.y || 0;
            if (data.page === 'MAIN_DISPLAY' && widget.id === 'main_icons_group') {
                // Keep icon strip inside LCD bounds in all modes.
                const iconRowHeight = 64;
                const maxY = Math.max(0, canvasHeightPx - iconRowHeight);
                const clampedY = Math.max(0, Math.min(maxY, Number(yPos || 0)));
                if (clampedY !== Number(widget.y || 0)) widget.y = clampedY;
                yPos = clampedY;
            }
            label.style.left = xPos + 'px';
            label.style.top = yPos + 'px';
            if (widget.id === 'prov_rssi_icon') label.style.zIndex = '12';
            if (widget.width != null) label.style.width = widget.width + 'px';
            if (widget.align === 'center') {
                label.style.transform = 'translateX(-50%)';
            } else if (widget.align === 'right') {
                label.style.transform = 'translateX(-100%)';
            }
            label.style.textAlign = widget.align || 'left';
            label.style.font = widget.font || (data.styles?.fontSize || '22px') + ' ' + (data.styles?.fontFamily || 'monospace');
            if (widget.fontSize) label.style.fontSize = `${widget.fontSize}px`;
            label.style.color = widget.color || '#fff';
            label.style.whiteSpace = widget.wrap ? 'normal' : 'nowrap';
            if (widget.id === 'main_icons_group') {
                label.innerHTML = renderMainIconsGroupText(widget);
            } else if (widget.id === 'prov_rssi_icon' && data.page === 'PROVISIONING_SETUP') {
                const st = data.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
                const { icon } = getProvisioningRssiPresentation(st?.value);
                label.innerHTML =
                    `<span class="prov-rssi-icon-chip" aria-hidden="true">` +
                    `<img src="./Icons/${icon}.svg" width="26" height="26" alt="" draggable="false" style="display:block;image-rendering:pixelated;image-rendering:crisp-edges" />` +
                    `</span>`;
            } else if (typeof widget.text === 'string' && widget.text.includes('id="temp_val"')) {
                const tempPoint = widget.t3ValueBinding || 'IN9';
                const liveTemp = getT3000PointValue(tempPoint);
                const rendered = Number.isFinite(Number(liveTemp)) ? Number(liveTemp).toFixed(1) : String(liveTemp ?? '');
                label.innerHTML = widget.text.replace(/>[^<]*<\/span><span style="font-size:26px;font-weight:600;vertical-align:super;margin-left:2px">°C<\/span>/, `>${rendered}</span><span style="font-size:26px;font-weight:600;vertical-align:super;margin-left:2px">°C</span>`);
            } else if (isSvgLibraryIconLabel(widget) && typeof widget.text === 'string') {
                label.style.lineHeight = '0';
                label.style.display = 'inline-block';
                label.innerHTML = `<span class="tstat-icon-svg-wrap">${widget.text}</span>`;
            } else {
                label.innerHTML = widget.text.replace(/\n/g, '<br>');
            }
            if (widget.id === 'main_ticker_line') {
                const tickerInner = label.querySelector('div');
                if (tickerInner && widget.width != null) {
                    tickerInner.style.width = `${Number(widget.width)}px`;
                    tickerInner.style.boxSizing = 'border-box';
                }
            }
            if (widget.id === 'main_icons_group' && window._layoutSelectedNodeId === `w-${idx}`) {
                label.classList.add('layout-group-selected');
            }
            if (window._isVisualEditMode) {
                label.style.outline = '1px dashed lightgrey';
                label.style.cursor = 'move';
                label.addEventListener('wheel', (e) => {
                    if (!e.shiftKey) return;
                    e.preventDefault();
                    const current = Number(widget.fontSize || parseInt(data.styles?.fontSize || '22', 10) || 22);
                    widget.fontSize = Math.max(10, current + (e.deltaY < 0 ? 1 : -1));
                    renderScreen(jsonPath);
                }, { passive: false });
                label.addEventListener('mousedown', (e) => {
                    // Ignore width-handle drags; those are handled separately.
                    if (e.target && e.target.classList && (e.target.classList.contains('tstat-width-handle') || e.target.classList.contains('tstat-width-handle-left'))) return;
                    if (window._layoutSelectedNodeId !== `w-${idx}`) {
                        selectLayoutNode(`w-${idx}`);
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    const lcdRect = lcd.getBoundingClientRect();
                    const zoom = Number(window._tstatZoom || 1);
                    const startMouseX = (e.clientX - lcdRect.left) / zoom;
                    const startMouseY = (e.clientY - lcdRect.top) / zoom;
                    const startX = Number(widget.x || 0);
                    const startY = Number(widget.y || 0);
                    let moved = false;
                    const DRAG_THRESHOLD = 2;
                    document.body.style.userSelect = 'none';
                    if (widget.id === 'main_ticker_line') {
                        label.classList.add('layout-drag-active');
                    }

                    const onMove = (mv) => {
                        const curMouseX = (mv.clientX - lcdRect.left) / zoom;
                        const curMouseY = (mv.clientY - lcdRect.top) / zoom;
                        const dx = snapToGrid(curMouseX - startMouseX, quarterCharStep);
                        const dy = snapToGrid(curMouseY - startMouseY, quarterCharStep);
                        if (!moved && (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD)) moved = true;
                        if (!moved) return;
                        const previewX = Math.max(0, Math.min(canvasWidthPx, startX + dx));
                        const previewY = Math.max(0, Math.min(canvasHeightPx, startY + dy));
                        label.style.left = `${previewX}px`;
                        label.style.top = `${previewY}px`;
                    };
                    const onUp = (up) => {
                        const curMouseX = (up.clientX - lcdRect.left) / zoom;
                        const curMouseY = (up.clientY - lcdRect.top) / zoom;
                        const dx = snapToGrid(curMouseX - startMouseX, quarterCharStep);
                        const dy = snapToGrid(curMouseY - startMouseY, quarterCharStep);
                        if (moved) {
                            widget.x = Math.max(0, Math.min(canvasWidthPx, startX + dx));
                            widget.y = Math.max(0, Math.min(canvasHeightPx, startY + dy));
                            const wid = widget.id;
                            const list = window._currentScreenData?.widgets;
                            if (wid && Array.isArray(list)) {
                                const ddx = widget.x - startX;
                                const ddy = widget.y - startY;
                                if (ddx !== 0 || ddy !== 0) {
                                    list.forEach((c) => {
                                        if (c && c.parentId === wid) {
                                            c.x = Math.max(0, Math.min(canvasWidthPx, Number(c.x || 0) + ddx));
                                            c.y = Math.max(0, Math.min(canvasHeightPx, Number(c.y || 0) + ddy));
                                        }
                                    });
                                }
                            }
                        } else if (typeof label._startInlineEdit === 'function' && typeof widget.text === 'string' && !widget.text.includes('<svg')) {
                            const now = Date.now();
                            const prev = Number(label._lastSelectTs || 0);
                            if (now - prev < 450) {
                                label._startInlineEdit();
                            }
                            label._lastSelectTs = now;
                        }
                        document.body.style.userSelect = '';
                        label.classList.remove('layout-drag-active');
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        if (moved) renderScreen(jsonPath);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
                const fallbackWidth = Math.max(40, Number(widget.width || label.offsetWidth || 80));
                attachWidthDragResize(label, widget, 'width', fallbackWidth, {
                    xKey: 'x',
                    alignKey: 'align',
                    defaultAlign: 'left',
                    nodeId: `w-${idx}`,
                    selectedOnly: true
                });
                if (typeof widget.text === 'string' && !widget.text.includes('<svg')) {
                    enableInlineTextEdit(label, () => widget.text || '', (txt) => {
                        widget.text = String(txt || '');
                        renderScreen(jsonPath);
                    });
                }
            }
            lcd.appendChild(label);
        } else if (widget.type === 'menu_row' || widget.type === 'blank') {
            const rowLcdRow = widget.lcdRow || 1;
            if (widget.type === 'menu_row') {
                console.log(`[DEBUG] Rendering MENU_ROW '${widget.label}' at lcdRow ${rowLcdRow}, pixel top: ${((rowLcdRow - 1) * menuRowPixelHeight)}`);
            } else if (widget.type === 'blank') {
                console.log(`[DEBUG] Rendering BLANK at lcdRow ${rowLcdRow}, pixel top: ${((rowLcdRow - 1) * menuRowPixelHeight)}`);
            }
            // Always use lcdRow math for vertical positioning
            const row = document.createElement('div');
            row.dataset.treeNodeId = `w-${idx}`;
            if (widget.id) row.dataset.menuRowId = widget.id;
            row.style.position = 'absolute';
            row.style.left = (data.layout?.rowLeftPadding || 0) + 'px';
            const lcdRow = normalizeLcdRowSlot(widget.lcdRow);
            row.style.top = ((lcdRow - 1) * menuRowPixelHeight) + 'px';
            row.style.transform = 'none';
            row.style.display = 'flex';
            row.style.flexDirection = 'row';
            row.style.alignItems = 'center';
            // Make row span the full canvas width minus left padding
            const rowLeftPad = data.layout?.rowLeftPadding || 0;
            const canvasW = canvasLogicalWidthPx(data);
            row.style.width = (canvasW - rowLeftPad) + 'px';
            row.style.right = '';

            if (window._isVisualEditMode) {
                // Pointer row-reorder: works over overlays/labels and uses scaled LCD coordinates (unlike HTML5 DnD).
                row.style.cursor = 'grab';
                row.addEventListener('mousedown', (evt) => {
                    if (evt.button !== 0) return;
                    const nodeId = `w-${idx}`;
                    if (window._layoutSelectedNodeId !== nodeId) {
                        evt.preventDefault();
                        evt.stopPropagation();
                        selectLayoutNode(nodeId);
                        return;
                    }
                    evt.preventDefault();
                    evt.stopPropagation();
                    const startY = evt.clientY;
                    const dragThresholdPx = 6;
                    let dragging = false;
                    let guide = null;
                    const h = menuRowPixelHeight;
                    const maxSlots = Math.max(1, Math.floor(Number(lcdCanvasHeight) / h));
                    const pathForRerender = () => (window._currentJsonPath || jsonPath);
                    const onMove = (mv) => {
                        if (!dragging && Math.abs(mv.clientY - startY) < dragThresholdPx) return;
                        if (!dragging) {
                            dragging = true;
                            document.body.style.userSelect = 'none';
                            row.style.opacity = '0.55';
                            guide = document.createElement('div');
                            guide.className = 'lcd-row-reorder-guide';
                            guide.style.cssText = 'position:absolute;left:0;width:100%;height:2px;background:#00e676;pointer-events:none;z-index:100001;box-shadow:0 0 6px rgba(0,230,118,.45)';
                            lcd.appendChild(guide);
                        }
                        const yLocal = lcdClientYToLocalY(mv.clientY, lcd);
                        const targetRow = Math.max(1, Math.min(maxSlots, Math.floor(yLocal / h) + 1));
                        guide.style.top = `${(targetRow - 1) * h - 1}px`;
                    };
                    const onUp = (up) => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        document.body.style.userSelect = '';
                        row.style.opacity = '';
                        if (guide?.parentNode) guide.remove();
                        if (dragging) {
                            const yLocal = lcdClientYToLocalY(up.clientY, lcd);
                            const widgets = window._currentScreenData?.widgets;
                            if (applyRowSlotReorderAtLocalY(widget, yLocal, widgets, h, lcdCanvasHeight)) {
                                renderScreen(pathForRerender());
                            }
                        }
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
            }

            if (widget.type === 'menu_row') {
                                // Value
                                let liveWidget = (window._currentScreenData?.widgets || []).find(w => w.type === 'menu_row' && w.id === widget.id) || widget;
                                const valueSpan = document.createElement('span');
                                valueSpan.classList.add('tstat-value-box');
                                if (widget.valueId) valueSpan.id = widget.valueId;
                                const isMainHome = data.page === 'MAIN_DISPLAY';
                                const boundValue = liveWidget.t3ValueBinding ? getT3000PointValue(liveWidget.t3ValueBinding) : null;
                                let rawVal;
                                const storedVal = (liveWidget.value ?? '').toString();
                                const useStoredInLayoutEdit =
                                    window._isVisualEditMode && storedVal.trim().length > 0;
                                if (useStoredInLayoutEdit) {
                                    rawVal = storedVal;
                                } else if (data.page === 'PROVISIONING_SETUP' && widget.id === 'ui_item_prov_rssi') {
                                    const st = (window._currentScreenData?.widgets || []).find((w) => w && w.id === 'ui_item_prov_status');
                                    rawVal = getProvisioningRssiPresentation(st?.value).text;
                                } else if (data.page === 'PROVISIONING_SETUP' && widget.id === 'ui_item_prov_rssi_quality') {
                                    const st = (window._currentScreenData?.widgets || []).find((w) => w && w.id === 'ui_item_prov_status');
                                    rawVal = getProvisioningRssiPresentation(st?.value).quality;
                                } else {
                                    rawVal = (boundValue ?? liveWidget.value ?? liveWidget.options?.[0] ?? '').toString();
                                }
                                const ipv4RowIds = ['ui_item_ip', 'ui_item_mask', 'ui_item_gw'];
                                const activeOctetIndex = (
                                    data.page === 'WIFI_SETTINGS' &&
                                    isIpv4RowId(widget.id) &&
                                    window._ipEditMode &&
                                    widget.id === focusedMenuRowId
                                )
                                    ? Number(window._ipEditOctetIndex || 0)
                                    : null;
                                const ipv4Html = !isMainHome && ipv4RowIds.includes(widget.id)
                                    ? formatIPv4AlignedHtml(rawVal, activeOctetIndex)
                                    : null;
                                if (ipv4Html) valueSpan.innerHTML = ipv4Html;
                                else valueSpan.textContent = rawVal;
                                valueSpan.style.display = 'inline-block';
                                valueSpan.style.padding = '0';
                                valueSpan.style.margin = '0';
                                if (isMainHome) {
                                    valueSpan.style.background = 'transparent';
                                    valueSpan.style.color = '#ffffff';
                                    valueSpan.style.border = '1px solid #ffffff';
                                    valueSpan.style.borderRadius = '4px';
                                    valueSpan.style.padding = '4px 10px';
                                    valueSpan.style.boxSizing = 'border-box';
                                } else {
                                    valueSpan.style.background = '#fff';
                                    valueSpan.style.color = '#003366';
                                    valueSpan.style.borderRadius = '8px';
                                    valueSpan.style.display = 'inline-flex';
                                    valueSpan.style.alignItems = 'center';
                                    valueSpan.style.justifyContent = ipv4Html ? 'flex-start' : 'flex-end';
                                    valueSpan.style.boxSizing = 'border-box';
                                    valueSpan.style.minHeight = Math.max(0, menuRowPixelHeight - 6) + 'px';
                                }
                                valueSpan.style.fontWeight = 'bold';
                                valueSpan.style.width = (widget.valueWidth || data.layout?.valueColumn?.width || 120) + 'px';
                                valueSpan.style.marginLeft = 'auto';
                                valueSpan.style.textAlign = 'left';
                                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                                valueSpan.style.paddingRight = 0;
                                valueSpan.style.whiteSpace = 'nowrap';
                                valueSpan.style.overflow = 'hidden';
                                valueSpan.style.textOverflow = 'ellipsis';
                                const isSettingsPage = data.page !== 'MAIN_DISPLAY' && data.page !== 'SETUP_MENU';
                                const editActive = isSettingsPage && widget.id === focusedMenuRowId &&
                                    (data.page === 'WIFI_SETTINGS' ? !!window._wifiRowEditMode : !!window._valueEditMode);
                                if (editActive) valueSpan.classList.add('tstat-edit-active');
                // Render highlight background for every row, only visible for focused row
                const highlight = document.createElement('div');
                highlight.style.position = 'absolute';
                // Make the highlight one char narrower, with a char of space on each side
                const charWidth = canvasLogicalWidthPx(data) / (data.layout?.lcdTextColumns || 16);
                const defaultInsetX = charWidth / 2;
                const insetX = Number(widget.highlightInsetX ?? defaultInsetX);
                const insetY = Number(widget.highlightInsetY ?? 0);
                const widthAdjust = Number(widget.highlightWidthAdjust ?? 0);
                const heightAdjust = Number(widget.highlightHeightAdjust ?? 0);
                const highlightWidth = `calc(100% - ${(insetX * 2) - widthAdjust}px)`;
                const highlightHeight = Math.max(1, menuRowPixelHeight + heightAdjust);
                highlight.style.left = insetX + 'px';
                highlight.style.top = insetY + 'px';
                highlight.style.width = highlightWidth;
                highlight.style.height = highlightHeight + 'px';
                highlight.style.background = data.styles?.highlight || TSTAT10_FW_HIGHLIGHT_CSS;
                highlight.style.borderRadius = `${Number(widget.highlightRadius ?? 8)}px`;
                highlight.style.zIndex = '0';
                highlight.style.pointerEvents = 'none';
                // Focus logic: highlight only if this menu_row is the focused one (by id)
                const focusedMenuRow = menuRows[menuRowsFocusedIndex];
                if (data.page === 'MAIN_DISPLAY') {
                    highlight.style.background = 'rgba(255,255,255,0.22)';
                    highlight.style.opacity = (widget.id === focusedMenuRow?.id) ? '1' : '0';
                } else {
                    highlight.style.background = data.styles?.highlight || TSTAT10_FW_HIGHLIGHT_CSS;
                    highlight.style.opacity = (widget.id === focusedMenuRow?.id) ? '1' : '0';
                }
                row.insertBefore(highlight, row.firstChild);
                const selectedNodeId = window._layoutSelectedNodeId || '';
                const thisRowNodeId = `w-${idx}`;
                if (window._isVisualEditMode && (widget.id === focusedMenuRowId || layoutTreeSelectionMatchesNode(selectedNodeId, thisRowNodeId))) {
                    highlight.style.pointerEvents = 'auto';
                    const moveHandle = document.createElement('span');
                    moveHandle.style.position = 'absolute';
                    moveHandle.style.left = '-3px';
                    moveHandle.style.top = '-3px';
                    moveHandle.style.width = '8px';
                    moveHandle.style.height = '8px';
                    moveHandle.style.borderRadius = '50%';
                    moveHandle.style.background = 'rgba(14,165,233,0.95)';
                    moveHandle.style.cursor = 'move';
                    moveHandle.style.zIndex = '6';
                    highlight.appendChild(moveHandle);

                    const resizeHandle = document.createElement('span');
                    resizeHandle.style.position = 'absolute';
                    resizeHandle.style.right = '-4px';
                    resizeHandle.style.top = '50%';
                    resizeHandle.style.transform = 'translateY(-50%)';
                    resizeHandle.style.width = '8px';
                    resizeHandle.style.height = '16px';
                    resizeHandle.style.borderRadius = '4px';
                    resizeHandle.style.background = 'rgba(245,158,11,0.95)';
                    resizeHandle.style.cursor = 'ew-resize';
                    resizeHandle.style.zIndex = '6';
                    highlight.appendChild(resizeHandle);

                    // Full-height drag lines on left/right edges for direct resize interaction.
                    const leftLineHandle = document.createElement('span');
                    leftLineHandle.style.position = 'absolute';
                    leftLineHandle.style.left = '-2px';
                    leftLineHandle.style.top = '0';
                    leftLineHandle.style.width = '4px';
                    leftLineHandle.style.height = '100%';
                    leftLineHandle.style.background = 'rgba(56, 189, 248, 0.7)';
                    leftLineHandle.style.cursor = 'ew-resize';
                    leftLineHandle.style.zIndex = '6';
                    highlight.appendChild(leftLineHandle);

                    const rightLineHandle = document.createElement('span');
                    rightLineHandle.style.position = 'absolute';
                    rightLineHandle.style.right = '-2px';
                    rightLineHandle.style.top = '0';
                    rightLineHandle.style.width = '4px';
                    rightLineHandle.style.height = '100%';
                    rightLineHandle.style.background = 'rgba(56, 189, 248, 0.7)';
                    rightLineHandle.style.cursor = 'ew-resize';
                    rightLineHandle.style.zIndex = '6';
                    highlight.appendChild(rightLineHandle);

                    const bindMove = () => {
                        let drag = false, sx = 0, sy = 0, bx = 0, by = 0;
                        moveHandle.addEventListener('mousedown', (evt) => {
                            evt.preventDefault(); evt.stopPropagation();
                            drag = true;
                            sx = evt.clientX; sy = evt.clientY;
                            bx = Number(widget.highlightInsetX ?? (charWidth / 2));
                            by = Number(widget.highlightInsetY ?? 0);
                            const onMove = (mv) => {
                                if (!drag) return;
                                const dx = snapToGrid(mv.clientX - sx, quarterCharStep);
                                const dy = snapToGrid(mv.clientY - sy, quarterCharStep);
                                highlight.style.left = `${bx + dx}px`;
                                highlight.style.top = `${by + dy}px`;
                            };
                            const onUp = (up) => {
                                if (!drag) return;
                                drag = false;
                                const dx = snapToGrid(up.clientX - sx, quarterCharStep);
                                const dy = snapToGrid(up.clientY - sy, quarterCharStep);
                                widget.highlightInsetX = bx + dx;
                                widget.highlightInsetY = by + dy;
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                                renderScreen(jsonPath);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    };
                    const bindResize = () => {
                        let drag = false, sx = 0, bw = 0;
                        resizeHandle.addEventListener('mousedown', (evt) => {
                            evt.preventDefault(); evt.stopPropagation();
                            drag = true;
                            sx = evt.clientX;
                            bw = Number(widget.highlightWidthAdjust ?? 0);
                            const onMove = (mv) => {
                                if (!drag) return;
                                const dx = snapToGrid(mv.clientX - sx, quarterCharStep);
                                const insetXNow = Number(widget.highlightInsetX ?? (charWidth / 2));
                                highlight.style.width = `calc(100% - ${(insetXNow * 2) - (bw + dx)}px)`;
                            };
                            const onUp = (up) => {
                                if (!drag) return;
                                drag = false;
                                const dx = snapToGrid(up.clientX - sx, quarterCharStep);
                                widget.highlightWidthAdjust = bw + dx;
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                                renderScreen(jsonPath);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    };
                    const bindEdgeResize = (edgeEl, direction) => {
                        let drag = false, sx = 0, baseInset = 0, baseWidthAdj = 0;
                        edgeEl.addEventListener('mousedown', (evt) => {
                            evt.preventDefault(); evt.stopPropagation();
                            drag = true;
                            sx = evt.clientX;
                            baseInset = Number(widget.highlightInsetX ?? (charWidth / 2));
                            baseWidthAdj = Number(widget.highlightWidthAdjust ?? 0);
                            const onMove = (mv) => {
                                if (!drag) return;
                                const dx = snapToGrid(mv.clientX - sx, quarterCharStep);
                                if (direction === 'left') {
                                    const inset = baseInset + dx;
                                    const widthAdj = baseWidthAdj - (dx * 2);
                                    highlight.style.left = `${inset}px`;
                                    highlight.style.width = `calc(100% - ${(inset * 2) - widthAdj}px)`;
                                } else {
                                    const widthAdj = baseWidthAdj + dx;
                                    const inset = Number(widget.highlightInsetX ?? (charWidth / 2));
                                    highlight.style.width = `calc(100% - ${(inset * 2) - widthAdj}px)`;
                                }
                            };
                            const onUp = (up) => {
                                if (!drag) return;
                                drag = false;
                                const dx = snapToGrid(up.clientX - sx, quarterCharStep);
                                if (direction === 'left') {
                                    widget.highlightInsetX = baseInset + dx;
                                    widget.highlightWidthAdjust = baseWidthAdj - (dx * 2);
                                } else {
                                    widget.highlightWidthAdjust = baseWidthAdj + dx;
                                }
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                                renderScreen(jsonPath);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    };
                    bindMove();
                    bindResize();
                    bindEdgeResize(leftLineHandle, 'left');
                    bindEdgeResize(rightLineHandle, 'right');
                }
                // Ensure row contents are above highlight
                setTimeout(() => {
                    Array.from(row.children).forEach(child => {
                        if (child !== highlight) {
                            child.style.position = 'relative';
                            child.style.zIndex = '1';
                        }
                    });
                }, 0);
                row.style.height = menuRowPixelHeight + 'px';
                // Default background for non-focused rows
                if (data.page === 'MAIN_DISPLAY') {
                    row.style.background = 'transparent';
                    row.style.boxShadow = '';
                } else if (!focusedMenuRow || widget.id !== focusedMenuRow.id) {
                    // Provisioning uses empty menuRows for keypad focus (Connect/Back only); no focused row → show all rows.
                    row.style.background = 'rgba(0,0,0,0.08)';
                    row.style.boxShadow = '';
                } else {
                    row.style.background = 'transparent';
                    row.style.boxShadow = '';
                }
                row.style.borderRadius = '8px';
                row.style.fontSize = data.styles?.fontSize || '22px';
                row.style.fontFamily = data.styles?.fontFamily || 'monospace';
                row.style.paddingTop = '0';
                row.style.paddingBottom = '0';
                row.style.marginTop = '0';
                row.style.marginBottom = '0';
                // Label
                // Row number
                // Removed debug row number

                // Label
                const labelSpanFixed = document.createElement('span');
                labelSpanFixed.dataset.treeNodeId = `w-${idx}-label`;
                if (window._isVisualEditMode) {
                    labelSpanFixed.addEventListener('mousedown', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        selectLayoutNode(`w-${idx}-label`);
                    });
                }
                const needsLeadingSpacer = data.page !== 'MAIN_DISPLAY' && data.page !== 'WIFI_SETTINGS';
                const renderedLabel = resolveMenuRowLabel(widget);
                labelSpanFixed.textContent = (needsLeadingSpacer ? '\u00A0' : '') + renderedLabel;
                // Removed left padding, use non-breaking space for shift
                labelSpanFixed.style.display = 'inline-block';
                labelSpanFixed.style.width = (widget.labelWidth || data.layout?.labelColumn?.width || 120) + 'px';
                labelSpanFixed.style.textAlign = widget.labelAlign || data.layout?.labelColumnLayout?.align || 'left';
                labelSpanFixed.style.fontWeight = 'bold';
                labelSpanFixed.style.color = '#fff';
                labelSpanFixed.style.padding = '0';
                if (data.page === 'WIFI_SETTINGS') {
                    const lpad = data.layout?.labelBoxLeftPadding ?? 0;
                    const rpad = data.layout?.labelBoxRightPadding ?? 0;
                    labelSpanFixed.style.paddingLeft = lpad + 'px';
                    labelSpanFixed.style.paddingRight = rpad + 'px';
                    labelSpanFixed.style.boxSizing = 'border-box';
                }
                labelSpanFixed.style.margin = '0';
                const labelOffsetX = Number(widget.labelOffsetX || 0);
                const labelOffsetY = Number(widget.labelOffsetY || 0);
                if (labelOffsetX || labelOffsetY) {
                    labelSpanFixed.style.transform = `translate(${labelOffsetX}px, ${labelOffsetY}px)`;
                }
                labelSpanFixed.style.overflow = 'hidden';
                labelSpanFixed.style.textOverflow = 'ellipsis';
                labelSpanFixed.style.whiteSpace = 'nowrap';

                if (window._isVisualEditMode) {
                    labelSpanFixed.style.outline = '1px dashed lightgrey';
                    labelSpanFixed.style.cursor = 'grab';
                    enableInlineTextEdit(
                        labelSpanFixed,
                        () => ((needsLeadingSpacer ? '\u00A0' : '') + (resolveMenuRowLabel(widget) || '')),
                        (txt) => {
                            const clean = String(txt || '').replace('\u00A0', '').trim();
                            if (String(widget.labelDisplayMode || '').toLowerCase() === 'custom') {
                                widget.labelCustom = clean;
                            } else {
                                widget.label = clean;
                            }
                            renderScreen(jsonPath);
                        }
                    );
                    labelSpanFixed.addEventListener('contextmenu', (e) => {
                        selectLayoutNode(`w-${idx}-label`);
                        showAlignmentMenu(e, widget, 'labelAlign');
                    });
                    // Fast resize using mouse wheel
                    labelSpanFixed.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const charWidth = canvasLogicalWidthPx(data) / (data.layout?.lcdTextColumns || 16);
                        const defaultWidth = data.layout?.labelColumn?.width || 120;
                        let currentWidth = widget.labelWidth || defaultWidth;
                        if (e.deltaY < 0) widget.labelWidth = currentWidth + charWidth; // scroll up grows
                        else widget.labelWidth = Math.max(charWidth, currentWidth - charWidth); // scroll down shrinks
                        renderScreen(jsonPath);
                    });
                    const defaultWidth = data.layout?.labelColumn?.width || 120;
                    attachWidthDragResize(labelSpanFixed, widget, 'labelWidth', defaultWidth, {
                        offsetKey: 'labelOffsetX',
                        nodeId: `w-${idx}-label`,
                        selectedOnly: true
                    });
                    attachOffsetDrag(labelSpanFixed, widget, 'labelOffsetX', 'labelOffsetY');
                }
                row.appendChild(labelSpanFixed);
                // (removed duplicate labelSpan code)
                valueSpan.style.textAlign = widget.valueAlign || data.layout?.valueBoxTextAlign || 'right';
                valueSpan.dataset.treeNodeId = `w-${idx}-value`;
                if (window._isVisualEditMode) {
                    valueSpan.addEventListener('mousedown', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        selectLayoutNode(`w-${idx}-value`);
                    });
                }
                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                valueSpan.style.paddingRight = 0;
                const valueOffsetX = Number(widget.valueOffsetX || 0);
                const valueOffsetY = Number(widget.valueOffsetY || 0);
                if (valueOffsetX || valueOffsetY) {
                    valueSpan.style.transform = `translate(${valueOffsetX}px, ${valueOffsetY}px)`;
                }
                valueSpan.style.whiteSpace = 'nowrap';
                valueSpan.style.overflow = 'hidden';
                valueSpan.style.textOverflow = 'ellipsis';
                if (data.page === 'MAIN_DISPLAY') {
                    valueSpan.style.padding = '4px 10px';
                    valueSpan.style.boxSizing = 'border-box';
                }

                const longParamIds = ['ui_item_ip', 'ui_item_mask', 'ui_item_gw'];
                const isLongParam = widget.longValue === true || longParamIds.includes(widget.id);
                if (isLongParam && !isMainHome) {
                    valueSpan.style.overflowX = 'hidden';
                    valueSpan.style.overflowY = 'hidden';
                    valueSpan.style.textOverflow = 'clip';
                    valueSpan.title = 'Use keypad arrows to edit values';
                    // Keep full IPv4 values visible within the fixed LCD row width.
                    valueSpan.style.fontSize = '24px';
                    valueSpan.style.letterSpacing = '0';
                }

                if (window._isVisualEditMode) {
                    valueSpan.style.outline = '1px dashed lightgrey';
                    valueSpan.style.cursor = 'grab';
                    valueSpan.addEventListener('contextmenu', (e) => {
                        selectLayoutNode(`w-${idx}-value`);
                        showAlignmentMenu(e, widget, 'valueAlign');
                    });
                    // Fast resize using mouse wheel
                    valueSpan.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const charWidth = canvasLogicalWidthPx(data) / (data.layout?.lcdTextColumns || 16);
                        const defaultWidth = data.layout?.valueColumn?.width || 120;
                        let currentWidth = widget.valueWidth || defaultWidth;
                        if (e.deltaY < 0) widget.valueWidth = currentWidth + charWidth; // scroll up grows
                        else widget.valueWidth = Math.max(charWidth, currentWidth - charWidth); // scroll down shrinks
                        renderScreen(jsonPath);
                    });
                    const defaultWidth = data.layout?.valueColumn?.width || 120;
                    attachWidthDragResize(valueSpan, widget, 'valueWidth', defaultWidth, {
                        offsetKey: 'valueOffsetX',
                        edgeBehavior: 'flexAutoRight',
                        nodeId: `w-${idx}-value`,
                        selectedOnly: true
                    });
                    attachOffsetDrag(valueSpan, widget, 'valueOffsetX', 'valueOffsetY');
                    const canEditMenuValueText = !liveWidget.t3ValueBinding && !ipv4Html;
                    if (canEditMenuValueText) {
                        enableInlineTextEdit(valueSpan, () => String(rawVal ?? ''), (txt) => {
                            widget.value = String(txt || '').trim();
                            renderScreen(jsonPath);
                        });
                    }
                }
                row.appendChild(valueSpan);
            } else if (widget.type === 'blank') {
                row.style.height = menuRowPixelHeight + 'px';
                // Only show row number and label for blank rows that have a label property
                if (widget.label) {
                    const rowNumSpan = document.createElement('span');
                    rowNumSpan.textContent = (lcdRow <= 9) ? lcdRow : 0;
                    rowNumSpan.style.display = 'inline-block';
                    rowNumSpan.style.width = '18px';
                    rowNumSpan.style.textAlign = 'right';
                    rowNumSpan.style.fontWeight = 'bold';
                    rowNumSpan.style.color = '#ff0';
                    rowNumSpan.style.marginRight = '6px';
                    row.appendChild(rowNumSpan);

                    const labelSpanFixed = document.createElement('span');
                    labelSpanFixed.textContent = widget.label;
                    labelSpanFixed.style.display = 'inline-block';
                    labelSpanFixed.style.width = (data.layout?.labelColumn?.width || 120) + 'px';
                    labelSpanFixed.style.textAlign = 'left';
                    labelSpanFixed.style.fontWeight = 'bold';
                    labelSpanFixed.style.color = '#aaa';
                    labelSpanFixed.style.padding = '0';
                    labelSpanFixed.style.margin = '0';
                    labelSpanFixed.style.overflow = 'hidden';
                    labelSpanFixed.style.textOverflow = 'ellipsis';
                    labelSpanFixed.style.whiteSpace = 'nowrap';
                    row.appendChild(labelSpanFixed);
                }
            }
            lcd.appendChild(row);
        }
    });

    // Render all button widgets from JSON
    const buttonWidgets = (data.widgets || []).filter(w => w.type === 'button');
    // Sanitize legacy hardcoded coordinates so auto-centering works properly again
    buttonWidgets.forEach(w => {
        if (w.x === 0) delete w.x;
    });
    const defaultFooterY = data.layout?.footerLayout?.y ?? data.layout?.footer?.y ?? 435;
    const footerPadding = data.layout?.footerPadding ?? 0;
    const footerBottomPadding = data.layout?.footerBottomPadding ?? 0;
    // Center the button row horizontally with gap (reuse lcdCanvasWidth from canvas setup above)
    const buttonGap = data.layout?.buttonGap ?? data.layout?.buttonHorizontalGap ?? 0;
    const buttonWidths = buttonWidgets.map(w => w.width !== undefined ? w.width : 72);
    const totalButtonWidth = buttonWidths.reduce((a, b) => a + b, 0) + buttonGap * (buttonWidgets.length - 1);
    const startX = Math.round((lcdCanvasWidth - totalButtonWidth) / 2);
    let runningX = startX;
    buttonWidgets.forEach((widget, idx) => {
        const btn = document.createElement('div');
        const widgetIdx = (data.widgets || []).indexOf(widget);
        btn.dataset.treeNodeId = widgetIdx >= 0 ? `w-${widgetIdx}` : `w-btn-${idx}`;
        if (window._isVisualEditMode) {
            btn.style.cursor = 'grab';
            btn.addEventListener('click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (widgetIdx >= 0) selectLayoutNode(`w-${widgetIdx}`);
            });
        }
        const labelSpan = document.createElement('span');
        labelSpan.className = 'tstat-lcd-btn__label';
        labelSpan.textContent = widget.label ?? '';
        btn.appendChild(labelSpan);
        btn.style.position = 'absolute';
        const currentX = widget.x !== undefined ? widget.x : runningX;
        btn.style.left = currentX + 'px';
        let y = (widget.y !== undefined ? widget.y : defaultFooterY);
        btn.style.top = (y - footerPadding - footerBottomPadding) + 'px';
        const btnWidth = widget.width !== undefined ? widget.width : 72;
        btn.style.width = btnWidth + 'px';
        btn.style.height = (widget.height !== undefined ? widget.height : 45) + 'px';
        btn.style.background = data.styles?.bg || '#003366';
        btn.style.color = '#fff';
        btn.style.fontWeight = 'bold';
        btn.style.fontFamily = data.styles?.fontFamily || 'monospace';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.lineHeight = '1.1';
        btn.style.borderRadius = '8px';
        btn.style.textAlign = 'center';
        btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)';
        btn.style.userSelect = window._isVisualEditMode ? 'text' : 'none';
        btn.style.border = '2px solid #fff';
        if (widget.font) {
            btn.style.font = widget.font;
        } else {
            btn.style.fontSize = data.styles?.fontSize || '22px';
        }

        // Add navigation click handlers (disabled in layout edit — use Play to preview)
        if (!window._isVisualEditMode) {
            if (widget.id === 'btn_back') {
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', () => {
                    if (data.page === 'SETUP_MENU') {
                        window.navigateTo('main');
                    } else if (data.page !== 'MAIN_DISPLAY') {
                        window.navigateTo('setup'); // All submenus go back to the setup menu
                    }
                });
            } else if (widget.id === 'btn_settings') {
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', () => window.navigateTo('setup'));
            } else if (widget.id === 'btn_next') {
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', () => {
                    const menuRows = getMenuRows(data);
                    if (!menuRows.length) return;
                    let focusIdx = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
                    focusIdx = ((focusIdx % menuRows.length) + menuRows.length) % menuRows.length;
                    if (data.page === 'SETUP_MENU') {
                        openSetupFocusedRow(menuRows, focusIdx);
                        return;
                    }
                    if (data.page === 'WIFI_SETTINGS') {
                        const focusedRow = menuRows[focusIdx];
                        if (focusedRow) {
                            if (!window._wifiRowEditMode) {
                                window._wifiRowEditMode = true;
                                window._ipEditMode = isIpv4RowId(focusedRow.id);
                                window._valueEditMode = true;
                                if (window._ipEditMode) window._ipEditOctetIndex = 0;
                            } else if (window._ipEditMode && isIpv4RowId(focusedRow.id)) {
                                window._ipEditOctetIndex = (Number(window._ipEditOctetIndex || 0) + 1) % 4;
                            }
                            renderScreen(window._currentJsonPath);
                        }
                        return;
                    }
                    if (data.page === 'MAIN_DISPLAY') {
                        // Home screen NEXT behavior: cycle focused parameter row.
                        focusIdx = (focusIdx + 1) % menuRows.length;
                        window._currentScreenFocus = focusIdx;
                        window._valueEditMode = false;
                        renderScreen(window._currentJsonPath);
                        return;
                    }
                    focusIdx = advanceFocusByRight(data, menuRows, focusIdx);
                    window._currentScreenFocus = focusIdx;
                    renderScreen(window._currentJsonPath);
                });
            } else if (widget.id === 'btn_connect_phone') {
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', () => {
                    if (data.page !== 'PROVISIONING_SETUP') return;
                    window._provisioningButtonFocus = 0;
                    const sm = getScreenStateMap();
                    sm[jsonPath] = { ...sm[jsonPath], provisioningButtonFocus: 0 };
                    startProvisioningConnectFlow(jsonPath);
                });
            }
        }

        if (window._isVisualEditMode) {
            btn.style.outline = '1px dashed lightgrey';
            labelSpan.style.userSelect = 'text';
            labelSpan.style.cursor = 'text';
            labelSpan.style.minWidth = '0';
            labelSpan.style.maxWidth = '100%';
            labelSpan.style.overflow = 'hidden';
            labelSpan.style.textOverflow = 'ellipsis';
            enableInlineTextEdit(labelSpan, () => String(widget.label ?? ''), (txt) => {
                widget.label = String(txt || '').trim();
                renderScreen(jsonPath);
            });
            btn.addEventListener('dblclick', (evt) => {
                if (evt.target !== btn) return;
                evt.preventDefault();
                evt.stopPropagation();
                if (typeof labelSpan._startInlineEdit === 'function') labelSpan._startInlineEdit();
            });

            btn.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                let existingMenu = document.getElementById('visual-edit-context-menu');
                if (existingMenu) existingMenu.remove();
                
                const menu = document.createElement('div');
                menu.id = 'visual-edit-context-menu';
                menu.style.position = 'fixed';
                menu.style.left = e.pageX + 'px';
                menu.style.top = e.pageY + 'px';
                menu.style.background = '#fff';
                menu.style.color = '#000';
                menu.style.border = '1px solid #ccc';
                menu.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
                menu.style.zIndex = '10006';
                menu.style.display = 'flex';
                menu.style.flexDirection = 'column';
                menu.style.padding = '5px';
                const charW = canvasLogicalWidthPx(data) / (data.layout?.lcdTextColumns || 16);
                
                const nudgeLeft = document.createElement('button');
                nudgeLeft.textContent = 'Nudge Left (-1 char)';
                nudgeLeft.style.margin = '2px';
                nudgeLeft.onclick = () => { widget.x = currentX - charW; renderScreen(jsonPath); menu.remove(); };
                menu.appendChild(nudgeLeft);
                
                const nudgeRight = document.createElement('button');
                nudgeRight.textContent = 'Nudge Right (+1 char)';
                nudgeRight.style.margin = '2px';
                nudgeRight.onclick = () => { widget.x = currentX + charW; renderScreen(jsonPath); menu.remove(); };
                menu.appendChild(nudgeRight);
                
                document.body.appendChild(menu);
                setTimeout(() => { const closeMenu = (evt) => { if (!menu.contains(evt.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } }; document.addEventListener('click', closeMenu); }, 0);
            });
        }
        if (data.page === 'PROVISIONING_SETUP' && (widget.id === 'btn_connect_phone' || widget.id === 'btn_back')) {
            const bf = typeof window._provisioningButtonFocus === 'number' ? window._provisioningButtonFocus : 0;
            const isConnect = widget.id === 'btn_connect_phone';
            const focused = (isConnect && bf === 0) || (!isConnect && bf === 1);
            btn.classList.add('tstat-lcd-btn--prov-nav');
            if (focused) {
                btn.style.border = '3px solid #00e676';
                btn.style.boxShadow = '0 0 0 2px rgba(0,230,118,0.45), 0 4px 14px rgba(0,0,0,0.2)';
            } else {
                btn.style.border = '2px solid rgba(255,255,255,0.5)';
                btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
            }
        }
        lcd.appendChild(btn);
        runningX = currentX + btnWidth + buttonGap;
    });

    // WiFi settings: show full focused value on the row immediately above the footer buttons
    if (data.page === 'WIFI_SETTINGS') {
        const menuRowsList = (data.widgets || []).filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
        const focusIdx = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
        const focused = menuRowsList[Math.min(Math.max(0, focusIdx), Math.max(0, menuRowsList.length - 1))];
        const firstBtn = buttonWidgets[0];
        const footerY = firstBtn && firstBtn.y !== undefined ? firstBtn.y : defaultFooterY;
        const footerPad = (data.layout?.footerPadding ?? 0) + (data.layout?.footerBottomPadding ?? 0);
        const buttonTopPx = footerY - footerPad;
        // Keep a small visual gap above the arrow/button row so text doesn't crowd it.
        const previewGapPx = 8;
        const previewTopPx = Math.max(0, buttonTopPx - menuRowPixelHeight - previewGapPx);

        const preview = document.createElement('div');
        preview.className = 'tstat-wifi-focus-preview';
        preview.setAttribute('aria-live', 'polite');
        preview.style.position = 'absolute';
        preview.style.left = '0';
        preview.style.width = '100%';
        preview.style.height = menuRowPixelHeight + 'px';
        preview.style.top = previewTopPx + 'px';
        preview.style.boxSizing = 'border-box';
        preview.style.padding = '4px 10px';
        preview.style.display = 'flex';
        preview.style.alignItems = 'center';
        preview.style.justifyContent = 'center';
        preview.style.fontFamily = data.styles?.fontFamily || 'monospace';
        preview.style.fontSize = '20px';
        preview.style.fontWeight = 'bold';
        preview.style.color = '#fff';
        preview.style.background = 'rgba(0,0,0,0.32)';
        preview.style.borderTop = '1px solid rgba(255,255,255,0.22)';
        preview.style.borderBottom = '1px solid rgba(255,255,255,0.12)';
        preview.style.zIndex = '12';
        preview.style.overflowX = 'hidden';
        preview.style.overflowY = 'hidden';
        preview.style.whiteSpace = 'nowrap';
        preview.style.pointerEvents = 'none';

        if (focused) {
            const live = (data.widgets || []).find(w => w.type === 'menu_row' && w.id === focused.id) || focused;
            const raw = (live.value ?? live.options?.[0] ?? '').toString();
            if (isIpv4RowId(live.id) && window._ipEditMode) {
                const octetIndex = Number(window._ipEditOctetIndex || 0);
                const ipHtml = formatIPv4AlignedHtml(raw, Number.isNaN(octetIndex) ? 0 : octetIndex);
                preview.innerHTML = ipHtml ? `${escapeHtml(live.label)}: ${ipHtml}` : `${escapeHtml(live.label)}: ${escapeHtml(raw)}`;
            } else {
                preview.textContent = `${live.label}: ${raw}`;
            }
        }
        lcd.appendChild(preview);
    }
    setupMainTickerSimulation(data);
    syncThermostatShellLockButtonVisibility();
    injectLcdSnapGridOverlay(lcd, data, lcdCanvasWidth, lcdCanvasHeight);
    applySelectionOutline();
    if (typeof window._syncTstatLcdEdgeDragLayer === 'function') window._syncTstatLcdEdgeDragLayer();
    } finally {
        window._tstatRenderScreenInFlight = false;
        const q = window._tstatRenderScreenQueuedPath;
        window._tstatRenderScreenQueuedPath = null;
        if (typeof q === 'string' && q.length) {
            queueMicrotask(() => renderScreen(q));
        }
    }
}

/**
 * Home screen (MAIN_DISPLAY): SET = setpoint step; FAN/SYS = MSV-style option lists (var2/var3).
 * Setpoint uses step/min/max on main_row_set; fan order matches MODBUS 0–4: OFF, LOW, MED, HIGH, AUTO.
 */
function adjustMainHomeRowValue(origRow, e) {
    const isUp = e.key === 'ArrowUp';
    const normalize = v => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).toLowerCase());

    if (origRow.homeRow === 'setpoint' || origRow.id === 'main_row_set') {
        const step = origRow.step ?? 0.5;
        const min = origRow.min ?? 10;
        const max = origRow.max ?? 35;
        let v = parseFloat(String(origRow.value).replace(',', '.')) || 0;
        const prev = v;
        if (isUp) v = Math.min(max, Math.round((v + step) * 100) / 100);
        else v = Math.max(min, Math.round((v - step) * 100) / 100);
        if (v === prev && ((isUp && prev >= max) || (!isUp && prev <= min))) {
            triggerEndpointFlash(origRow.id);
        }
        origRow.value = v.toFixed(2);
        if (typeof window.updateUI === 'function') window.updateUI({ stp: v });
        return;
    }

    if (origRow.options && origRow.options.length) {
        let currentIdx = origRow.options.findIndex(opt => normalize(opt) === normalize(origRow.value));
        if (currentIdx === -1) currentIdx = 0;
        if (origRow.options.length === 2) {
            origRow.value = String(
                normalize(origRow.value) === normalize(origRow.options[0])
                    ? origRow.options[1]
                    : origRow.options[0]
            );
        } else if (isUp) {
            if (currentIdx < origRow.options.length - 1) currentIdx++;
            else triggerEndpointFlash(origRow.id);
            origRow.value = String(origRow.options[currentIdx]);
        } else {
            if (currentIdx > 0) currentIdx--;
            else triggerEndpointFlash(origRow.id);
            origRow.value = String(origRow.options[currentIdx]);
        }
        const payload = {};
        if (origRow.id === 'main_row_fan') payload.fan = origRow.value;
        if (origRow.id === 'main_row_sys') payload.sys = origRow.value;
        if (typeof window.updateUI === 'function' && Object.keys(payload).length) window.updateUI(payload);
    }
}

function getMenuRows(data) {
    const rows = (data.widgets || [])
        .filter(w => w.type === 'menu_row')
        .sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    if (data.page === 'PROVISIONING_SETUP') return [];
    return rows;
}

function buildLinearFocusMap(menuRows) {
    const map = {};
    for (let i = 0; i < menuRows.length; i++) {
        map[i] = {
            up: (i - 1 + menuRows.length) % menuRows.length,
            down: (i + 1) % menuRows.length
        };
    }
    return map;
}

function getScreenFocusProfile(data, menuRows) {
    const page = data.page;
    const focusMap = buildLinearFocusMap(menuRows);
    // SquareLine-style profile: navigation graph + directional intent per mode/screen.
    if (page === 'SETUP_MENU') {
        return {
            focusMap,
            upDownMovesFocus: true,
            rightBehavior: 'enter-focused',
            leftBehavior: 'navigate-main'
        };
    }
    if (page === 'MAIN_DISPLAY') {
        return {
            focusMap,
            upDownMovesFocus: false,
            rightBehavior: 'advance-focus',
            leftBehavior: 'navigate-setup'
        };
    }
    if (page === 'WIFI_SETTINGS') {
        return {
            focusMap,
            upDownMovesFocus: !window._wifiRowEditMode,
            rightBehavior: 'wifi-edit-or-octet',
            leftBehavior: window._wifiRowEditMode ? 'wifi-exit-edit' : 'navigate-setup'
        };
    }
    return {
        focusMap,
        upDownMovesFocus: false,
        rightBehavior: 'advance-focus',
        leftBehavior: 'navigate-setup'
    };
}

function moveFocusByDirection(focusProfile, focusedIndex, direction) {
    const node = focusProfile.focusMap[focusedIndex];
    if (!node) return focusedIndex;
    return direction === 'up' ? node.up : node.down;
}

function openSetupFocusedRow(menuRows, focusedIndex) {
    const focusedRow = menuRows[focusedIndex];
    if (!focusedRow) return;
    if (focusedRow.id === 'ui_item_rs485') window.navigateTo('settings');
    else if (focusedRow.id === 'ui_item_ethernet') window.navigateTo('ethernet');
    else if (focusedRow.id === 'ui_item_provisioning') window.navigateTo('provisioning');
    else if (focusedRow.id === 'ui_item_clock') window.navigateTo('clock');
    else if (focusedRow.id === 'ui_item_oat') window.navigateTo('oat');
    else if (focusedRow.id === 'ui_item_tbd') window.navigateTo('tbd');
}

function advanceFocusByRight(data, menuRows, focusedIndex) {
    if (!menuRows.length) return focusedIndex;
    const focusedRow = menuRows[focusedIndex];
    if (data.page === 'WIFI_SETTINGS' && focusedRow) {
        if (!window._wifiRowEditMode) {
            window._wifiRowEditMode = true;
            window._ipEditMode = isIpv4RowId(focusedRow.id);
            window._valueEditMode = true;
            if (window._ipEditMode) window._ipEditOctetIndex = 0;
            return focusedIndex;
        }
    }
    // WIFI IPv4 edit mode: Right starts octet edit; then advances octet.
    if (data.page === 'WIFI_SETTINGS' && focusedRow && isIpv4RowId(focusedRow.id)) {
        if (!window._ipEditMode) {
            window._ipEditMode = true;
            window._valueEditMode = true;
            window._ipEditOctetIndex = 0;
            return focusedIndex;
        }
        const currentOctet = Number(window._ipEditOctetIndex || 0);
        window._ipEditOctetIndex = (currentOctet + 1) % 4;
        return focusedIndex;
    }
    if (data.page === 'WIFI_SETTINGS') {
        return focusedIndex;
    }
    window._ipEditMode = false;
    window._ipEditOctetIndex = 0;
    window._valueEditMode = false;
    return (focusedIndex + 1) % menuRows.length;
}

// Combined arrow key handler: handles both menu and redbox movement
function handleArrowKey(e) {
    if (window._isVisualEditMode && e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        if (ungroupMainIcons()) renderScreen(window._currentJsonPath);
        return;
    }
    if (window._isVisualEditMode && e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (regroupMainIcons()) renderScreen(window._currentJsonPath);
        return;
    }

    if (e.key === 'ArrowLeft') {
        _leftArrowDown = true;
        tryStartLeftRightLongPressTimer();
    } else if (e.key === 'ArrowRight') {
        _rightArrowDown = true;
        tryStartLeftRightLongPressTimer();
    }

    // Try redbox movement first (only up/down)
    if (handleRedboxArrowKey(e)) return;
    window._tstatLastEvent = e.key;
    console.log('[KeyEvent]', e.key);

    // Setup entry from keyboard is intentionally guarded by Left+Right long press.

    // Immediately update debug panel after key event
    if (typeof updateDebugPanel === 'function') {
        updateDebugPanel(window._currentScreenData);
    }
    const data = window._currentScreenData;
    if (window._isVisualEditMode) {
        const tag = String(e.target?.tagName || '').toLowerCase();
        const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
        if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            if (typeof window._deleteSelectedLayoutNode === 'function') window._deleteSelectedLayoutNode();
            return;
        }
        if (!isTyping && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (typeof window._undoLayoutChange === 'function') window._undoLayoutChange();
            return;
        }
    }
    if (!data) return;

    if (data.page === 'PROVISIONING_SETUP') {
        if (handleProvisioningArrowKey(e)) return;
    }

    // Only handle menu navigation on screens with menu rows
    const menuRows = getMenuRows(data);
    if (menuRows.length === 0) {
        return;
    }
    let focusedIndex = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
    focusedIndex = ((focusedIndex % menuRows.length) + menuRows.length) % menuRows.length;
    window._currentScreenFocus = focusedIndex;
    const focusProfile = getScreenFocusProfile(data, menuRows);

    if (data.page === 'SETUP_MENU') {
        // Setup Menu logic: Up/Down moves focus, Right selects, Left goes back
        if (e.key === 'ArrowUp') {
            focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'up');
            window._currentScreenFocus = focusedIndex;
            window._ipEditOctetIndex = 0;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowDown') {
            focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'down');
            window._currentScreenFocus = focusedIndex;
            window._ipEditOctetIndex = 0;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowRight') {
            openSetupFocusedRow(menuRows, focusedIndex);
            return;
        } else if (e.key === 'Enter') {
            openSetupFocusedRow(menuRows, focusedIndex);
            return;
        } else if (e.key === 'ArrowLeft') {
            window._ipEditMode = false;
            window._valueEditMode = false;
            window.navigateTo('main');
            return;
        }
    } else {
        // Home (MAIN_DISPLAY): Right cycles focus SET → FAN → SYS; Left opens setup menu; Up/Down reserved
        if (data.page === 'MAIN_DISPLAY') {
            if (e.key === 'ArrowRight') {
                focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'down');
                window._currentScreenFocus = focusedIndex;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (e.key === 'ArrowLeft') {
                /* Home: Left alone does not open Setup — hold Left+Right ~3s (keypad or keyboard) to enter the top-level menu only. */
                return;
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const origRow = data.widgets.find(w => w.type === 'menu_row' && w.id === menuRows[focusedIndex].id);
                if (origRow) adjustMainHomeRowValue(origRow, e);
                renderScreen(window._currentJsonPath);
                return;
            }
            return;
        }
        // Settings Pages Navigation Standard: 
        // Right arrow (NEXT) moves focus to the NEXT item (+1, visually DOWN the list)
        // Left arrow (BACK) exits the current screen and returns to the Setup Menu
        if (e.key === 'ArrowRight') {
            if (data.page === 'WIFI_SETTINGS') {
                const focusedRow = menuRows[focusedIndex];
                if (focusedRow) {
                    if (!window._wifiRowEditMode) {
                        window._wifiRowEditMode = true;
                        window._ipEditMode = isIpv4RowId(focusedRow.id);
                        window._valueEditMode = true;
                        if (window._ipEditMode) window._ipEditOctetIndex = 0;
                    } else if (window._ipEditMode && isIpv4RowId(focusedRow.id)) {
                        window._ipEditOctetIndex = (Number(window._ipEditOctetIndex || 0) + 1) % 4;
                    }
                    renderScreen(window._currentJsonPath);
                }
                return;
            }
            focusedIndex = advanceFocusByRight(data, menuRows, focusedIndex);
            window._currentScreenFocus = focusedIndex;
            window._valueEditMode = false;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowLeft') {
            if (data.page === 'WIFI_SETTINGS' && window._wifiRowEditMode) {
                window._wifiRowEditMode = false;
                window._ipEditMode = false;
                window._valueEditMode = false;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (data.page !== 'WIFI_SETTINGS' && window._valueEditMode) {
                window._valueEditMode = false;
                renderScreen(window._currentJsonPath);
                return;
            }
            window._ipEditMode = false;
            window._valueEditMode = false;
            window.navigateTo('setup');
            return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (data.page === 'WIFI_SETTINGS' && !window._wifiRowEditMode) {
                if (e.key === 'ArrowUp') {
                    focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'up');
                } else {
                    focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'down');
                }
                window._currentScreenFocus = focusedIndex;
                window._ipEditMode = false;
                window._ipEditOctetIndex = 0;
                window._valueEditMode = false;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (data.page !== 'WIFI_SETTINGS') {
                window._valueEditMode = true;
            } else if (window._wifiRowEditMode) {
                window._valueEditMode = true;
            }
            // Change value of focused row only
            // Always operate on the original row in data.widgets for value assignment
            const origRow = data.widgets.find(w => w.type === 'menu_row' && w.id === menuRows[focusedIndex].id);
            if (!origRow) return;
            // Parameters which have only two states, whether they are numeric or text, will toggle with each hit of the up or down button
            if (origRow.options) {
                // Normalize values for robust comparison (trim, string, lowercase)
                const normalize = v => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).toLowerCase());
                let currentIdx = origRow.options.findIndex(opt => normalize(opt) === normalize(origRow.value));
                if (currentIdx === -1) currentIdx = 0;
                // For two-option rows, always toggle regardless of up/down, and always toggle on every press
                if (origRow.options.length === 2 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    let newValue;
                    // Always toggle to the other value
                    if (normalize(origRow.value) === normalize(origRow.options[0])) {
                        newValue = String(origRow.options[1]);
                    } else {
                        newValue = String(origRow.options[0]);
                    }
                    origRow.value = newValue;
                } else if (origRow.options.length > 2 && e.key === 'ArrowUp') {
                    if (currentIdx < origRow.options.length - 1) currentIdx++;
                    else triggerEndpointFlash(origRow.id);
                    origRow.value = String(origRow.options[currentIdx]);
                } else if (origRow.options.length > 2 && e.key === 'ArrowDown') {
                    if (currentIdx > 0) currentIdx--;
                    else triggerEndpointFlash(origRow.id);
                    origRow.value = String(origRow.options[currentIdx]);
                }
            } else if (origRow.id === 'ui_item_addr') {
                let v = Number(origRow.value) || 1;
                const maxValue = origRow.maxValue || 247;
                const minValue = 1;
                if (e.key === 'ArrowUp') {
                    if (v >= maxValue) triggerEndpointFlash(origRow.id);
                    v = v >= maxValue ? maxValue : v + 1;
                } else if (e.key === 'ArrowDown') {
                    if (v <= minValue) triggerEndpointFlash(origRow.id);
                    v = v <= minValue ? minValue : v - 1;
                }
                origRow.value = v;
            } else if (isIpv4RowId(origRow.id)) {
                if (!window._ipEditMode) {
                    renderScreen(window._currentJsonPath);
                    return;
                }
                let parts = String(origRow.value).split('.').map(Number);
                if (parts.length === 4) {
                    let octetIndex = Number(window._ipEditOctetIndex || 0);
                    if (Number.isNaN(octetIndex) || octetIndex < 0 || octetIndex > 3) octetIndex = 0;
                    const prev = Number(parts[octetIndex]) || 0;
                    let next = prev;
                    if (e.key === 'ArrowUp') {
                        next = Math.min(255, prev + 1);
                        if (prev >= 255) triggerEndpointFlash(origRow.id);
                    } else {
                        next = Math.max(0, prev - 1);
                        if (prev <= 0) triggerEndpointFlash(origRow.id);
                    }
                    parts[octetIndex] = next;
                    origRow.value = parts.join('.');
                }
            }
            renderScreen(window._currentJsonPath);
            return;
        }
    }
    // No action for other keys
}

function handleArrowKeyUp(e) {
    if (e.key === 'ArrowLeft') {
        _leftArrowDown = false;
        clearLeftRightLongPressTimer();
    } else if (e.key === 'ArrowRight') {
        _rightArrowDown = false;
        clearLeftRightLongPressTimer();
    }
}

function bindKeyboardHandlersOnce() {
    if (window._tstatKeyboardHandlersBound) return;
    window._tstatKeyboardHandlersBound = true;
    window.addEventListener('keydown', handleArrowKey);
    window.addEventListener('keyup', handleArrowKeyUp);
    window.addEventListener('tstat-lr-menu-longpress', () => performMainDisplayEnterSetupMenu());
    window.addEventListener('blur', () => {
        _leftArrowDown = false;
        _rightArrowDown = false;
        clearLeftRightLongPressTimer();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Restore last edited/visited screen on refresh.
        const startupPath = loadLastScreenPath() || DEFAULT_STARTUP_JSON_PATH;
        window._currentScreenData = null;
        window._lastLoadedJsonPath = null;
        window._currentJsonPath = startupPath;
        window._currentScreenFocus = 0;
        renderScreen(startupPath);
        bindKeyboardHandlersOnce();
    });
} else {
    const startupPath = loadLastScreenPath() || DEFAULT_STARTUP_JSON_PATH;
    window._currentScreenData = null;
    window._lastLoadedJsonPath = null;
    window._currentJsonPath = startupPath;
    window._currentScreenFocus = 0;
    renderScreen(startupPath);
    bindKeyboardHandlersOnce();
}
