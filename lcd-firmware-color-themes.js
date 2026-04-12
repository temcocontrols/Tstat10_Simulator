/**
 * Canned LCD color themes aligned with `ThemeList[]` in firmware `main/lcdTheme.c`
 * (same order, RGB565 fields: text, background, backgroundColor1, menu, menu2, border, highlight, error).
 * The simulator maps **background** → `styles.bg` and **backgroundColor1** → `styles.highlight` (menu row band).
 */
import {
    clampBackgroundToColorMode,
    quantizeCssColorToRgb565Hex,
    rgb565ToCssHex,
    parseCssColorToRgb888,
    packRgb565FromRgb888
} from './lcd-authoring-colors.js';
import { TSTAT10_FW_BG_CSS, TSTAT10_FW_HIGHLIGHT_CSS } from './tstat10-firmware-display.js';

/** RGB565 rows: matches `sLcdTheme_t ThemeList[TOTAL_THEMES]` field order in `lcdTheme.c`. */
const THEME_LIST_RGB565 = [
    [0xffff, 0x7e19, 0x3cef, 0x7e17, 0x7e17, 0xbe9c, 0x4576, 0xf800],
    [0xffff, 0x0000, 0x8410, 0x8410, 0x8410, 0x07ff, 0x07ff, 0xf800],
    [0x001f, 0x867d, 0xc618, 0xffff, 0xc618, 0x000f, 0x001f, 0xf800],
    [0xffff, 0x07e0, 0x3cef, 0x7e17, 0x4208, 0x0000, 0x867d, 0xf800],
    [0x0000, 0xffe0, 0xf800, 0xfd20, 0xfb4d, 0xf800, 0xf800, 0xf800],
    [0xffff, 0xf800, 0xfd20, 0xfd20, 0x4208, 0xffe0, 0xffe0, 0x0000],
    [0x0000, 0x07ff, 0x7e17, 0x7e17, 0x0410, 0x000f, 0x000f, 0xf800],
    [0xffff, 0x8000, 0xfb4d, 0xfb4d, 0xfea0, 0xffe0, 0xfea0, 0x0000],
    [0x0000, 0xc618, 0x8410, 0x8410, 0x4208, 0xbe9c, 0x001f, 0xf800],
    [0xffff, 0x8010, 0xbe9c, 0xf81f, 0x4208, 0xbe9c, 0xf81f, 0xf800]
];

const THEME_LABELS = [
    '0 · Classic Light',
    '1 · Classic Dark',
    '2 · Sky',
    '3 · Green Energy',
    '4 · Warning',
    '5 · Fire Alert',
    '6 · Aqua',
    '7 · Royal',
    '8 · Metallic',
    '9 · Violet Accent'
];

export const FIRMWARE_LCD_COLOR_THEME_LIST = THEME_LIST_RGB565.map((row, i) => ({
    id: `fw_theme_${i}`,
    firmwareIndex: i,
    label: THEME_LABELS[i],
    /** Main LCD fill (firmware `backgroundColor`). */
    background565: row[1],
    /** Menu / selection band (firmware `backgroundColor1` → `styles.highlight`). */
    menuHighlight565: row[2]
}));

export const FIRMWARE_LCD_THEME_CUSTOM_ID = 'custom';

/** Stable RGB565 word for picker matching (indexed = black/white only; reduced_rgb = quantized 5-6-5). */
export function stableThemeRgb565Word(css, colorMode) {
    const mode = colorMode === 'indexed' ? 'indexed' : 'reduced_rgb';
    const raw = String(css || '').trim();
    const clamped = clampBackgroundToColorMode(raw || (mode === 'indexed' ? '#000000' : TSTAT10_FW_BG_CSS), mode);
    if (mode === 'indexed') {
        const rgb = parseCssColorToRgb888(clamped);
        return rgb ? packRgb565FromRgb888(rgb) : 0;
    }
    const q = quantizeCssColorToRgb565Hex(clamped) || clamped;
    const rgb = parseCssColorToRgb888(q);
    return rgb ? packRgb565FromRgb888(rgb) : null;
}

/**
 * @returns {string} theme `id` or `FIRMWARE_LCD_THEME_CUSTOM_ID`
 */
export function findMatchingFirmwareThemeId(data) {
    if (!data) return FIRMWARE_LCD_THEME_CUSTOM_ID;
    const mode = data.colorProfile?.mode || 'indexed';
    const curBg = data.styles?.bg;
    const curHl = data.styles?.highlight != null ? data.styles.highlight : TSTAT10_FW_HIGHLIGHT_CSS;
    const wBg = stableThemeRgb565Word(curBg || TSTAT10_FW_BG_CSS, mode);
    const wHl = stableThemeRgb565Word(curHl, mode);
    if (wBg == null || wHl == null) return FIRMWARE_LCD_THEME_CUSTOM_ID;

    for (const t of FIRMWARE_LCD_COLOR_THEME_LIST) {
        const tBg = stableThemeRgb565Word(rgb565ToCssHex(t.background565), mode);
        const tHl = stableThemeRgb565Word(rgb565ToCssHex(t.menuHighlight565), mode);
        if (tBg === wBg && tHl === wHl) return t.id;
    }
    return FIRMWARE_LCD_THEME_CUSTOM_ID;
}

/**
 * Apply a firmware theme row to screen JSON. Sets `colorProfile.mode` to `reduced_rgb` so palette matches hardware.
 * @returns {boolean} false if theme id unknown
 */
export function applyFirmwareColorThemeToScreenData(data, themeId) {
    const theme = FIRMWARE_LCD_COLOR_THEME_LIST.find((t) => t.id === themeId);
    if (!theme || !data) return false;

    if (!data.styles) data.styles = {};
    if (!data.colorProfile) data.colorProfile = {};
    data.colorProfile.mode = 'reduced_rgb';
    const mode = 'reduced_rgb';

    const bg = clampBackgroundToColorMode(rgb565ToCssHex(theme.background565), mode);
    const hl = clampBackgroundToColorMode(rgb565ToCssHex(theme.menuHighlight565), mode);
    data.styles.bg = bg;
    data.styles.highlight = hl;
    if (!data.colorProfile.themeTokens) data.colorProfile.themeTokens = {};
    data.colorProfile.themeTokens.bg = bg;
    data.colorProfile.themeTokens.accent = hl;
    return true;
}
