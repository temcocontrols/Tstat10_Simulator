/**
 * Route keys, JSON paths, and screen metadata come from screens-registry.json
 * (baked into screens-registry.embedded.mjs by `npm run build:schema-validator`).
 * Edit the JSON file, then run that script and commit both the JSON and embedded module.
 */
import registry from './screens-registry.embedded.mjs';

const screens = registry.screens;

/** Registry order must match route keys here (fail fast if editors reorder without updating). */
const EXPECTED_ROUTE_KEYS = Object.freeze([
    'main',
    'setup',
    'ethernet',
    'provisioning',
    'settings',
    'clock',
    'oat',
    'tbd'
]);

for (let i = 0; i < EXPECTED_ROUTE_KEYS.length; i++) {
    const rk = screens[i]?.routeKey;
    if (rk !== EXPECTED_ROUTE_KEYS[i]) {
        throw new Error(
            `screen-paths: screens-registry.json order/routeKey mismatch at index ${i}: expected "${EXPECTED_ROUTE_KEYS[i]}", got "${rk}"`
        );
    }
}

/** Short names → JSON `page` id (for `data.page === PAGE.MAIN` etc.). */
const PAGE_SHORT = Object.freeze({
    MAIN: 'MAIN',
    SETUP: 'SETUP',
    WIFI: 'WIFI',
    PROVISIONING: 'PROVISIONING',
    RS485: 'RS485',
    CLOCK: 'CLOCK',
    OAT: 'OAT',
    TBD: 'TBD'
});

const shortOrder = Object.freeze([
    PAGE_SHORT.MAIN,
    PAGE_SHORT.SETUP,
    PAGE_SHORT.WIFI,
    PAGE_SHORT.PROVISIONING,
    PAGE_SHORT.RS485,
    PAGE_SHORT.CLOCK,
    PAGE_SHORT.OAT,
    PAGE_SHORT.TBD
]);

export const PAGE = Object.freeze(
    Object.fromEntries(
        shortOrder.map((short, i) => {
            const s = screens[i];
            return [short, s.page];
        })
    )
);

export const ROUTE_KEY = Object.freeze(
    Object.fromEntries(
        shortOrder.map((short, i) => {
            const s = screens[i];
            return [short, s.routeKey];
        })
    )
);

/** Setup menu `menu_row` id → route key for `navigateTo`. */
export const SETUP_MENU_ROW_TO_ROUTE = Object.freeze({
    ui_item_rs485: ROUTE_KEY.RS485,
    ui_item_ethernet: ROUTE_KEY.WIFI,
    ui_item_provisioning: ROUTE_KEY.PROVISIONING,
    ui_item_clock: ROUTE_KEY.CLOCK,
    ui_item_oat: ROUTE_KEY.OAT,
    ui_item_tbd: ROUTE_KEY.TBD
});

/** @type {readonly { routeKey: string, page: string, displayName: string, jsonPath: string }[]} */
export const SCREENS_REGISTRY = Object.freeze(screens.map((s) => Object.freeze({ ...s })));

export const ROUTE_TO_JSON_PATH = Object.freeze(
    Object.fromEntries(screens.map((s) => [s.routeKey, s.jsonPath]))
);

/** Same screens as the layout tree / theme merge (stable order = registry order). */
export const PROJECT_SCREEN_JSON_PATHS = Object.freeze(screens.map((s) => s.jsonPath));

/** Lookup by JSON `page` field (e.g. MAIN_DISPLAY → registry row). */
export const SCREENS_BY_PAGE = Object.freeze(
    Object.fromEntries(screens.map((s) => [s.page, Object.freeze({ ...s })]))
);

/** Basename allowlist for POST /save_settings (no `./` prefix). */
export const SAVABLE_SCREEN_FILENAMES = Object.freeze(
    Array.from(new Set(screens.map((s) => s.jsonPath.replace(/^\.\//, ''))))
);

const main = screens.find((s) => s.routeKey === 'main');
export const DEFAULT_STARTUP_JSON_PATH = main ? main.jsonPath : screens[0].jsonPath;

/** File/base name segment for a screen JSON path (e.g. `./main_display.json` → `main_display.json`). */
export function jsonPathBasename(jsonPath) {
    if (jsonPath == null) return '';
    const s = String(jsonPath).replace(/^\.?\//, '');
    const parts = s.split(/[/\\]/);
    return parts[parts.length - 1] || s;
}

/** True if `jsonPath` refers to the same screen file as `ROUTE_TO_JSON_PATH[routeKey]`. */
export function jsonPathMatchesRoute(jsonPath, routeKey) {
    const want = ROUTE_TO_JSON_PATH[routeKey];
    if (!want) return false;
    return jsonPathBasename(jsonPath) === jsonPathBasename(want);
}
