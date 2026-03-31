// Auto tester: simulate right arrow key every 3 seconds on startup
function startAutoTester() {
    function autoTestStep() {
        console.log('[AutoTester] Simulating ArrowRight key press');
        const rightEvent = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true });
        window.dispatchEvent(rightEvent);
        setTimeout(() => {
            console.log('[AutoTester] Simulating ArrowUp key press');
            const upEvent = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true });
            window.dispatchEvent(upEvent);
            // Schedule next cycle after 3 seconds
            setTimeout(autoTestStep, 3000);
        }, 3000);
    }
    autoTestStep();
}
// network-settings-renderer.js
// Dynamically renders the Network Settings menu from network-settings.json into #tstat-lcd-container

async function renderNetworkSettings() {
                // Show LCD x/y/width/height in debug panel if present
                setTimeout(() => {
                    const coordsSpan = document.getElementById('redbox-coords');
                    if (coordsSpan) {
                        // Show the actual redbox cell coordinates (1,3)
                            coordsSpan.textContent = `x:1, y:3`;
                    }
                }, 0);
            // Redbox debug flag: always sync with checkbox state if present
            const redboxToggle = document.getElementById('toggle-redbox');
            if (redboxToggle) {
                // Remove any previous event listeners to avoid duplicates
                if (!redboxToggle._redboxListenerAttached) {
                    redboxToggle.addEventListener('change', (e) => {
                        window._tstatShowRedbox = redboxToggle.checked;
                        renderNetworkSettings();
                    });
                    redboxToggle._redboxListenerAttached = true;
                }
                // Always sync the checkbox and the overlay state
                redboxToggle.checked = !!window._tstatShowRedbox;
            } else {
                window._tstatShowRedbox = window._tstatShowRedbox ?? false;
            }
        // Update debug event panel if present
        setTimeout(() => {
            const eventVal = document.getElementById('debug-event-value');
            const keypadVal = document.getElementById('debug-keypad-value');
            const focusVal = document.getElementById('debug-focus-value');
            const valueVal = document.getElementById('debug-value-value');
            if (eventVal) eventVal.textContent = window._tstatLastEvent || '';
            if (keypadVal) keypadVal.textContent = window._tstatLastKeypad || '';
            if (focusVal) {
                const menuRows = data.widgets.filter(w => w.type === 'menu_row').reverse();
                const focusIdx = window._networkSettingsFocus || 0;
                focusVal.textContent = menuRows[focusIdx]?.label || '';
            }
            if (valueVal) {
                const menuRows = data.widgets.filter(w => w.type === 'menu_row').reverse();
                const focusIdx = window._networkSettingsFocus || 0;
                valueVal.textContent = menuRows[focusIdx]?.value || '';
            }
        }, 0);
    const lcd = document.getElementById('tstat-lcd-container');
    if (!lcd) return;

    lcd.innerHTML = '';

    // Debug layer flags (global for toggling)
    window._tstatShowGridLayer = window._tstatShowGridLayer ?? true;
    window._tstatShowCoordsLayer = window._tstatShowCoordsLayer ?? false;

    // Attach toggle listeners (only once) - only for grid and coords, NOT redbox (handled above)
    if (!window._tstatDebugTogglesSetup) {
        setTimeout(() => {
            const gridToggle = document.getElementById('toggle-grid-layer');
            const coordsToggle = document.getElementById('toggle-coords');
            if (gridToggle) {
                gridToggle.checked = !!window._tstatShowGridLayer;
                gridToggle.addEventListener('change', (e) => {
                    window._tstatShowGridLayer = gridToggle.checked;
                    renderNetworkSettings();
                });
            }
            if (coordsToggle) {
                coordsToggle.checked = !!window._tstatShowCoordsLayer;
                coordsToggle.addEventListener('change', (e) => {
                    window._tstatShowCoordsLayer = coordsToggle.checked;
                    renderNetworkSettings();
                });
            }
        }, 0);
        window._tstatDebugTogglesSetup = true;
    }

    // Load JSON (fetch from local file) only once, then cache
    let data = window._networkSettingsData;
    if (!data) {
        try {
            const resp = await fetch('./Menu_NetworkSettings.json');
            data = await resp.json();
            window._networkSettingsData = data;
        } catch (e) {
            lcd.innerHTML = '<div style="color:red">Failed to load Menu_NetworkSettings.json</div>';
            return;
        }
    }

    lcd.style.background = data.styles?.bg || '#003366';
    lcd.style.color = '#fff';
    lcd.style.position = 'relative';
    lcd.style.fontFamily = data.styles?.fontFamily || 'Segoe UI, Arial, sans-serif';
    lcd.style.padding = '0';

    // Header
    const headerData = data.widgets[0];
    const header = document.createElement('div');
    header.style.textAlign = 'center';
    header.style.fontWeight = 'bold';
        header.style.fontWeight = data.styles?.fontWeight || 'bold';
    header.style.fontSize = data.styles?.fontSize || headerData.fontSize || '22px';
    header.style.marginTop = '36px'; // More space above title
    header.style.marginBottom = '32px'; // More space below title
    header.innerHTML = headerData.text.replace(/\n/g, '<br>');
    lcd.appendChild(header);

    // Menu rows
    // Render menu rows in reverse order so 'Mode' is on row 3
    const menuRowsData = data.widgets.filter(w => w.type === 'menu_row').reverse().map(row => {
        // If options are all numbers, sort low to high
        if (Array.isArray(row.options) && row.options.every(v => typeof v === 'number')) {
            row = { ...row, options: [...row.options].sort((a, b) => a - b) };
        }
        return row;
    });
    let menuRowsFocusedIndex = window._networkSettingsFocus || 0;
    menuRowsData.forEach((widget, idx) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        row.style.margin = '6px 0 6px 0'; // Less vertical margin for menu rows
        row.style.padding = '6px 0'; // No left padding, flush with left edge
        row.style.borderRadius = '8px';
        row.style.background = (idx === menuRowsFocusedIndex) ? (data.styles?.highlight || '#008080') : 'rgba(0,0,0,0.08)';
        // Increase font size by 3px
        const baseFontSize = parseInt((data.styles?.fontSize || '22px').replace('px',''), 10) + 3;
        row.style.fontSize = baseFontSize + 'px';
        row.style.fontFamily = data.styles?.fontFamily || 'Segoe UI, Arial, sans-serif';
        // Snap to grid using JSON parameters
        const textWidth = data.styles?.textWidthChars || 6;
        const valueBoxWidth = data.styles?.valueBoxWidthChars || 8;
        row.style.fontWeight = data.styles?.fontWeight || 'bold';
        row.style.fontFamily = data.styles?.fontFamily || 'monospace';
        row.style.gap = '0';
        row.style.padding = '0';
        row.style.margin = '0';
        // Label: left-aligned, starts at char 1, width = textWidthChars
        const labelSpan = document.createElement('span');
        let labelText = (widget.label + ' '.repeat(textWidth)).slice(0, textWidth);
        if (idx === menuRowsFocusedIndex) {
            labelSpan.style.background = data.styles?.highlight || '#008080';
            labelSpan.style.borderRadius = '8px';
        }
        labelSpan.textContent = labelText;
        labelSpan.style.display = 'inline-block';
        labelSpan.style.width = textWidth + 'ch';
        labelSpan.style.minWidth = textWidth + 'ch';
        labelSpan.style.maxWidth = textWidth + 'ch';
        labelSpan.style.textAlign = 'left';
        labelSpan.style.fontWeight = 'bold';
        labelSpan.style.color = '#fff';
        labelSpan.style.padding = '0';
        labelSpan.style.margin = '0';
        labelSpan.style.fontWeight = data.styles?.fontWeight || 'bold';
        labelSpan.style.fontFamily = data.styles?.fontFamily || 'monospace';
        labelSpan.style.fontSize = baseFontSize + 'px';
        // Value: right, in a box, width = valueBoxWidthChars
        const valueSpan = document.createElement('span');
        valueSpan.textContent = (widget.value ?? '').toString().padEnd(valueBoxWidth, ' ');
        valueSpan.style.display = 'inline-block';
        valueSpan.style.background = '#fff';
        valueSpan.style.color = '#003366';
        valueSpan.style.fontWeight = 'bold';
        valueSpan.style.borderRadius = '8px';
        valueSpan.style.width = valueBoxWidth + 'ch';
        valueSpan.style.minWidth = valueBoxWidth + 'ch';
        valueSpan.style.maxWidth = valueBoxWidth + 'ch';
        valueSpan.style.padding = '0';
        valueSpan.style.fontWeight = data.styles?.fontWeight || 'bold';
        valueSpan.style.textAlign = 'center';
        valueSpan.style.boxShadow = (idx === menuRowsFocusedIndex) ? '0 2px 8px rgba(0,120,215,0.18)' : 'none';
        valueSpan.style.fontFamily = data.styles?.fontFamily || 'monospace';
        valueSpan.style.fontSize = baseFontSize + 'px';
        valueSpan.style.margin = '0';
        row.appendChild(labelSpan);
        row.appendChild(valueSpan);
        lcd.appendChild(row);
    });

    // Arrow key row at the bottom, grid-aligned
    const arrowRow = document.createElement('div');
    arrowRow.style.position = 'absolute';
    arrowRow.style.left = '0';
    arrowRow.style.bottom = '0';
    arrowRow.style.height = '1em';
    arrowRow.style.width = '100%';
    arrowRow.style.fontSize = '28px';
    arrowRow.style.lineHeight = '1em';
    arrowRow.style.fontFamily = data.styles?.fontFamily || 'monospace';
    arrowRow.style.pointerEvents = 'none';
    // Place arrows at col 3, 7, 11, 17 (1-based, so left: 2ch, 6ch, 10ch, 16ch)
    // Adjusted so up arrow is at char 1 and 11 exactly
    // Left arrow at 2ch, up arrow at 10ch (char 11), others unchanged
    const arrowPositions = [2, 6, 10, 16];
    const arrows = [
        { id: 'arrow-left',  char: '◀',  style: 'font-weight: normal;' },
        { id: 'arrow-down',  char: '▼',  style: 'font-weight: bold; font-size: 36px; line-height: 1;' },
        { id: 'arrow-up',    char: '▲',  style: 'font-weight: bold; font-size: 36px; line-height: 1;' },
        { id: 'arrow-right', char: '▶',  style: 'font-weight: normal;' }
    ];
    let arrowHtml = '';
    for (let i = 0; i < arrows.length; i++) {
        let left = arrowPositions[i];
        // Only nudge the down arrow (index 1) left by 0.5ch for better centering
        if (i === 1) left -= 0.5;
        // Add bottom padding for all arrows for better vertical centering
        arrowHtml += `<span id="${arrows[i].id}" style="position: absolute; left: ${left}ch; bottom: 0.15em; padding-bottom: 0.1em; ${arrows[i].style} pointer-events: none;">${arrows[i].char}</span>`;
    }
    arrowRow.innerHTML = arrowHtml;
    lcd.appendChild(arrowRow);

    // Add a dead (blank) row after the arrow row
    const deadRow = document.createElement('div');
    deadRow.style.height = '1em';
    deadRow.style.width = '100%';
    deadRow.style.background = 'transparent';
    deadRow.style.pointerEvents = 'none';
    lcd.appendChild(deadRow);

    // Status line below the simulated thermostat
    // (Status line removed; debug info now in debug panel)

    // --- Character Grid Overlay for Alignment Debugging (Rule 9) ---
    // Remove any existing grid/extreme debug overlays
    const oldGrid = document.getElementById('lcd-char-grid');
    if (oldGrid) oldGrid.remove();
    const oldCoords = document.getElementById('lcd-coords-layer');
    if (oldCoords) oldCoords.remove();

    const numRows = 10;
    const numCols = 17;
    // Grid layer
    if (window._tstatShowGridLayer) {
        const grid = document.createElement('div');
        grid.id = 'lcd-char-grid';
        grid.style.position = 'absolute';
        grid.style.top = '0';
        grid.style.left = '0';
        grid.style.width = '100%';
        grid.style.height = '100%';
        grid.style.pointerEvents = 'none';
        grid.style.zIndex = '10';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.style.display = 'block';
        svg.style.position = 'absolute';
        svg.style.top = '0';
        svg.style.left = '0';
        // Draw vertical lines for 17 columns (uniform width)
        for (let c = 0; c <= numCols; c++) {
            const x = (c / numCols) * 100;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', x + '%');
            line.setAttribute('y1', '0');
            line.setAttribute('x2', x + '%');
            line.setAttribute('y2', '100%');
            line.setAttribute('stroke', '#e5e5e5');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        }
        // Draw horizontal lines for 10 rows (uniform height)
        for (let r = 0; r <= numRows; r++) {
            const y = (r / numRows) * 100;
            const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
            line.setAttribute('x1', '0');
            line.setAttribute('y1', y + '%');
            line.setAttribute('x2', '100%');
            line.setAttribute('y2', y + '%');
            line.setAttribute('stroke', '#e5e5e5');
            line.setAttribute('stroke-width', '1');
            svg.appendChild(line);
        }
        // Highlight cell (3,1): third column from the left, bottom row (1-based)
        const cellW = 100 / numCols;
        const cellH = 100 / numRows;
        const highlightRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        highlightRect.setAttribute('x', (2 * cellW) + '%');
        highlightRect.setAttribute('y', (100 - 1 * cellH) + '%');
        highlightRect.setAttribute('width', cellW + '%');
        highlightRect.setAttribute('height', cellH + '%');
        highlightRect.setAttribute('fill', 'none');
        highlightRect.setAttribute('stroke', 'red');
        highlightRect.setAttribute('stroke-width', '2');
        svg.appendChild(highlightRect);
        grid.appendChild(svg);
        lcd.appendChild(grid);
    }

    // Extreme debug layer: superimpose 0,1,2... on each cell
    if (window._tstatShowCoordsLayer) {
        const coords = document.createElement('div');
        coords.id = 'lcd-coords-layer';
        coords.style.position = 'absolute';
        coords.style.top = '0';
        coords.style.left = '0';
        coords.style.width = '100%';
        coords.style.height = '100%';
        coords.style.pointerEvents = 'none';
        coords.style.zIndex = '99999';
        coords.style.fontFamily = 'monospace';
        coords.style.fontSize = '1.1em';
        coords.style.userSelect = 'none';
        for (let r = 0; r < numRows; r++) {
            for (let c = 0; c < numCols; c++) {
                const cellNum = ((c % 10) + 1).toString();
                const cell = document.createElement('div');
                cell.textContent = cellNum;
                cell.style.position = 'absolute';
                cell.style.left = (c * (100 / numCols)) + '%';
                cell.style.top = (r * (100 / numRows)) + '%';
                cell.style.width = (100 / numCols) + '%';
                cell.style.height = (100 / numRows) + '%';
                cell.style.display = 'flex';
                cell.style.alignItems = 'center';
                cell.style.justifyContent = 'center';
                cell.style.color = 'red';
                cell.style.fontWeight = 'bold';
                cell.style.textShadow = '0 0 4px #fff, 0 0 2px #fff';
                coords.appendChild(cell);
            }
        }
        lcd.appendChild(coords);
    }
}

function handleArrowKey(e) {
    window._tstatLastEvent = e.key;
    console.log('[KeyEvent]', e.key);
    const data = window._networkSettingsData;
    if (!data) return;
    // Use reversed order to match rendering
    const menuRows = data.widgets.filter(w => w.type === 'menu_row').reverse();
    // Find the indices of menu_row widgets in data.widgets
    const menuRowIndices = data.widgets.map((w, idx) => w.type === 'menu_row' ? idx : -1).filter(idx => idx !== -1);
    let focusedIndex = typeof window._networkSettingsFocus === 'number' ? window._networkSettingsFocus : 0;
        if (e.key === 'ArrowRight') {
            // Move highlight down (wrap)
            focusedIndex = (focusedIndex + 1) % menuRows.length;
            window._networkSettingsFocus = focusedIndex;
            renderNetworkSettings();
            return;
        } else if (e.key === 'ArrowLeft') {
            // Move highlight up (wrap)
            focusedIndex = (focusedIndex - 1 + menuRows.length) % menuRows.length;
            window._networkSettingsFocus = focusedIndex;
            renderNetworkSettings();
            return;
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            // Change value of focused row only
            const row = menuRows[focusedIndex];
            if (row.options) {
                let currentIdx = row.options.indexOf(row.value);
                if (currentIdx === -1) currentIdx = 0;
                if (e.key === 'ArrowUp') {
                    if (currentIdx < row.options.length - 1) currentIdx++;
                } else {
                    if (currentIdx > 0) currentIdx--;
                }
                row.value = row.options[currentIdx];
            } else if (row.id === 'ui_item_addr') {
                let v = Number(row.value) || 1;
                const maxValue = row.maxValue || 247;
                const minValue = 1;
                if (e.key === 'ArrowUp') v = v >= maxValue ? maxValue : v + 1;
                else if (e.key === 'ArrowDown') v = v <= minValue ? minValue : v - 1;
                row.value = v;
            } else if (row.id === 'ui_item_ip') {
                let parts = row.value.split('.').map(Number);
                if (parts.length === 4) {
                    if (e.key === 'ArrowUp') parts[3] = (parts[3] + 1) % 256;
                    else parts[3] = (parts[3] - 1 + 256) % 256;
                    row.value = parts.join('.');
                }
            }
            renderNetworkSettings();
            return;
        }
    // No action for other keys
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        renderNetworkSettings();
        window.addEventListener('keydown', handleArrowKey);
    });
} else {
    renderNetworkSettings();
    window.addEventListener('keydown', handleArrowKey);
}
