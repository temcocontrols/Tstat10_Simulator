/**
 * Single source of truth for simulator screen JSON paths (used by renderer, save server, docs).
 * Paths are relative to the repo root as used in `fetch()` / `renderScreen`.
 */
export const ROUTE_TO_JSON_PATH = Object.freeze({
    main: './main_display.json',
    setup: './setup_menu.json',
    ethernet: './ethernet_setup.json',
    provisioning: './provisioning_setup.json',
    settings: './network_settings.json',
    clock: './clock_setup.json',
    oat: './oat_setup.json',
    tbd: './tbd_setup.json'
});

/** Same screens as the layout tree / theme merge (stable order). */
export const PROJECT_SCREEN_JSON_PATHS = Object.freeze([
    ROUTE_TO_JSON_PATH.main,
    ROUTE_TO_JSON_PATH.setup,
    ROUTE_TO_JSON_PATH.ethernet,
    ROUTE_TO_JSON_PATH.provisioning,
    ROUTE_TO_JSON_PATH.settings,
    ROUTE_TO_JSON_PATH.clock,
    ROUTE_TO_JSON_PATH.oat,
    ROUTE_TO_JSON_PATH.tbd
]);

/** Basename allowlist for POST /save_settings (no `./` prefix). */
export const SAVABLE_SCREEN_FILENAMES = Object.freeze(
    Array.from(new Set(Object.values(ROUTE_TO_JSON_PATH).map((p) => p.replace(/^\.\//, ''))))
);

export const DEFAULT_STARTUP_JSON_PATH = ROUTE_TO_JSON_PATH.main;
