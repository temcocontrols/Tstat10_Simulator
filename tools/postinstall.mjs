#!/usr/bin/env node
/**
 * Runs after dependencies are installed (`npm install` / `npm ci`).
 * Husky is wired via the `prepare` script in package.json (runs in the same install).
 */
console.log(`
[Tstat10 Simulator] Dependencies installed.
  First time on this machine?  npm run setup
  Run the UI:                  npm start
  Read me:                     GETTING_STARTED.md
`);
