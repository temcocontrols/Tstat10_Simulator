/**
 * Screen background authoring limits vs hardware (`main/LcdTheme.h`, ILI9341 RGB565 in `main/lcd.c`).
 * `colorProfile.mode` in JSON: `indexed` (1-bit style, e.g. SSD1306) vs `reduced_rgb` (RGB565 per pixel).
 */
import { TSTAT10_FW_BG_CSS } from './tstat10-firmware-display.js';

const RX_RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/;

export function parseCssColorToRgb888(css) {
    const raw = String(css || '').trim();
    if (!raw) return null;
    const m6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(raw);
    if (m6) {
        return { r: parseInt(m6[1], 16), g: parseInt(m6[2], 16), b: parseInt(m6[3], 16) };
    }
    const m3 = /^#([a-f\d])([a-f\d])([a-f\d])$/i.exec(raw);
    if (m3) {
        return {
            r: parseInt(m3[1] + m3[1], 16),
            g: parseInt(m3[2] + m3[2], 16),
            b: parseInt(m3[3] + m3[3], 16)
        };
    }
    try {
        const el = document.createElement('span');
        el.style.color = '';
        el.style.color = raw;
        if (!el.style.color) return null;
        document.documentElement.appendChild(el);
        const computed = getComputedStyle(el).color;
        el.remove();
        const m = RX_RGB.exec(computed);
        if (!m) return null;
        return {
            r: Math.max(0, Math.min(255, parseInt(m[1], 10))),
            g: Math.max(0, Math.min(255, parseInt(m[2], 10))),
            b: Math.max(0, Math.min(255, parseInt(m[3], 10)))
        };
    } catch {
        return null;
    }
}

export function packRgb565FromRgb888(rgb) {
    const r5 = Math.min(31, Math.max(0, Math.round((rgb.r / 255) * 31)));
    const g6 = Math.min(63, Math.max(0, Math.round((rgb.g / 255) * 63)));
    const b5 = Math.min(31, Math.max(0, Math.round((rgb.b / 255) * 31)));
    return (r5 << 11) | (g6 << 5) | b5;
}

export function rgb565ToCssHex(word) {
    const r5 = (word >> 11) & 0x1f;
    const g6 = (word >> 5) & 0x3f;
    const b5 = word & 0x1f;
    const r = Math.round((r5 / 31) * 255);
    const g = Math.round((g6 / 63) * 255);
    const b = Math.round((b5 / 31) * 255);
    const h = (n) => ('0' + n.toString(16)).slice(-2);
    return `#${h(r)}${h(g)}${h(b)}`;
}

/** Round-trip CSS color through RGB565 (5-6-5); null if `css` is not parseable. */
export function quantizeCssColorToRgb565Hex(css) {
    const rgb = parseCssColorToRgb888(css);
    if (!rgb) return null;
    return rgb565ToCssHex(packRgb565FromRgb888(rgb));
}

/** Monochrome OLED–style: only full black or white. */
export function clampIndexedBackgroundCss(css) {
    const rgb = parseCssColorToRgb888(css);
    if (!rgb) return '#000000';
    const lum = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
    return lum >= 128 ? '#ffffff' : '#000000';
}

export function clampBackgroundToColorMode(css, colorProfileMode) {
    const mode = colorProfileMode === 'indexed' ? 'indexed' : 'reduced_rgb';
    if (mode === 'indexed') return clampIndexedBackgroundCss(css);
    return quantizeCssColorToRgb565Hex(css) ?? TSTAT10_FW_BG_CSS;
}

/**
 * Application + common UI fills from `main/LcdTheme.h` (RGB565). Deduped by word.
 * Stock Tstat UI is built from a small theme; prefer these over arbitrary HTML colors.
 */
export const LCD_THEME_RGB565_SWATCHES = [
    { word: 0x7e19, label: 'Tstat background' },
    { word: 0x3cef, label: 'Menu highlight' },
    { word: 0x7e17, label: 'Menu field' },
    { word: 0xbe9c, label: 'Tangle / accent' },
    { word: 0x4576, label: 'Symbol highlight' },
    { word: 0xffff, label: 'White' },
    { word: 0x0000, label: 'Black' },
    { word: 0x4208, label: 'Dark gray' },
    { word: 0x8410, label: 'Gray' }
];

export const INDEXED_BACKGROUND_SWATCHES = [
    { css: '#000000', label: 'Off (black)' },
    { css: '#ffffff', label: 'On (white)' }
];
