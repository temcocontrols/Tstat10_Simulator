# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
when version tags are used.

## [Unreleased]

### Added

- GitHub Actions CI (lint, doctor, syntax check, Playwright smoke).
- Playwright E2E smoke on port **8799** (parallel with **`npm start`** on **8787**); second check for workbench / resources strip.
- **`GETTING_STARTED.md`**, **`npm run setup`**, post-install hints, VS Code tasks (including save server + doctor probe).
- **`screen-paths.js`** — single registry for screen JSON routes and save allowlist.
- **`save-server.mjs`** (ESM) — optional disk save server; **`npm run save-server`**; allowlist from **`screen-paths.js`** (replaces **`save-server.js`**).
- Dependabot (weekly npm updates).
- **`npm run doctor -- --probe`** — optional HTTP probe for **`/__tstat_dev_probe`** on **8787** / **8799**.

### Changed

- Prefer **`npm start`** over generic static servers for full simulator behavior (see **`agents.md`**).
