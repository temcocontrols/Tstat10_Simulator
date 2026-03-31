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

import { getRedboxCoords, redbox, resetRedbox } from './coords.js';
import { renderRedboxOverlay, updateRedboxDebugPanel } from './ui.js';
import { handleRedboxArrowKey } from './events.js';
import { renderMenuHeader, renderMenuRows, renderArrowRow, renderDeadRow } from './menu-ui.js';
import { setupDebugToggles } from './debug-toggles.js';
import { updateDebugPanel } from './debug-panel.js';

export async function renderNetworkSettings() {
    // Show white grid overlay if enabled (after lcd is initialized and cleared)
    const lcdGrid = document.getElementById('tstat-lcd-container');
    if (!lcdGrid) return;
    lcdGrid.innerHTML = '';
    if (window._tstatShowGridLayer) {
        const grid = document.createElement('div');
        grid.style.position = 'absolute';
        grid.style.left = '0';
        grid.style.top = '0';
        grid.style.width = (data.layout?.canvas?.width || 320) + 'px';
        grid.style.height = (data.layout?.canvas?.height || 480) + 'px';
        grid.style.pointerEvents = 'none';
        grid.style.zIndex = '9999'; // Always on top
        // Calculate number of rows
        const rowHeight = data.layout?.rowHeight || 48;
        const canvasHeight = data.layout?.canvas?.height || 480;
        const maxRows = Math.floor(canvasHeight / rowHeight);
        for (let i = 0; i < maxRows; i++) {
            const line = document.createElement('div');
            line.style.position = 'absolute';
            line.style.left = '0';
            line.style.width = '100%';
            line.style.height = '1px';
            line.style.top = (i * rowHeight) + 'px';
            line.style.background = 'rgba(255,255,255,0.7)';
            grid.appendChild(line);
        }
        lcdGrid.appendChild(grid);
        // Optionally, show row count in console
        console.log('Max possible rows:', maxRows);
    }
    // Show LCD redbox coordinates in debug panel if present
    setTimeout(() => {
        updateRedboxDebugPanel();
    }, 0);
    // Redbox debug flag: always sync with checkbox state if present
    const redboxToggle = document.getElementById('toggle-redbox');
    if (redboxToggle) {
        if (!redboxToggle._redboxListenerAttached) {
            redboxToggle.addEventListener('change', (e) => {
                window._tstatShowRedbox = redboxToggle.checked;
                renderNetworkSettings();
            });
            redboxToggle._redboxListenerAttached = true;
        }
        redboxToggle.checked = !!window._tstatShowRedbox;
    } else {
        window._tstatShowRedbox = window._tstatShowRedbox ?? false;
    }
    // Update debug event panel if present using reusable routine
    setTimeout(() => {
        updateDebugPanel(window._networkSettingsData);
    }, 0);

    const lcd = document.getElementById('tstat-lcd-container');
    if (!lcd) return;
    lcd.innerHTML = '';

    // Debug layer flags (global for toggling) - allow toggles to control overlays
    window._tstatShowGridLayer = window._tstatShowGridLayer ?? false;
    window._tstatShowCoordsLayer = window._tstatShowCoordsLayer ?? false;

    // Attach debug layer toggle listeners (grid, coords) using reusable routine
    setupDebugToggles(renderNetworkSettings);

    // Only fetch JSON and set window._networkSettingsData if not already set (preserve user changes)
    let data;
    if (!window._networkSettingsData) {
        try {
            const resp = await fetch('./network_settings.json?_=' + Date.now());
            data = await resp.json();
            window._networkSettingsData = data;
        } catch (e) {
            lcd.innerHTML = '<div style="color:red">Failed to load network_settings.json</div>';
            return;
        }
    }
    data = window._networkSettingsData;

    lcd.style.background = data.styles?.bg || '#003366';
    lcd.style.color = '#fff';
    lcd.style.position = 'relative';
    lcd.style.fontFamily = data.styles?.fontFamily || 'Segoe UI, Arial, sans-serif';
    lcd.style.padding = '0';
    lcd.style.width = (data.layout?.canvas?.width || 320) + 'px';
    lcd.style.height = (data.layout?.canvas?.height || 480) + 'px';

    // Render all widgets using LVGL-style layout
    // Only menu_row widgets are focusable, in JSON order
    const menuRows = data.widgets.filter(w => w.type === 'menu_row');
    console.log('Menu row order:', menuRows.map(r => r.label));
    let menuRowsFocusedIndex = typeof window._networkSettingsFocus === 'number' ? window._networkSettingsFocus : 0;
    let menuRowCounter = 0;
    data.widgets.forEach((widget, idx) => {
        if (widget.type === 'header') {
            const header = document.createElement('div');
            header.style.position = 'absolute';
            header.style.left = (widget.x !== undefined ? widget.x : data.layout?.header?.x || 160) + 'px';
            header.style.top = (widget.y !== undefined ? widget.y : data.layout?.header?.y || 40) + 'px';
            header.style.transform = 'translate(-50%, 0)';
            header.style.textAlign = widget.align || data.layout?.header?.align || 'center';
            header.style.fontWeight = widget.font || data.layout?.header?.font || 'bold';
            header.style.fontSize = data.styles?.fontSize || '22px';
            header.innerHTML = widget.text.replace(/\n/g, '<br>');
            lcd.appendChild(header);
        } else if (widget.type === 'menu_row') {
            // Always get the current value from the global data (window._networkSettingsData)
            let liveWidget = (window._networkSettingsData?.widgets || []).find(w => w.type === 'menu_row' && w.id === widget.id) || widget;
            const row = document.createElement('div');
            row.style.position = 'absolute';
            row.style.left = (widget.x !== undefined ? widget.x : data.layout?.labelColumn?.x || 20) + 'px';
            row.style.top = (widget.y !== undefined ? widget.y : (140 + menuRowCounter * (data.layout?.rowHeight || 48))) + 'px';
            row.style.display = 'flex';
            row.style.flexDirection = 'row';
            row.style.alignItems = 'center';
            row.style.width = ((widget.labelWidth || data.layout?.labelColumn?.width || 120) + (widget.valueWidth || data.layout?.valueColumn?.width || 100)) + 'px';
            row.style.height = (data.layout?.rowHeight || 48) + 'px';
            row.style.background = (menuRowCounter === menuRowsFocusedIndex) ? (data.styles?.highlight || '#008080') : 'rgba(0,0,0,0.08)';
            row.style.borderRadius = '8px';
            row.style.fontSize = data.styles?.fontSize || '22px';
            row.style.fontFamily = data.styles?.fontFamily || 'monospace';
            // Label
            const labelSpan = document.createElement('span');
            labelSpan.textContent = widget.label;
            labelSpan.style.display = 'inline-block';
            labelSpan.style.width = (widget.labelWidth || data.layout?.labelColumn?.width || 120) + 'px';
            labelSpan.style.textAlign = 'left';
            labelSpan.style.fontWeight = 'bold';
            labelSpan.style.color = '#fff';
            // Value
            const valueSpan = document.createElement('span');
            valueSpan.textContent = (liveWidget.value ?? liveWidget.options?.[0] ?? '').toString();
            valueSpan.style.display = 'inline-block';
            menuRowCounter++;
            valueSpan.style.background = '#fff';
            valueSpan.style.color = '#003366';
            valueSpan.style.fontWeight = 'bold';
            valueSpan.style.borderRadius = '8px';
            valueSpan.style.width = (widget.valueWidth || data.layout?.valueColumn?.width || 100) + 'px';
            valueSpan.style.textAlign = 'center';
            valueSpan.style.marginLeft = '12px';
            row.appendChild(labelSpan);
            row.appendChild(valueSpan);
            lcd.appendChild(row);
        } else if (widget.type === 'nav_footer') {
            const footer = document.createElement('div');
            footer.style.position = 'absolute';
            footer.style.left = (widget.x !== undefined ? widget.x : data.layout?.footer?.x || 0) + 'px';
            footer.style.top = (widget.y !== undefined ? widget.y : data.layout?.footer?.y || 420) + 'px';
            footer.style.width = (widget.width || data.layout?.footer?.width || 320) + 'px';
            footer.style.height = (widget.height || data.layout?.footer?.height || 48) + 'px';
            footer.style.background = 'rgba(0,0,0,0.12)';
            footer.style.display = 'flex';
            footer.style.flexDirection = 'row';
            footer.style.alignItems = 'center';
            footer.style.justifyContent = 'space-between';
            footer.style.fontSize = '20px';
            footer.style.fontFamily = data.styles?.fontFamily || 'monospace';
            footer.style.color = '#fff';
            footer.style.borderRadius = '8px';
            footer.style.padding = '0 24px';
            // Add SVG arrows under UP and DOWN, and to the left of BACK and right of NEXT
            const arrowUp = `<svg width="18" height="12" style="display:block;margin:0 auto;" viewBox="0 0 18 12"><polygon points="9,2 2,10 16,10" fill="#fff"/></svg>`;
            const arrowDown = `<svg width="18" height="12" style="display:block;margin:0 auto;" viewBox="0 0 18 12"><polygon points="2,2 16,2 9,10" fill="#fff"/></svg>`;
            const arrowLeft = `<svg width="14" height="18" style="vertical-align:middle;margin-right:4px;" viewBox="0 0 14 18"><polygon points="12,2 4,9 12,16" fill="#fff"/></svg>`;
            const arrowRight = `<svg width="14" height="18" style="vertical-align:middle;margin-left:4px;" viewBox="0 0 14 18"><polygon points="2,2 10,9 2,16" fill="#fff"/></svg>`;
            footer.innerHTML = `<span>${arrowLeft}${widget.left}</span><span>${widget.up}<br>${arrowUp}</span><span>${widget.down}<br>${arrowDown}</span><span>${widget.right}${arrowRight}</span>`;
            lcd.appendChild(footer);
        }
    });
}

// Combined arrow key handler: handles both menu and redbox movement
function handleArrowKey(e) {
    // Try redbox movement first (only up/down)
    if (handleRedboxArrowKey(e)) return;
    window._tstatLastEvent = e.key;
    console.log('[KeyEvent]', e.key);
    // Immediately update debug panel after key event
    if (typeof updateDebugPanel === 'function') {
        updateDebugPanel(window._networkSettingsData);
    }
    const data = window._networkSettingsData;
    if (!data) return;
    // Use menuRows in JSON order (top-to-bottom)
    const menuRows = window._networkSettingsData.widgets.filter(w => w.type === 'menu_row');
    const menuRowIndices = window._networkSettingsData.widgets.map((w, idx) => w.type === 'menu_row' ? idx : -1).filter(idx => idx !== -1);
    let focusedIndex = typeof window._networkSettingsFocus === 'number' ? window._networkSettingsFocus : 0;
    if (e.key === 'ArrowRight') {
        // Move focus UP: bottom (2) → middle (1) → top (0) → bottom (2)
        focusedIndex = (focusedIndex - 1 + menuRows.length) % menuRows.length;
        window._networkSettingsFocus = focusedIndex;
        renderNetworkSettings();
        return;
    } else if (e.key === 'ArrowLeft') {
        // Move focus DOWN: top (0) → middle (1) → bottom (2) → top (0)
        focusedIndex = (focusedIndex + 1) % menuRows.length;
        window._networkSettingsFocus = focusedIndex;
        renderNetworkSettings();
        return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // Change value of focused row only
        // Always operate on the original row in data.widgets for value assignment
        const origRow = data.widgets.find(w => w.type === 'menu_row' && w.id === menuRows[focusedIndex].id);
        if (!origRow) return;
        // Parameters which have only two states, whether they are numeric or text, will toggle with each hit of the up or down button
        if (origRow.options) {
            // Normalize values for robust comparison (trim, string, lowercase)
            const normalize = v => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).toLowerCase());
            let currentIdx = origRow.options.findIndex(opt => normalize(opt) === normalize(origRow.value));
            if (currentIdx === -1) currentIdx = 0;
            // For two-option rows, always toggle regardless of up/down, and always toggle on every press
            if (origRow.options.length === 2 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                let newValue;
                // Always toggle to the other value
                if (normalize(origRow.value) === normalize(origRow.options[0])) {
                    newValue = String(origRow.options[1]);
                } else {
                    newValue = String(origRow.options[0]);
                }
                origRow.value = newValue;
                // Immediately update the menuRows reversed cache as well (for UI sync)
                menuRows[focusedIndex].value = newValue;
            } else if (origRow.options.length > 2 && e.key === 'ArrowUp') {
                if (currentIdx < origRow.options.length - 1) currentIdx++;
                origRow.value = String(origRow.options[currentIdx]);
            } else if (origRow.options.length > 2 && e.key === 'ArrowDown') {
                if (currentIdx > 0) currentIdx--;
                origRow.value = String(origRow.options[currentIdx]);
            }
        } else if (origRow.id === 'ui_item_addr') {
            let v = Number(origRow.value) || 1;
            const maxValue = origRow.maxValue || 247;
            const minValue = 1;
            if (e.key === 'ArrowUp') v = v >= maxValue ? maxValue : v + 1;
            else if (e.key === 'ArrowDown') v = v <= minValue ? minValue : v - 1;
            origRow.value = v;
        } else if (row.id === 'ui_item_ip') {
            let parts = String(origRow.value).split('.').map(Number);
            if (parts.length === 4) {
                if (e.key === 'ArrowUp') parts[3] = (parts[3] + 1) % 256;
                else parts[3] = (parts[3] - 1 + 256) % 256;
                origRow.value = parts.join('.');
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
