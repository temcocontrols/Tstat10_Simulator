# Tstat10 UI Prototype



## Upcoming Features

We will be adding new features to our HVAC drawing tools, including utilities to configure the LCD (display) and menu system for both Tstat10 and Tstat11. These tools will let users configure their own custom menu systems on the thermostats at runtime, and the stock menu system is also configurable with these tools. The resulting menu structures and behaviors are stored directly on the device and in program files, allowing for flexible, user-defined interfaces and logic.

Stay tuned for updates as these tools are integrated into the project!

## LCD Editor Prototype (New)

**Conventions (typography, footer hierarchy, persistence):** see [`agents.md`](agents.md).  
**LCD alignment (row grid, footer row drag, `menuRowPixelHeight`):** this is a recurring topic — see **item 11** in [`agents.md`](agents.md).  
**LCD preset, immediate resize, and Apply layout:** see **item 14** in [`agents.md`](agents.md).  
**Background palette (indexed vs RGB565) and alignment grid columns/rows:** see **items 15–16** in [`agents.md`](agents.md).  
**Firmware color themes (canned palettes, project-wide):** see **item 19** in [`agents.md`](agents.md).  
**Fixed LCD 240×320 + global workbench nudge on every page:** see **item 20** in [`agents.md`](agents.md).

The simulator now includes an initial LCD editor panel in the debug UI:

- **Three surfaces, one selection:** In layout edit mode you can edit from the **hierarchy tree** (select / double-click rename for `treeName`, DnD), the **LCD** and **device shell** (select via `data-tree-node-id`), and the **Inspector** (typed fields for the selected node plus **Screen** for page-level canvas/theme). All use **`window._layoutSelectedNodeId`** on the same JSON — see **item 4** in [`agents.md`](agents.md). Changing selection from **any** of those views **right away** updates the **other** panels (tree highlight + inspector); the debounced full `renderScreen` only staggers LCD DOM rebuild for double-click safety. When the inspector body is **rebuilt** (`renderLayoutPropertiesPanel`), the right pane may **flash briefly**; that is expected, not a glitch.
- **LCD & driver** — dropdown presets in the Screen inspector ([`lcd-platform-presets.js`](lcd-platform-presets.js)): common resolutions (e.g. **240×320 ILI9341** production, **320×480** dev kit), suggested **color mode**, and `compatibility.lcdDriver` for documentation/export.
- **Immediate LCD preview:** Changing the **LCD & driver** preset or **orientation** (portrait vs landscape) updates `canvasProfile` width/height and re-renders the LCD; the inspector shows **Canvas (pixels)** as read-only. Catalog presets use preset-native dimensions; **custom** swaps the shorter/longer side for portrait vs landscape. Widget positions are **not** auto-scaled until you use **Apply layout**.
- **Apply layout** (Inspector → Screen) — scales layout metrics and widget pixel geometry from the last **remap baseline** to the current canvas (see `applyLayoutRemapToMatchCanvas` in [`lcd-editor-core.js`](lcd-editor-core.js)). After big changes, some elements may still be off-screen; adjust them manually. Row slots (`lcdRow`) are not remapped.
- **Snap grid** (Inspector → Screen) — toggles the alignment grid on the LCD. **Grid columns** and **Grid rows** edit `layout.lcdTextColumns` and `layout.lcdTextRows` (defaults 16×10): they set overlay cell size (canvas ÷ grid) and horizontal snap step (quarter-character = width ÷ columns ÷ 4). Values are clamped 4–48 and saved with the screen JSON. Grid wash and lines are tinted from the screen **background** color (`lcdGridOverlayColorsFromBg`, `injectLcdSnapGridOverlay` in `network-settings-renderer.js`). When snap is off, the overlay is removed.
- **Background** (Inspector → Screen) — edits `styles.bg` (CSS color string, e.g. `#7bc2ce`, firmware background ≈ RGB565 `0x7E19`); drives the LCD fill and the grid tint.
- **Color theme** (Inspector → Screen) — dropdown **`#editor-lcd-firmware-theme`**: ten canned themes from firmware **`ThemeList[]`** ([`lcd-firmware-color-themes.js`](lcd-firmware-color-themes.js)), aligned with ESP32 **`main/lcdTheme.c`**. Applies **`styles.bg`** + **`styles.highlight`** (menu-row band), sets **`colorProfile.mode`** to **`reduced_rgb`**, updates **`colorProfile.themeTokens`**, and pushes the same pair to **all cached** screen JSON files in the project list (see **item 19** in [`agents.md`](agents.md)). **Custom** means colors were edited manually (swatches / text / picker) and no longer match a canned pair.
- **Production target:** ESP32 firmware logical framebuffer is **240×320** (ILI9341). The hosted simulator **locks** the live LCD to that size on every page (**[`agents.md`](agents.md)** item **20**); larger presets in JSON are mainly for alternate-panel **authoring** / export workflows, not a different on-screen pixel size when switching routes.
- Set orientation (`vertical` or `horizontal`)
- Set color mode (`indexed` or `reduced_rgb`)
- Apply settings to the active screen JSON in memory
- Run phase-1 validation checks for Tstat10-safe constraints
- Review SquareLine tool; use it for inspiration for our editor.
- We will not export to C code as SquareLine does; we export to JSON and from there convert to a binary blob for the Tstat. Next step: implement the renderer in C on the Tstat10 / 11.

## Quick start (beginners)

**Use this path first** — lint, hooks, and browser tests are set up to run mostly on their own:

1. Install [Node.js](https://nodejs.org/) **LTS (v20+)**.
2. In a terminal, `cd` to this folder (where `package.json` lives).
3. Run:
   ```bash
   npm install
   npm run setup
   npm start
   ```
4. Open the URL printed in the terminal (usually **http://127.0.0.1:8787/Tstat10.html**).

**Step-by-step help, troubleshooting, and what runs automatically:** see **[`GETTING_STARTED.md`](GETTING_STARTED.md)**. **Release notes (draft):** [`CHANGELOG.md`](CHANGELOG.md).

**In VS Code / Cursor:** Command Palette → **Tasks: Run Task** → pick **Simulator: Start dev server** or **Simulator: First-time setup**.

---

### After you’re running

1. Press **'D'** in the browser to simulate live temperature drift.
2. Click the **IP Address** at the bottom to flip to the Settings screen.
3. Use **Inspector → Screen** for LCD preset, orientation, **Snap grid**, **Background**, and **Color theme**. Use the **Debug** panel (left of LCD) for **Coords**, **Redbox**, and **Auto test**; it also shows live event, focus, value, and redbox coordinates.
4. The redbox overlay highlights a specific LCD cell for alignment/debugging. Auto tester can be toggled at runtime.

### Optional — save edited JSON to disk

The UI can POST to port **5001**. In another terminal:

```powershell
cd C:\Xdrive\Tstat10_Simulator
npm run save-server
```

If the save server is not running, edits fall back to `localStorage` (see browser console).

### Older workflow (not recommended for contributors)

Opening **`Tstat10.html`** via **Live Server** or `python -m http.server` can work for a quick peek, but you lose the dev-only **console pipe** and the same environment **CI** uses. Prefer **`npm start`** above; see **`agents.md`** §13.

## Project Structure

* `Tstat10.html`: The HTML5 structure (The "Shell").

* `style.css`: Pixel-perfect **240×320** LCD shell CSS (The "Look"), aligned with the ILI9341 viewport.

* `mock_bridge.js`: Simulation logic for T3000 testing (The "Brain").

* `Architecture.md`: Integration guide for T3000/Webview.

