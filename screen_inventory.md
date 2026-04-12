# Tstat10 Screen Inventory

**Machine source of truth:** [`screens-registry.json`](screens-registry.json) — ordered list of `routeKey`, `page` (JSON id), `displayName`, and `jsonPath`. [`screen-paths.js`](screen-paths.js) imports the registry from [`screens-registry.embedded.mjs`](screens-registry.embedded.mjs) (generated from the JSON by `npm run build:schema-validator`) and builds `ROUTE_TO_JSON_PATH`, `ROUTE_KEY`, `PAGE`, `SETUP_MENU_ROW_TO_ROUTE`, `PROJECT_SCREEN_JSON_PATHS`, `SCREENS_BY_PAGE`, and related exports.

**Widget `type` allowlist** for screen JSON lives in [`schemas/widget-types.json`](schemas/widget-types.json); it is merged into the JSON Schema at the same codegen step.

This document is the human-oriented summary so we use one shared vocabulary in discussions, tickets, and commits.

## Naming Convention

- Use **Display Name** for product/demo discussions (same string as `displayName` in the registry when possible).
- Use **Screen Key** for navigation and code (`navigateTo('<key>')`) — same as **`routeKey`** in the registry.
- Use **Page ID** for JSON-level references (`"page": "..."`).

**Canvas size in the simulator:** On every screen load / render, **`enforceSimulatorFixedLcdCanvas`** (see [`AGENTS.md`](AGENTS.md) item **20**) forces the **same** logical framebuffer for **every** route: **240×320** portrait, **`lcdPresetId`: `tstat10_fw_240`**, with **`layout.lcdCanvas`** / **`layout.canvas`** kept in sync. The hosted sim does **not** change LCD pixel size or orientation when you navigate between pages. Inspector **LCD & driver** / **orientation** still edit JSON in memory (and **Apply layout** still rescales widget geometry per item **14** when you change canvas authoring size), but the **live** `#tstat-lcd-container` slot stays production-sized until that rule changes. **Workbench nudge** (LCD translate in the shell) is **global** across pages (`tstat10_lcd_bezel_nudge_px` in `ui-bridge.js`; same item **20**). **Color theme** (Inspector → Screen) batch-updates **background + row highlight** across cached project screens (see [`AGENTS.md`](AGENTS.md) item **19**).

## Active Screens

See **`screens-registry.json`** → `screens` for the canonical rows. Summary:

| Display Name | Screen Key | Page ID | Source JSON | Notes |
|---|---|---|---|---|
| Home | `main` | `MAIN_DISPLAY` | `main_display.json` | Main thermostat display with SET/FAN/SYS rows |
| Setup menu | `setup` | `SETUP_MENU` | `setup_menu.json` | Entry hub for setup sub-pages |
| RS485 settings | `settings` | `RS485_SETTINGS` | `network_settings.json` | Protocol/NetID/Baud setup |
| Wi-Fi setup | `ethernet` | `WIFI_SETTINGS` | `ethernet_setup.json` | IP/Mask/Gateway/DHCP setup |
| Provisioning | `provisioning` | `PROVISIONING_SETUP` | `provisioning_setup.json` | Phone-link/manual credential onboarding flow |
| Clock setup | `clock` | `CLOCK_SETTINGS` | `clock_setup.json` | Date/time setup |
| Outside air temp | `oat` | `OAT_SETTINGS` | `oat_setup.json` | OAT value and offset |
| To be done | `tbd` | `TBD_SETTINGS` | `tbd_setup.json` | Placeholder page for future features |

## Current Navigation Flow

- `Home` (`main`) + **Left** => `Setup Menu` (`setup`)
- `Setup Menu` + **Right/Enter** on focused item => selected sub-screen
- Settings sub-screens (`settings`, `ethernet`, `provisioning`, `clock`, `oat`, `tbd`) + **Left** => `Setup Menu`
- `Setup Menu` + **Left** => `Home`

## Legacy/Reference JSON

- `Menu_NetworkSettings.json` (`page: NETWORK_SETTINGS`) exists as an older prototype definition.
- It is currently not part of the active `navigateTo()` screen map.

## Layout JSON notes (hierarchy)

- **Footer button row:** On setup-style screens, the four hardware keys should be grouped in the editor tree under a logical parent: `type: "box"`, `id: "footer_buttons_group"`, optional `treeName: "Footer buttons"`, with each button widget using `"parentId": "footer_buttons_group"`. See [`AGENTS.md`](AGENTS.md) for why and how to add other tree-only folders.
- **Row grid / alignment:** Vertical layout in the editor follows a fixed LCD row pitch (default **32px**, `TSTAT10_MENU_ROW_PX_DEFAULT` in `tstat10-firmware-display.js`). Optional `layout.menuRowPixelHeight` in JSON; footer keys on the same `lcdRow` + `parentId` move as one row in edit mode. This is documented as a recurring issue in [`AGENTS.md`](AGENTS.md) (item 11).

## Layout inspector — Screen (simulator)

These controls live in **`#layout-props-screen-section`** (`Tstat10.html`) and map to JSON as follows:

| UI control | Effect |
|---|---|
| **LCD & driver** | Select `id="editor-lcd-preset"` — options from [`lcd-platform-presets.js`](lcd-platform-presets.js). For non-custom presets, sets `canvasProfile.width` / `height` from preset + **orientation**; optional `colorProfile.mode` (`indexed` vs `reduced_rgb`), `canvasProfile.lcdPresetId`, and `compatibility.lcdDriver` (string hint for export/docs). Hint text: `#editor-lcd-preset-hint` (`paletteNote` per preset). |
| **Canvas (pixels)** / **Orientation** / **Color mode** | Readout `id="editor-canvas-size-readout"` (not editable) sits under **LCD & driver**; then `id="editor-orientation"` and `id="editor-color-mode"` on one row. Values map to `canvasProfile` / `colorProfile` and are canonicalized to `layout.lcdCanvas` / `layout.canvas` via `ensureCanonicalSchema` in `lcd-editor-core.js`. `#tstat-lcd-container` is sized to width/height on each render. |
| **Snap grid** | Checkbox `id="toggle-grid-layer"`; `window._tstatShowGridLayer`. When on, `injectLcdSnapGridOverlay` in `network-settings-renderer.js` draws a full-size `.debug-grid` over the LCD using `layout.lcdTextRows` × `layout.lcdTextColumns`. Wash and line colors are derived from `styles.bg` (`lcdGridOverlayColorsFromBg`). |
| **Grid columns / rows** | Inputs `id="editor-grid-cols"` and `id="editor-grid-rows"` (4–48). Same `layout.lcdTextColumns` / `lcdTextRows` as the overlay; horizontal edit snap uses `canvas width ÷ lcdTextColumns` (quarter-cell steps). See [`AGENTS.md`](AGENTS.md) item **16**. |
| **Background** | Input `id="editor-screen-bg"` → `styles.bg` (CSS color). Default / firmware parity: `TSTAT10_FW_BG_CSS` in [`tstat10-firmware-display.js`](tstat10-firmware-display.js) (`#7bc2ce`, LcdTheme.h background ≈ RGB565 `0x7E19`). Updates the LCD fill and snap-grid tint. |
| **Color theme** | Select `id="editor-lcd-firmware-theme"` — options from [`lcd-firmware-color-themes.js`](lcd-firmware-color-themes.js) (firmware **`ThemeList[]`** in `main/lcdTheme.c`, same order). Sets `styles.bg`, `styles.highlight`, `colorProfile.mode` (`reduced_rgb`), and `colorProfile.themeTokens.bg` / `.accent`. **Custom** = no canned match. On apply, **`propagateProjectWideFirmwareTheme`** merges the same bg/highlight/mode into every JSON path in [`screen-paths.js`](screen-paths.js) `PROJECT_SCREEN_JSON_PATHS` that is already in `localStorage` cache; fetches and caches missing paths in the background. Hint: `#editor-lcd-firmware-theme-hint` in `Tstat10.html`. |
| **`MAIN_DISPLAY` sizing** | Same as every other active screen in the simulator: the LCD is always **240×320** portrait in the preview shell (see [`AGENTS.md`](AGENTS.md) item **20**). |

## Layout editor — selection and inspector (simulator)

**Three places to edit (same JSON):** authors work across **(1) hierarchy tree**, **(2) on-LCD widgets** (and shell chrome with `data-tree-node-id`), and **(3) Inspector fields** — all tied to **`window._layoutSelectedNodeId`** and **`window._currentScreenData`**. A selection change from any surface **immediately** refreshes the tree row highlight and inspector; the debounced **`renderScreen`** only delays rebuilding the LCD DOM. See **[`AGENTS.md`](AGENTS.md) item 4** for the full contract (`selectLayoutNode`, `applySelectionOutline`, `renderLayoutTreePanel`, `renderLayoutPropertiesPanel` in `network-settings-renderer.js`).

**Draft vs repo files:** the browser keeps a **`localStorage`** copy per screen path (`tstat_cache_…`) and prefers it on load so background / theme / workbench LCD nudge (`canvasProfile.previewOffset*`) do not disappear after a refresh or leaving edit mode. Use **`npm run save-server`** to persist to disk; clear storage to re-read stock JSON from the server.

- **Tree:** single-click selects a node; double-click a widget **label** in the tree to edit **`treeName`**; DnD for reorder/reparent where implemented.  
- **LCD:** single-click selects (elements expose **`data-tree-node-id`**); drag, handles, context menus, and inline text on supported widgets edit geometry/copy on the preview.  
- **Inspector:** `#layout-props-content` shows **properties for the selected node**; `#layout-props-screen-section` holds **page-level Screen** controls (LCD preset, canvas readout, orientation, color mode, grid, background, firmware theme).  
- **Inspector “flash”:** each selection change runs **`renderLayoutPropertiesPanel`**, which **replaces** the inspector body. A quick visual flicker when switching widgets is **normal** until the UI is refactored to patch fields in place — do not treat it as a bug by default.

## Recommendation

For consistency in new docs and issues, use these exact labels:

- Home
- Setup Menu
- RS485 Settings
- WiFi Setup
- Provisioning
- Clock Setup
- Outside Air Temp
- To Be Done
