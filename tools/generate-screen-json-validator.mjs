#!/usr/bin/env node
/**
 * Compiles schemas/tstat10-screen.schema.json into a standalone validator module
 * (no Ajv at runtime in the browser). Regenerate after schema changes:
 *   npm run build:schema-validator
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { readScreensRegistry } from './read-screens-registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const Ajv = require('ajv').default;
const standaloneCode = require('ajv/dist/standalone').default;

const schemaPath = path.join(root, 'schemas', 'tstat10-screen.schema.json');
const widgetTypesPath = path.join(root, 'schemas', 'widget-types.json');
const outPath = path.join(root, 'screen-json-validate-generated.mjs');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const reg = readScreensRegistry();
const pageEnum = [
    ...reg.screens.map((s) => s.page),
    ...(Array.isArray(reg.additionalPageIdsForSchema) ? reg.additionalPageIdsForSchema : [])
];
if (!schema.properties?.page) throw new Error('schema: missing properties.page');
schema.properties.page.enum = pageEnum;

const widgetTypesDoc = JSON.parse(fs.readFileSync(widgetTypesPath, 'utf8'));
const widgetEnum = widgetTypesDoc.types;
if (!Array.isArray(widgetEnum) || !widgetEnum.length) {
    throw new Error('schemas/widget-types.json must contain a non-empty "types" array');
}
if (!schema.properties?.widgets?.items?.properties?.type) {
    throw new Error('schema: missing properties.widgets.items.properties.type');
}
schema.properties.widgets.items.properties.type.enum = widgetEnum;

const ajv = new Ajv({
    allErrors: true,
    strict: false,
    code: { source: true, esm: true }
});
const validate = ajv.compile(schema);
const moduleCode = standaloneCode(ajv, validate);

fs.writeFileSync(outPath, `${moduleCode}\n`, 'utf8');
console.log(`[generate-screen-json-validator] Wrote ${path.relative(root, outPath)} (${fs.statSync(outPath).size} bytes)`);
