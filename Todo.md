# Tstat10 Simulator — follow-up work

Logical next steps from the LCD / firmware-display hygiene thread (`tstat10-firmware-display.js`, `lcd-editor-core.js`, presets).

## 1. ~~Smoke + lint~~ **DONE**

- [x] **Lint:** **`npm run lint`** — ESLint 9 flat config (**`eslint.config.mjs`**: `@eslint/js` + **`globals`**, browser ESM for root `*.js`, Node for **`tools/*.mjs`**, **`save-server.mjs`**, **`playwright.config.mjs`**; ignores **`ScreenShots/**`**, **`playwright-report/**`**, **`e2e/**`**, **`Tstat10,code-workspace.js`**). Also **`node --check`** on the same sources (excluding the workspace stub file).
- [x] **ESM graph:** `node --input-type=module` dynamic **`import()`** of **`lcd-platform-presets.js`** (pulls in **`tstat10-firmware-display.js`**) and **`menu-ui.js`** — both resolved (only benign `MODULE_TYPELESS_PACKAGE_JSON` warnings until `"type": "module"` is added to `package.json`).
- [x] **Dev server smoke:** `OPEN_BROWSER=0` **`node tools/dev-server.mjs`** on port **8877**; **HTTP 200** on **HEAD** for **`/Tstat10.html`**, **`/main_display.json`**, **`/provisioning_setup.json`**, **`/network-settings-renderer.js`**, **`/lcd-platform-presets.js`**, **`/tstat10-firmware-display.js`**, **`/lcd-editor-core.js`**.

## 2. ~~Stragglers (theme + literals)~~ **DONE**

- [x] Replaced **`#008080`** fallbacks with **`TSTAT10_FW_HIGHLIGHT_CSS`** in **`menu-ui.js`** and **`network-settings-renderer.js`**; **`Menu_NetworkSettings.json`** **`styles.highlight`** set to **`#39757b`** (matches other screen JSON + `LcdTheme.h` note in docs).
- [x] Grep pass: no remaining **`|| 320` / `|| 480`** or **`menuRowPixelHeight … || 48`** in other `*.js`; **`lcd-editor-core.js`** already uses **`TSTAT10_MENU_ROW_PX_DEFAULT`**. Intentional **`320`/`480`** only in **`tstat10-firmware-display.js`** / **`lcd-platform-presets.js`** / legacy-scaled paths in **`network-settings-renderer.js`**.

## 3. ~~`network-settings-renderer.js` deep pass~~ **DONE**

Completed: single logical canvas helpers (**`canvasLogicalWidthPx` / `canvasLogicalHeightPx`**), **`TSTAT10_MENU_ROW_PX_DEFAULT`** instead of 48px row fallback, removed **`|| 320` / `|| 480`** in favor of firmware defaults + JSON, **legacy 320×480-relative** UI scaled via **`TSTAT10_LEGACY_DEVKIT_LCD_*`** for main icon ungroup/regroup, provisioning RSSI/heal + buttons, **`renderMainIconsGroupText`** flex metrics, and **lens outline** dimensions.

---

## 4. Long-term “pro package” roadmap

High-level goals from the product/engineering discussion. **Started (this sprint):** CI, Playwright smoke, **`npm run doctor`**, recommended VS Code extensions.

### Quality gates

- [x] **GitHub Actions CI** — **`.github/workflows/ci.yml`**: `npm ci`, **`npm run lint`**, **`npm run doctor`**, **`node --check`** on key modules, **Playwright** Chromium smoke (`npm run test:e2e`).
- [x] **Playwright smoke** — **`e2e/smoke.spec.mjs`** + **`playwright.config.mjs`** (dev server via `webServer` on **port 8799** to avoid clashing with **`npm start`** on **8787**). Local: **`npm run test:e2e:install`** once, then **`npm run test:e2e`**.
- [ ] **Stricter lint in CI** — e.g. **`eslint --max-warnings=0`** after clearing current warnings.
- [x] **Expand E2E (incremental)** — second smoke: **`.sls-topbar__brand`** + resources strip contains **`main_display.json`**. Further flows (layout edit, navigate) still open.

### Correctness & maintainability

- [ ] **JSDoc + `@ts-check`** on **`network-settings-renderer.js`**, **`lcd-editor-core.js`** (incremental typing without a full TS migration).
- [ ] **JSON Schema** for screen JSON — validate on load/save in dev + optional CI step.
- [x] **Screen path registry** — **`screen-paths.js`** (**`ROUTE_TO_JSON_PATH`**, **`PROJECT_SCREEN_JSON_PATHS`**, **`SAVABLE_SCREEN_FILENAMES`**).

### Product / ops

- [x] **`CHANGELOG.md`** stub (Unreleased section); tags / build id in UI still optional.
- [ ] **Structured logging** — levels + correlation for console pipe / **`logs/browser-console.log`**.
- [x] **Dependabot** — **`.github/dependabot.yml`** (weekly npm). CI already uses **`npm ci`**.

### Authoring & firmware alignment

- [ ] **Golden fixture screens** + snapshot or DOM assertions for MAIN / provisioning after preset changes.
- [ ] **ADRs** for big decisions (row pitch, legacy 320×480 scaling) — keep **`agents.md`** short, link out.

### Developer experience

- [x] **`npm run doctor`** — **`tools/doctor.mjs`** (Node version, Husky hook presence).
- [x] **`.vscode/extensions.json`** — recommends **ESLint** extension (with existing **`.vscode/settings.json`**).
- [x] **Newbie onboarding** — **[`GETTING_STARTED.md`](GETTING_STARTED.md)** (what runs automatically), **`npm run setup`**, **`postinstall`** reminder, **[`.vscode/tasks.json`](.vscode/tasks.json)** (Run Task → Simulator…).
- [x] **`doctor --probe`** — **`npm run doctor -- --probe`** hits **`/__tstat_dev_probe`** on **8787** and **8799** (non-fatal if nothing listens). Free-port hint still optional.

### Build (only if needed later)

- [ ] **Optional bundler** (esbuild/rollup) if you need minification, tree-shaking, or npm deps in the browser bundle.
