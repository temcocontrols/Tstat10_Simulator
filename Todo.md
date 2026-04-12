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
- [x] **Stricter lint in CI** — **`npm run lint:ci`** (**`eslint --max-warnings=0`**) + **`lint-staged`** aligned.
- [x] **Expand E2E (incremental)** — smoke for top bar + resources strip (basename from **`screens-registry.json`** via **`e2e/registry-helper.mjs`**). Further flows (layout edit, navigate, golden screenshots) still open.

### Correctness & maintainability

- [ ] **JSDoc + `@ts-check`** on **`network-settings-renderer.js`**, **`lcd-editor-core.js`** (incremental typing without a full TS migration).
- [x] **JSON Schema** for screen JSON — validate on load, **`validate:screens`** in CI, **`schemas/widget-types.json`** for widget **`type`** enum.
- [x] **Screen path registry** — **`screens-registry.json`** + **`screen-paths.js`** (**`ROUTE_TO_JSON_PATH`**, **`ROUTE_KEY`**, **`PAGE`**, **`PROJECT_SCREEN_JSON_PATHS`**, **`SAVABLE_SCREEN_FILENAMES`**, …).

### Product / ops

- [x] **`CHANGELOG.md`** — **`[1.0.0]`** (2026-04-10) + **`[Unreleased]`**; **`package.json`** **`version`** **`1.0.0`**; tags / build id in UI still optional.
- [x] **Structured logging** — NDJSON **`logs/browser-console.jsonl`** + pathname / tab session / UA; human **`logs/browser-console.log`**; see **`docs/console-pipe.md`**.
- [x] **Dependabot** — **`.github/dependabot.yml`** (weekly npm). CI already uses **`npm ci`**.

### Authoring & firmware alignment

- [ ] **Golden fixture screens** + snapshot or DOM assertions for MAIN / provisioning after preset changes.
- [x] **ADRs (started)** — [**`docs/adr/0001-defer-frontend-bundler.md`**](docs/adr/0001-defer-frontend-bundler.md). Further ADRs (row pitch, legacy 320×480 scaling) still optional; keep **`agents.md`** short, link out.

### Developer experience

- [x] **`npm run doctor`** — **`tools/doctor.mjs`** (Node version, Husky hook presence).
- [x] **`.vscode/extensions.json`** — recommends **ESLint** extension (with existing **`.vscode/settings.json`**).
- [x] **Newbie onboarding** — **[`GETTING_STARTED.md`](GETTING_STARTED.md)** (what runs automatically), **`npm run setup`**, **`postinstall`** reminder, **[`.vscode/tasks.json`](.vscode/tasks.json)** (Run Task → Simulator…).
- [x] **`doctor --probe`** — **`npm run doctor -- --probe`** hits **`/__tstat_dev_probe`** on **8787** and **8799** (non-fatal if nothing listens). Free-port hint still optional.

### Build (only if needed later)

- [x] **Optional bundler** — **deferred** per [ADR 0001](docs/adr/0001-defer-frontend-bundler.md); revisit only with a concrete requirement.

---

## Mobile Phone App (new)

**Goal:** Use a **phone** to drive the **Tstat10 simulator** (or a thin client around it), join the **thermostat’s provisioning / local AP**, and **send Wi‑Fi credentials** to the device in a flow that mirrors real provisioning—without requiring a laptop on the LAN for that step.

**Tracking:** **[`CHANGELOG.md`](CHANGELOG.md)** (*[Unreleased]*), draft **[`docs/adr/0002-mobile-phone-client.md`](docs/adr/0002-mobile-phone-client.md)**, and **[`Architecture.md`](Architecture.md)** §7 (ADR index).

**Repository:** **This repo** — PWA assets, phone-oriented UX flags, provisioning handoff docs, and tests live alongside the simulator. A **separate repo** is out of scope unless we later choose **store-native** distribution; see **ADR 0002 → Repository**.

**Constraints / assumptions to confirm early:** phone browser vs native wrapper (Capacitor / PWA), TLS on local AP, who hosts the “credential handoff” (phone → tstat vs phone → cloud → tstat), and legal/security review for storing or relaying Wi‑Fi passwords.

### Phase A — Simulator usable from the phone (no new app yet)

- [ ] **A1. LAN URL smoke** — Document and verify: PC runs `npm start`, phone on same Wi‑Fi opens `http://<PC-LAN-IP>:8787/Tstat10.html` (already in **GETTING_STARTED**); add a one-line **Playwright** or manual checklist if desired.
- [ ] **A2. Touch / viewport** — Quick pass on **Tstat10.html** / workbench: scroll, tap targets, no horizontal overflow on narrow width; fix only blocking issues.
- [ ] **A3. Optional PWA shell** — If “add to home screen” matters: minimal **`manifest.webmanifest`** + **service worker** only if offline/cache is required (otherwise skip to reduce scope).

### Phase B — “Phone as remote” to the simulator (still browser)

- [ ] **B1. Deep link / QR** — From PC, show a **QR** or copyable URL that encodes `http://<this-host>:8787/Tstat10.html` so pairing the phone is one scan (could be a tiny dev-only panel or doc page).
- [ ] **B2. Session / role flags (optional)** — Query param or `sessionStorage` flag e.g. `?role=phone` to hide editor chrome and show **large-touch provisioning** UI only (product decision).

### Phase C — Align simulator with real provisioning story (data + UX)

- [ ] **C1. Map JSON ↔ product flow** — Trace **`PROVISIONING_SETUP`** in **`provisioning_setup.json`** + **`network-settings-renderer.js`** vs firmware docs; list gaps (SSID field, password field, “from app” states).
- [ ] **C2. Mock “AP join” in sim** — Extend **`mock_bridge.js`** (or small **HTTP stub**) so the sim can pretend: “phone connected to Tstat AP”, “credential POST received”, “success/fail” — all **localhost**-safe.
- [ ] **C3. Credential API contract** — Write a short **`docs/provisioning-phone-handoff.md`**: endpoints, JSON shape, error codes, idempotency, **no plaintext logging** of passwords in console pipe / logs.

### Phase D — Local AP path (hardware or bridged)

- [ ] **D1. Proof on real AP** — Tstat exposes AP; phone joins; confirm **captive portal** or **HTTP** endpoint behavior as per firmware (document URLs).
- [ ] **D2. Bridge mode (optional)** — If sim cannot join AP: PC **relay** (small Node service) that forwards allowed messages between phone browser and device **only on LAN**; same contract as **C3**.

### Phase E — “Mobile Phone App” deliverable (thin app or PWA)

- [ ] **E1. Choose stack** — Default path: **PWA / same repo**. Only pick **Capacitor/WebView** or **native** if required; if native + separate repo, still publish **JSON contract + fixtures** from **this** repo. Decision note in **`docs/adr/`** when picked.
- [ ] **E2. Implement handoff client** — Minimal UI: select AP / “I’m connected”, enter SSID + password (or receive from OS **Wi‑Fi suggestion APIs** if platform allows), **POST** to contract (**C3**), show success/fail.
- [ ] **E3. Hardening** — HTTPS where required, cert pinning strategy for non-prod, rate limits, clear **privacy** copy (what never leaves the phone).
- [ ] **E4. E2E** — Automated or scripted test: phone-sized viewport + mock bridge proving full happy path (no real password in repo).

**Suggested order:** **A → C (mock)** in parallel with **D** investigations on hardware, then **E** once **C3** is stable.

---

## T3000 / HVC + LCD simulator merge (new)

**Goal:** Reuse **Tstat10 simulator** LCD authoring (JSON, tree, inspector, canvas, themes) inside **T3000**’s **HVC-style** user-graphics tooling, with a **phased** merge (embed → shared library → UX convergence) so we do not fork two incompatible formats.

- **Plan (living doc):** [`docs/plan-t3000-hvc-lcd-merge.md`](docs/plan-t3000-hvc-lcd-merge.md) — overlap matrix, integration patterns, phases **0–5**, risks, open decisions.
- **First execution step:** Phase **0.1–0.4** (inventory HVC stack + JSON gap list + licensing); assign owners in your project tracker.
