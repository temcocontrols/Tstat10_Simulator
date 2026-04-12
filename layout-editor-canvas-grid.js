/**
 * LCD layout metrics, color parsing, and snap-grid overlay for visual edit mode.
 * Split from network-settings-renderer.js to keep the main renderer smaller.
 */

import { clampBackgroundToColorMode } from './lcd-authoring-colors.js';
import {
    TSTAT10_LCD_WIDTH,
    TSTAT10_LCD_HEIGHT,
    TSTAT10_FW_BG_CSS
} from './tstat10-firmware-display.js';

const DEFAULT_LCD_W = TSTAT10_LCD_WIDTH;
const DEFAULT_LCD_H = TSTAT10_LCD_HEIGHT;

/** Inspector → Screen: `layout.lcdTextColumns` / `lcdTextRows` bounds (overlay + horizontal snap). */
export const LCD_GRID_COLS_MIN = 4;
export const LCD_GRID_COLS_MAX = 48;
export const LCD_GRID_ROWS_MIN = 4;
export const LCD_GRID_ROWS_MAX = 48;

export function clampGridDimensionInput(value, min, max, fallback) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export function resolvedScreenBackgroundCss(data) {
    const raw = (data?.styles?.bg || TSTAT10_FW_BG_CSS).trim() || TSTAT10_FW_BG_CSS;
    const mode = data?.colorProfile?.mode || 'indexed';
    return clampBackgroundToColorMode(raw, mode);
}

/** Logical canvas width from screen JSON (fallback: `TSTAT10_LCD_WIDTH`). */
export function canvasLogicalWidthPx(data) {
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
export function canvasLogicalHeightPx(data) {
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
export function nearIntPx(a, b, tol = 2) {
    return Math.abs(Number(a) - Number(b)) < tol;
}

/** Parse #rrggbb for grid tinting; returns null if not a 6-digit hex. */
export function parseHexColorRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** `#rrggbb` for `<input type="color">`, or null if the string is not a usable CSS color. */
export function cssColorToHex6ForPicker(css) {
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
export function lcdGridOverlayColorsFromBg(bgCss) {
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

export function injectLcdSnapGridOverlay(lcdEl, screenData, widthPx, heightPx) {
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
