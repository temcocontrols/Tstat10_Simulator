// debug-toggles.js: Setup listeners for debug layer toggles (grid, coords)
// Can be reused on other simulator pages

export function setupDebugToggles(renderCallback) {
    if (!window._tstatDebugTogglesSetup) {
        setTimeout(() => {
            const gridToggle = document.getElementById('toggle-grid-layer');
            const coordsToggle = document.getElementById('toggle-coords');
            if (gridToggle) {
                gridToggle.checked = !!window._tstatShowGridLayer;
                gridToggle.addEventListener('change', (e) => {
                    window._tstatShowGridLayer = gridToggle.checked;
                    renderCallback();
                });
            }
            if (coordsToggle) {
                coordsToggle.checked = !!window._tstatShowCoordsLayer;
                coordsToggle.addEventListener('change', (e) => {
                    window._tstatShowCoordsLayer = coordsToggle.checked;
                    renderCallback();
                });
            }
        }, 0);
        window._tstatDebugTogglesSetup = true;
    }
}