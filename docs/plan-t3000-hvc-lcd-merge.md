# Plan: Merge Tstat10 LCD simulator tools with T3000 / HVC draw (PC graphics authoring)

This document is a **working integration plan**: how to bring **LCD-centric, JSON-first** tools from this repo together with **T3000’s PC browser / HVC-style** user-graphics authoring, where overlap is high but hosting, lifecycle, and I/O differ.

**Related repos (external):** [T3000 Building Automation System](https://github.com/temcocontrols/T3000_Building_Automation_System) (Windows + **WebView2**), [T3000Webview](https://github.com/temcocontrols/T3000Webview) (cross-platform web shell). This plan assumes we can add dependencies or submodules **only after** licensing and release ownership are agreed.

---

## 1. Goals and success criteria

| Goal | Measurable outcome |
|------|-------------------|
| **Single authoring vocabulary** | Same **screen JSON** shape (or documented superset with migration) for “draw in HVC” and “preview on Tstat10 LCD”. |
| **Reuse high-value UI** | Tree / inspector / canvas behaviors from the sim **without** rewriting in C# or a second framework—prefer **embed** or **shared JS package**. |
| **T3000 ships one story** | From T3000, user opens “LCD layout” → edits → saves to project / device path T3000 already uses—**no manual copy** of JSON between tools long term. |
| **Safe incremental merge** | Each phase ships **behind a flag** or separate menu until parity is proven. |

---

## 2. What each side brings today (high level)

### Tstat10 simulator (this repo)

- **Fixed logical LCD** (240×320 product frame), **absolute-position** widgets, **screen JSON** + `widgets[]`, **visual edit** (tree, inspector, on-LCD selection), **theme / preset** plumbing (`lcd-editor-core.js`, `lcd-platform-presets.js`, `lcd-firmware-color-themes.js`).
- **Browser-first**: native ESM, `tools/dev-server.mjs`, optional **console pipe**, **Playwright** smoke, **JSON schema** validation (`screens-registry.json`, `schemas/`).
- **Bridge / mock** patterns for device-ish flows (`mock_bridge.js`, provisioning flows in `network-settings-renderer.js`).

### T3000 + HVC-style “draw app” (assumptions to validate in their codebase)

- **Desktop shell** (WebView2) driving **hosted** or **packaged** HTML/JS for configuration UIs.
- **HVC / user graphics**: likely **vector or page-layout** metaphors (zoom, layers, snapping) that may **not** start from fixed 240×320—needs **mapping** to LCD pixel space or a dedicated “LCD mode” artboard.
- **Data path**: BACnet/Modbus + `ExecuteScriptAsync()` today—**not** the same as `POST /save_settings` in the sim; merge must define **one save pipeline** per environment (dev vs field).

**Action (Phase 0):** assign someone to produce a **2–4 page inventory** from T3000/HVC: tech stack (framework, bundler), file formats on disk, and how graphics are bound to a controller/tstat.

---

## 3. Overlap matrix (reuse vs reinvent)

| Capability | Tstat10 sim | HVC / T3000 UI | Merge tactic |
|------------|-------------|----------------|--------------|
| **Widget list / hierarchy** | Layout tree, shell tree | Likely layer/object list | **Reuse** tree model patterns (`layout-tree-model.js`) or embed full panel. |
| **Property inspector** | Screen + widget props | Object props | **Reuse** inspector patterns; map property schema per widget type. |
| **Pixel canvas / grid** | LCD framebuffer, snap grid | May be infinite canvas | **Constrain** HVC “LCD mode” artboard to **logical resolution** + same grid constants; or **export** to sim JSON. |
| **Theme / colors** | Firmware theme list, RGB565 alignment | May use generic palette | **Share** `lcd-firmware-color-themes.js` + naming; avoid duplicate swatch tables. |
| **Save / load** | JSON files + optional save server | Project DB / files | **Adapter layer** in T3000: same JSON in/out, different persistence backend. |
| **Preview on device** | Mock + optional real network | Real device path exists | **Unify** “preview payload” contract so WebView2 and sim use identical JSON package. |

---

## 4. Integration patterns (pick one primary; combine others later)

Ranked from **lowest risk** to **highest leverage**:

1. **Embed (recommended first step)**  
   T3000 WebView2 loads **packaged** `Tstat10.html` (or a **trimmed** `lcd-workbench.html`) from `file://` or `https://appassets/` + `postMessage` / `ExecuteScriptAsync` for JSON get/set. **No shared repo merge yet**—artifact copy or submodule build output.

2. **Shared “LCD toolkit” package**  
   Extract **schema + non-DOM utilities** (`lcd-editor-core.js`, color themes, grid math, validators) into a small **npm package** or **git submodule** consumed by both repos. Keep **DOM-heavy** code in sim until APIs are stable.

3. **Monorepo / single workspace**  
   Move sim under `T3000/` (or inverse). Highest coordination cost; do **after** 1–2 prove embed + package.

4. **Headless service**  
   Sim runs as local Node **layout service** (validate + remap only); T3000 draws vectors and calls service to **rasterize / compile** to JSON. Use only if HVC cannot adopt fixed-coordinate editing.

---

## 5. Phased roadmap (small steps)

### Phase 0 — Discovery (1–2 weeks, parallel)

- [ ] **0.1** HVC stack doc: bundler, where HTML lives, how assets ship, how save works.  
- [ ] **0.2** List **must-keep** HVC features vs **nice** sim features (avoid boiling the ocean).  
- [ ] **0.3** Legal: license compatibility (MIT sim vs T3000), **contribution path** (submodule vs copy).  
- [ ] **0.4** **JSON diff**: export one HVC screen vs one `main_display.json` — field gap list drives schema (`schemas/tstat10-screen.schema.json`) evolution.

### Phase 1 — Contract freeze (short)

- [ ] **1.1** Publish **`docs/provisioning-phone-handoff.md`-style** doc for **“LCD layout interchange”**: top-level keys, widget `type` enum (`schemas/widget-types.json`), versioning (`schemaVersion`).  
- [ ] **1.2** **Version gate**: T3000 sends `schemaVersion`; sim refuses or migrates explicitly.

### Phase 2 — Embed pilot (vertical slice)

- [ ] **2.1** Build **static bundle** of sim **read-only** (no dev server): open in WebView2 inside T3000 **hidden feature flag**.  
- [ ] **2.2** **Bridge**: `window.chrome.webview.postMessage` / `ExecuteScriptAsync` round-trip: load JSON string → render → return edited JSON string.  
- [ ] **2.3** **Resize / DPI**: WebView2 DPI awareness; LCD scale factor matches HVC “preview” pane.

### Phase 3 — Shared library extraction

- [ ] **3.1** Identify **pure functions** (canvas remap, theme apply, validation) with **no `document`**.  
- [ ] **3.2** Publish **`@temco/tstat10-lcd-core`** (name TBD) from sim or new repo; both sides import.  
- [ ] **3.3** CI in both repos run **same** schema + fixture tests on shared fixtures.

### Phase 4 — UX convergence

- [ ] **4.1** **Single entry** in T3000: “Edit LCD” launches embedded sim or deep-links to same URL pattern.  
- [ ] **4.2** **HVC “LCD mode”** artboard: same grid, same snap rules as sim (`layout-editor-canvas-grid.js` behavior).  
- [ ] **4.3** Deprecate duplicate editors only when **parity checklist** is signed off.

### Phase 5 — Hardening

- [ ] **5.1** E2E: WebView2 host + **save** + reload round-trip.  
- [ ] **5.2** Performance budget (load time, memory) on low-end PCs.  
- [ ] **5.3** Offline / field laptop story (packaged assets, no `npm start`).

---

## 6. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| **Two sources of truth** for JSON | Schema + CI in **one** repo until package extraction; T3000 consumes **published** schema artifact. |
| **WebView2 vs dev-server** deltas | Test **file://** and **https://** early; avoid features that require arbitrary CORS in field build. |
| **Coordinate system drift** | Lock **logical** 240×320 for ship; other sizes are **authoring-only** with explicit “Apply layout” (already in sim). |
| **Credential / device security** | Keep provisioning and **Wi‑Fi** flows out of first merge slice; see **Mobile Phone App** in `Todo.md`. |

---

## 7. Open decisions (stakeholders)

1. **Canonical repo** for shared JSON schema + validators: sim repo, T3000, or new `lcd-common`?  
2. **Does HVC stay vector-first** with **export-to-LCD-JSON**, or does HVC gain a **pixel LCD mode**?  
3. **Release train**: ship embed behind flag per T3000 milestone vs wait for library extraction?  
4. **Who owns** Playwright/WebView2 UI tests—sim team or T3000 team?

---

## 8. Next action

Create a **Phase 0 ticket** in your tracker with owners for **0.1–0.4**. When **0.1** exists as a short markdown appendix, link it here under **References**.

**References (this repo):** `Architecture.md`, `AGENTS.md` / `agents.md`, `screen_inventory.md`, `screens-registry.json`, `lcd-editor-core.js`, ADR [0001](adr/0001-defer-frontend-bundler.md).
