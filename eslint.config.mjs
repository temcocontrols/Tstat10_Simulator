import js from '@eslint/js';
import globals from 'globals';

const globalIgnores = [
    '**/node_modules/**',
    'ScreenShots/**',
    'playwright-report/**',
    'test-results/**',
    'e2e/**',
    'tools/tree-dnd-smoke.mjs',
    'Tstat10,code-workspace.js'
];

export default [
    { ignores: globalIgnores },
    {
        files: ['*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.es2021
            }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },
    {
        files: ['tools/**/*.mjs', 'playwright.config.mjs', 'save-server.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...globals.node, ...globals.es2021 }
        },
        rules: {
            ...js.configs.recommended.rules,
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    }
];
