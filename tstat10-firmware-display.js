/**
 * LCD parameters aligned with T3-programmable-controller-on-ESP32 (shared C across product lines):
 *
 * **Product lines (same firmware tree, different UX / mounting):**
 * - **HUM series** — portrait-oriented humidifier / related UI.
 * - **Tstat10 series** — vertical thermostat-style UI (this simulator’s JSON defaults target Tstat10).
 *
 * **Hardware (typical Tstat10 production path):** `main/lcd.c` — ILI9341, SPI GPIO; 0x3A = 0x55 (RGB565);
 * MADCTL (e.g. 0x36 = 0xC8) may vary by SKU or panel mount — confirm per device.
 * **Logical framebuffer** for the stock ClearScreen path: `LCD_SetPos(0,239,0,319)` → **240×320** pixel fill
 * (width × height in the driver’s native portrait window).
 *
 * **Theme:** `main/LcdTheme.h` — stock RGB565 tokens (e.g. background **0x7E19**, row highlight **0x3cef**, primary text white). Use hex values / this file as source of truth for the web sim; ignore obsolete product-specific naming in old C headers if present.
 * **Layout:** `main/LCD_TSTAT.h`, `main/lcd.h` — e.g. CH_HEIGHT 36 for home bands; HUM vs Tstat10 screens differ by menu assets, not necessarily by these constants alone.
 */
export const TSTAT10_LCD_WIDTH = 240;
export const TSTAT10_LCD_HEIGHT = 320;

/** LcdTheme.h background ≈ RGB565 0x7E19 */
export const TSTAT10_FW_BG_CSS = '#7bc2ce';

/** LcdTheme.h menu / selection highlight ≈ RGB565 0x3cef */
export const TSTAT10_FW_HIGHLIGHT_CSS = '#39757b';

/** LcdTheme.h primary label text (white) */
export const TSTAT10_FW_TEXT_CSS = '#ffffff';

/**
 * Default vertical pitch for JSON menu_row placement (10 rows × 32px = 320px).
 * Firmware home rows use CH_HEIGHT (36) + gaps; setup-style lists map well to 32px grid.
 */
export const TSTAT10_MENU_ROW_PX_DEFAULT = 32;

/**
 * Historical web-sim / ST7789-style portrait canvas (320×480). Used only for:
 * - `tstat10_sim_320` preset in `lcd-platform-presets.js`
 * - Scaling legacy stub coordinates (e.g. main icon strip) to the current `TSTAT10_LCD_*` canvas.
 */
export const TSTAT10_LEGACY_DEVKIT_LCD_W = 320;
export const TSTAT10_LEGACY_DEVKIT_LCD_H = 480;
