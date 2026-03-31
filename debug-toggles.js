// debug-toggles.js: Setup listeners for debug layer toggles (grid, coords)
// Can be reused on other simulator pages

export function setupDebugToggles(renderCallback) {
    if (!window._tstatDebugTogglesSetup) {
        setTimeout(() => {
            const gridToggle = document.getElementById('toggle-grid-layer');
            const coordsToggle = document.getElementById('toggle-coords');
            if (gridToggle) {
                // Respect current grid state, do not force ON
                gridToggle.checked = !!window._tstatShowGridLayer;
                if (window._tstatShowGridLayer) {
                    document.body.classList.add('debug-active');
                } else {
                    document.body.classList.remove('debug-active');
                }
                gridToggle.addEventListener('change', (e) => {
                    window._tstatShowGridLayer = gridToggle.checked;
                    if (gridToggle.checked) {
                        document.body.classList.add('debug-active');
                    } else {
                        document.body.classList.remove('debug-active');
                    }
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