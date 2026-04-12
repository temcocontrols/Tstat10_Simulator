# ADR 0001: Defer front-end bundler

## Status

Accepted (2026-04)

## Context

- The simulator ships as static HTML plus **native ES modules** (`<script type="module">`), served by `tools/dev-server.mjs` (and the same files can be opened or embedded elsewhere).
- A bundler (Vite, Rollup, webpack, etc.) adds configuration, dependency on its plugin ecosystem, and often a mismatch between “source” and “what runs” in the debugger.
- CI already enforces quality with ESLint (`lint:ci`), screen JSON validation (`validate:screens:ci`), and Playwright smoke tests (`test:e2e`).

## Decision

1. **Do not** introduce a JavaScript bundler for the simulator UI until there is a concrete, agreed trigger (examples: strict production CSP that forbids multiple module files; a dependency that cannot be consumed as browser ESM without a pack step; a documented performance ceiling measured on target hardware).
2. Keep **one runnable surface**: `npm start` / `node tools/dev-server.mjs` + the same module graph the browser loads.
3. Treat **Playwright** as the UI smoke gate. There is **no** separate `npm run build` requirement for the simulator today; adding one is out of scope until a bundler (or other compile step) exists.

## Consequences

- **Pros:** Stack traces and sources align; fewer moving parts for contributors; no bundle artifact churn in git (beyond intentional codegen such as schema validators).
- **Cons:** Browser-facing code must stay ESM-safe (no Node built-ins in modules loaded by the browser); any future npm dependency must be evaluated for ESM/browser compatibility before use.

## When to revisit

- Product or deployment mandates a single hashed bundle, tree-shaking, or a stricter CSP than “serve same-origin modules.”
- The module graph or load-time cost becomes a measured problem on the supported browsers/devices.
