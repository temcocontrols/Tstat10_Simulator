# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
when version tags are used.

## [Unreleased]

### Added

- **Console pipe:** structured **NDJSON** log **`logs/browser-console.jsonl`** (pathname, tab session id, document title, User-Agent) alongside the human **`logs/browser-console.log`**; see **`docs/console-pipe.md`**.
- **Mobile Phone App (roadmap):** phased plan in **[`Todo.md`](Todo.md)** (§ *Mobile Phone App* — LAN sim on phone, provisioning/mock handoff, local AP, thin client). Draft ADR: **[`docs/adr/0002-mobile-phone-client.md`](docs/adr/0002-mobile-phone-client.md)** — **default: same repo** as the simulator; split only if store-native forces it.
- **T3000 / HVC merge (plan):** integration strategy for reusing LCD tools inside T3000 user-graphics authoring — **[`docs/plan-t3000-hvc-lcd-merge.md`](docs/plan-t3000-hvc-lcd-merge.md)**; tracked in **[`Todo.md`](Todo.md)** (§ *T3000 / HVC + LCD simulator merge*).

### Changed

## [1.0.0] - 2026-04-10

First tracked **semver** release for the simulator (`package.json` **version** `1.0.0`). Summarizes the main integration and quality work shipped to date.

### Added

- **GitHub Actions CI** — lint (`eslint` with zero warnings), doctor, syntax `node --check`, screen JSON schema validation, Playwright smoke.
- **Playwright** E2E on port **8799** (parallel with **`npm start`** on **8787`**); smoke for shell load, workbench strip, background persistence after edit.
- **`GETTING_STARTED.md`**, **`npm run setup`**, post-install hints, VS Code tasks (save server, doctor probe).
- **`screens-registry.json`** (+ **`screens-registry.embedded.mjs`**) — canonical screen list (`routeKey`, `page`, `displayName`, `jsonPath`); **`screen-paths.js`** exports **`ROUTE_TO_JSON_PATH`**, **`ROUTE_KEY`**, **`PAGE`**, **`SETUP_MENU_ROW_TO_ROUTE`**, **`PROJECT_SCREEN_JSON_PATHS`**, **`jsonPathMatchesRoute`**, etc.
- **Screen JSON schema** — **`schemas/tstat10-screen.schema.json`**, **`schemas/widget-types.json`**, validate on load in the app, **`npm run validate:screens`**, standalone validator **`screen-json-validate-generated.mjs`** (regen via **`npm run build:schema-validator`**).
- **`save-server.mjs`** (ESM) — optional disk save; **`npm run save-server`**; allowlist from registry-derived paths.
- **Dependabot** — weekly npm updates.
- **`npm run doctor -- --probe`** — optional HTTP probe for **`/__tstat_dev_probe`** on **8787** / **8799**.
- **ADR** — [**`docs/adr/0001-defer-frontend-bundler.md`**](docs/adr/0001-defer-frontend-bundler.md) (no UI bundler until requirements change).
- **Workbench resources strip** — screen JSON filenames filled from the registry (**`assets-strip-screen-registry.mjs`**).

### Changed

- Prefer **`npm start`** / **`node tools/dev-server.mjs`** over a generic static server for full simulator behavior (see **`AGENTS.md`** / **`agents.md`**).
- **Lint in CI** uses **`eslint --max-warnings=0`** (matches **`lint-staged`** for commits).
