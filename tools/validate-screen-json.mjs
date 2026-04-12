#!/usr/bin/env node
/**
 * Validates committed project screen JSON files against the compiled schema.
 * Uses the same generated validator as the browser (screen-json-validate-generated.mjs).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { readScreensRegistry } from './read-screens-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

readScreensRegistry();

const { default: validate } = await import(pathToFileURL(path.join(root, 'screen-json-validate-generated.mjs')).href);
const { PROJECT_SCREEN_JSON_PATHS } = await import(pathToFileURL(path.join(root, 'screen-paths.js')).href);

function formatErrors(errors) {
    if (!errors?.length) return '';
    return errors.map((e) => `${e.instancePath || '/'} ${e.message}`.trim()).join('\n');
}

let failed = false;
for (const rel of PROJECT_SCREEN_JSON_PATHS) {
    const filePath = path.join(root, rel.replace(/^\.\//, ''));
    const name = path.basename(filePath);
    let data;
    try {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (e) {
        console.error(`[validate-screen-json] ${name}: invalid JSON — ${e.message}`);
        failed = true;
        continue;
    }
    if (!validate(data)) {
        console.error(`[validate-screen-json] ${name} failed schema:\n${formatErrors(validate.errors)}`);
        failed = true;
    } else {
        console.log(`[validate-screen-json] OK ${name}`);
    }
}

if (failed) process.exit(1);
