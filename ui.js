// ui.js: UI rendering routines for LCD simulator
// Handles rendering LCD, overlays, debug panel
import { getRedboxCoords, redbox } from './coords.js';

// Render the redbox overlay on the LCD grid
export function renderRedboxOverlay(svg) {
    const { x, y } = getRedboxCoords();
    const numCols = redbox.numCols;
    const numRows = redbox.numRows;
    const cellW = 100 / numCols;
    const cellH = 100 / numRows;
    const highlightRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    highlightRect.setAttribute('x', ((x - 1) * cellW) + '%');
    highlightRect.setAttribute('y', (100 - y * cellH) + '%');
    highlightRect.setAttribute('width', cellW + '%');
    highlightRect.setAttribute('height', cellH + '%');
    highlightRect.setAttribute('fill', 'none');
    highlightRect.setAttribute('stroke', 'red');
    highlightRect.setAttribute('stroke-width', '2');
    svg.appendChild(highlightRect);
}

// Update the debug panel with redbox coordinates
export function updateRedboxDebugPanel() {
    const coordsValueSpan = document.getElementById('redbox-coords-value');
    if (coordsValueSpan) {
        const { x, y } = getRedboxCoords();
        coordsValueSpan.textContent = `x:${x}, y:${y}`;
    }
}