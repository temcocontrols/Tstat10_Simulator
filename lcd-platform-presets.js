import { TSTAT10_LEGACY_DEVKIT_LCD_H, TSTAT10_LEGACY_DEVKIT_LCD_W } from './tstat10-firmware-display.js';

/**
 * Popular LCD sizes and common driver chips for target authoring / simulator preview.
 * Logical canvas (width × height) matches firmware framebuffer; `driver` is a hint for export/docs.
 *
 * `colorMode` — suggested Inspector value (`indexed` | `reduced_rgb`): RGB panels use reduced_rgb
 * (RGB565-style authoring); monochrome uses indexed.
 * `paletteNote` — short reminder for designers (limited theme on Tstat10, etc.).
 */
export const LCD_PLATFORM_PRESETS = [
    {
        id: 'custom',
        label: 'Custom (pixel size from screen JSON)',
        width: null,
        height: null,
        driver: '',
        colorMode: null,
        paletteNote:
            'Width and height stay as loaded from this screen JSON. Choose a catalog LCD preset to lock dimensions to that panel + orientation.'
    },
    {
        id: 'tstat10_fw_240',
        label: '240 × 320 — ILI9341 (Tstat10 production, RGB565)',
        width: 240,
        height: 320,
        driver: 'ILI9341',
        colorMode: 'reduced_rgb',
        paletteNote:
            'Full RGB565 (65k colors), but the stock UI uses a small fixed theme (LcdTheme.h). Prefer theme-like fills and high contrast; avoid smooth gradients that quantize badly.'
    },
    {
        id: 'tstat10_sim_320',
        label: '320 × 480 — ST7789 (legacy dev kit portrait)',
        width: TSTAT10_LEGACY_DEVKIT_LCD_W,
        height: TSTAT10_LEGACY_DEVKIT_LCD_H,
        driver: 'ST7789',
        colorMode: 'reduced_rgb',
        paletteNote: 'Typical 16-bit color SPI panel; treat like RGB565 for authoring unless your build uses a different pixel format.'
    },
    {
        id: 'ili9341_320_240',
        label: '320 × 240 — ILI9341 (landscape)',
        width: 320,
        height: 240,
        driver: 'ILI9341',
        colorMode: 'reduced_rgb',
        paletteNote: 'RGB565-class color; keep palettes small for firmware parity.'
    },
    {
        id: 'st7735_128_160',
        label: '128 × 160 — ST7735',
        width: 128,
        height: 160,
        driver: 'ST7735',
        colorMode: 'reduced_rgb',
        paletteNote: 'Small TFT, usually 16-bit or fixed palette depending on init; favor flat colors and large touch targets.'
    },
    {
        id: 'st7789_240_240',
        label: '240 × 240 — ST7789 (round / square)',
        width: 240,
        height: 240,
        driver: 'ST7789',
        colorMode: 'reduced_rgb',
        paletteNote: 'Round displays often need circular safe-area; simulator is rectangular—verify mask in hardware.'
    },
    {
        id: 'ssd1306_128_64',
        label: '128 × 64 — SSD1306 (monochrome)',
        width: 128,
        height: 64,
        driver: 'SSD1306',
        colorMode: 'indexed',
        paletteNote: '1-bit OLED: use indexed color mode and high-contrast two-tone layouts only.'
    },
    {
        id: 'ili9488_480_320',
        label: '480 × 320 — ILI9488',
        width: 480,
        height: 320,
        driver: 'ILI9488',
        colorMode: 'reduced_rgb',
        paletteNote: 'Larger parallel/RGB panels; still use disciplined palettes if firmware uses 16-bit frames.'
    },
    {
        id: 'st7796_320_480',
        label: '320 × 480 — ST7796',
        width: TSTAT10_LEGACY_DEVKIT_LCD_W,
        height: TSTAT10_LEGACY_DEVKIT_LCD_H,
        driver: 'ST7796',
        colorMode: 'reduced_rgb',
        paletteNote: 'Mid-size MIPI/RGB-capable TFT; match your init’s bpp when exporting to device.'
    }
];

export function getLcdPresetById(id) {
    return LCD_PLATFORM_PRESETS.find((p) => p.id === id) || LCD_PLATFORM_PRESETS[0];
}

function presetPhysicalSizeMatchesCanvas(preset, w, h) {
    if (!preset || preset.id === 'custom' || preset.width == null || preset.height == null) return false;
    return (preset.width === w && preset.height === h) || (preset.height === w && preset.width === h);
}

/**
 * Logical canvas size for a preset given stored orientation.
 * Portrait (`vertical`): narrow × tall — min(W,H) × max(W,H).
 * Landscape (`horizontal`): wide × short — max(W,H) × min(W,H).
 */
export function canvasPixelSizeForPresetOrientation(preset, orientation) {
    if (!preset || preset.id === 'custom' || preset.width == null || preset.height == null) return null;
    const min = Math.min(preset.width, preset.height);
    const max = Math.max(preset.width, preset.height);
    const portrait = orientation !== 'horizontal';
    if (portrait) return { width: min, height: max };
    return { width: max, height: min };
}

/** Infer `vertical` | `horizontal` from canvas pixels vs preset native size; `null` if ambiguous or custom. */
export function inferOrientationFromPresetAndCanvas(preset, canvasW, canvasH) {
    if (!preset || preset.id === 'custom' || preset.width == null || preset.height == null) return null;
    const cw = Number(canvasW);
    const ch = Number(canvasH);
    const v = canvasPixelSizeForPresetOrientation(preset, 'vertical');
    const hz = canvasPixelSizeForPresetOrientation(preset, 'horizontal');
    if (v && cw === v.width && ch === v.height) return 'vertical';
    if (hz && cw === hz.width && ch === hz.height) return 'horizontal';
    if (v && hz && v.width === hz.width && v.height === hz.height) return 'vertical';
    return null;
}

/** Pick a preset from stored id only if dimensions still match (including rotated); else match by size; else custom. */
export function resolveLcdPresetSelection(canvasProfile) {
    const w = Number(canvasProfile?.width);
    const h = Number(canvasProfile?.height);
    const pid = canvasProfile?.lcdPresetId;
    /** Explicit **Custom** in the inspector must stay custom (do not auto-upgrade to a catalog match by pixel size). */
    if (pid === 'custom') {
        return LCD_PLATFORM_PRESETS.find((p) => p.id === 'custom') || LCD_PLATFORM_PRESETS[0];
    }
    if (pid && pid !== 'custom') {
        const byId = LCD_PLATFORM_PRESETS.find((p) => p.id === pid);
        if (byId && presetPhysicalSizeMatchesCanvas(byId, w, h)) return byId;
    }
    const bySize = LCD_PLATFORM_PRESETS.find(
        (p) => p.id !== 'custom' && presetPhysicalSizeMatchesCanvas(p, w, h)
    );
    return bySize || LCD_PLATFORM_PRESETS[0];
}
