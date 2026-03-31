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
import { updateDebugPanel } from './debug-panel-fixed.js';

export async function renderNetworkSettings() {
    // Prepare LCD container
    const lcdGrid = document.getElementById('tstat-lcd-container');
    if (!lcdGrid) return;
    // Remove any previous grid overlay
    const prevGrid = lcdGrid.querySelector('.debug-grid');
    if (prevGrid) prevGrid.remove();
    // Do NOT clear lcdGrid.innerHTML here—main UI will be rendered below
        // ...existing code...
        // After main UI is rendered, add grid overlay if enabled
        setTimeout(() => {
            if (window._tstatShowGridLayer) {
                const lcdGrid2 = document.getElementById('tstat-lcd-container');
                if (!lcdGrid2) return;
                // Remove any previous grid overlay
                const prevGrid2 = lcdGrid2.querySelector('.debug-grid');
                if (prevGrid2) prevGrid2.remove();
                const grid = document.createElement('div');
                grid.className = 'debug-grid';
                grid.style.zIndex = '10000';
                grid.style.pointerEvents = 'none';
                grid.style.position = 'absolute';
                grid.style.left = '0';
                grid.style.top = '0';
                grid.style.width = '320px';
                grid.style.height = '480px';
                // Draw grid lines to match lcdTextRows and lcdTextColumns
                const data = window._networkSettingsData;
                const rows = data?.layout?.lcdTextRows || 10;
                const cols = data?.layout?.lcdTextColumns || 16;
                const width = 320;
                const height = 480;
                const cellW = width / cols;
                const cellH = height / rows;
                // Vertical lines
                for (let c = 1; c < cols; c++) {
                    const vline = document.createElement('div');
                    vline.style.position = 'absolute';
                    vline.style.left = (c * cellW) + 'px';
                    vline.style.top = '0';
                    vline.style.width = '1px';
                    vline.style.height = height + 'px';
                    vline.style.background = 'rgba(255,255,255,0.9)';
                    vline.style.zIndex = '10001';
                    grid.appendChild(vline);
                }
                // Horizontal lines for every LCD row
                for (let r = 1; r <= rows; r++) {
                    const hline = document.createElement('div');
                    hline.style.position = 'absolute';
                    hline.style.left = '0';
                    hline.style.top = ((r - 1) * cellH) + 'px';
                    hline.style.width = width + 'px';
                    hline.style.height = '1px';
                    hline.style.background = 'rgba(255,255,255,0.9)';
                    hline.style.zIndex = '10001';
                    grid.appendChild(hline);
                }
                // Always insert grid as the first child so all rows render above it
                lcdGrid2.insertBefore(grid, lcdGrid2.firstChild);
                console.log('[DEBUG] Injected debug grid overlay into #tstat-lcd-container (full LCD grid, first child)');
            }
        }, 0);
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
    if (typeof window._tstatShowGridLayer === 'undefined') {
        window._tstatShowGridLayer = false; // Default grid OFF
    }
    document.body.classList.add('debug-active');
    window._tstatShowCoordsLayer = window._tstatShowCoordsLayer ?? false;

    // Attach debug layer toggle listeners (grid, coords) using reusable routine
    setupDebugToggles(renderNetworkSettings);
    // Sync grid toggle button state after refresh
    const gridToggle = document.getElementById('toggle-grid-layer');
    if (gridToggle) {
        gridToggle.checked = !!window._tstatShowGridLayer;
    }

    // Inject the Lock & Save feature into the debug panel
    let lockBtn = document.getElementById('btn-lock-save');
    if (!lockBtn) {
        
        const btnWrapper = document.createElement('div');
        btnWrapper.style.marginTop = '15px';
        btnWrapper.style.width = '100%';

        lockBtn = document.createElement('button');
        lockBtn.id = 'btn-lock-save';
        lockBtn.style.padding = '8px';
        lockBtn.style.width = '100%';
        lockBtn.style.fontWeight = 'bold';
        lockBtn.style.cursor = 'pointer';
        
        btnWrapper.appendChild(lockBtn);

        // Safely insert exactly after the row containing the grid toggle
        if (gridToggle && gridToggle.parentElement) {
            gridToggle.parentElement.insertAdjacentElement('afterend', btnWrapper);
        } else {
            // Fallback styling if panel isn't found
            btnWrapper.style.position = 'fixed';
            btnWrapper.style.bottom = '10px';
            btnWrapper.style.right = '10px';
            btnWrapper.style.width = 'auto';
            btnWrapper.style.zIndex = '10005';
            document.body.appendChild(btnWrapper);
        }

        lockBtn.addEventListener('click', () => {
            window._isVisualEditMode = !window._isVisualEditMode;
            if (!window._isVisualEditMode) {
                // Trigger file download to "write" changes locally
                const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(window._networkSettingsData, null, 2));
                const downloadAnchorNode = document.createElement('a');
                downloadAnchorNode.setAttribute("href", dataStr);
                downloadAnchorNode.setAttribute("download", "network_settings.json");
                document.body.appendChild(downloadAnchorNode);
                downloadAnchorNode.click();
                downloadAnchorNode.remove();
            }
            renderNetworkSettings();
        });
    }

    // Always sync button appearance to current state
    if (lockBtn) {
        if (window._isVisualEditMode) {
            lockBtn.innerHTML = '🔒 Lock & Save JSON';
            lockBtn.style.backgroundColor = '#ffeb3b';
            lockBtn.style.color = '#000';
        } else {
            lockBtn.innerHTML = '🔓 Unlock for Visual Edits';
            lockBtn.style.backgroundColor = '';
            lockBtn.style.color = '';
        }
    }

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
    // Sort menuRows by lcdRow for navigation and focus logic
    const menuRows = data.widgets.filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    console.log('Menu row order (by lcdRow):', menuRows.map(r => `${r.label} (row ${r.lcdRow})`));
    // Focus is index in sorted menuRows array
    let menuRowsFocusedIndex = typeof window._networkSettingsFocus === 'number' ? window._networkSettingsFocus : 0;
    let menuRowCounter = 0;
    const menuRowGap = data.layout?.menuRowGap || 0;
    // Use 48px per row for a 10-row grid
    const menuRowPixelHeight = 48;
    const headerY = 0; // Top row
    const menuRowsTop = headerY + menuRowPixelHeight;
    data.widgets.forEach((widget, idx) => {
            const lcdRow = widget.lcdRow || 1;
            const yPos = (lcdRow - 1) * menuRowPixelHeight;
            console.log(`[DEBUG] Widget: type=${widget.type}, label=${widget.label || widget.text || ''}, lcdRow=${lcdRow}, Y=${yPos}`);
        if (widget.type === 'header') {
            const headerRow = widget.lcdRow || 1;
            console.log(`[DEBUG] Rendering HEADER '${widget.text}' at lcdRow ${headerRow}, pixel top: ${(headerRow - 1) * menuRowPixelHeight}`);
            const header = document.createElement('div');
            header.style.position = 'absolute';
            header.style.left = '0px';
            header.style.width = (data.layout?.lcdCanvas?.width || 320) + 'px';
            const lcdRow = widget.lcdRow || 1;
            header.style.top = ((lcdRow - 1) * menuRowPixelHeight) + 'px';
            header.style.textAlign = widget.align || data.layout?.headerLayout?.align || 'center';
            header.style.fontWeight = widget.font || data.layout?.header?.font || 'bold';
            header.style.fontSize = data.styles?.fontSize || '22px';
            header.style.whiteSpace = 'nowrap';
            header.innerHTML = widget.text.replace(/\n/g, '<br>');

            if (window._isVisualEditMode) {
                header.style.outline = '1px dashed lightgrey';
                header.style.cursor = 'context-menu';
                header.contentEditable = 'true';
                header.addEventListener('blur', (e) => {
                    widget.text = e.target.innerText;
                });
                header.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    let existingMenu = document.getElementById('visual-edit-context-menu');
                    if (existingMenu) existingMenu.remove();
                    
                    const menu = document.createElement('div');
                    menu.id = 'visual-edit-context-menu';
                    menu.style.position = 'fixed';
                    menu.style.left = e.pageX + 'px';
                    menu.style.top = e.pageY + 'px';
                    menu.style.background = '#fff';
                    menu.style.color = '#000';
                    menu.style.border = '1px solid #ccc';
                    menu.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
                    menu.style.zIndex = '10006';
                    menu.style.display = 'flex';
                    menu.style.flexDirection = 'column';
                    menu.style.padding = '5px';
                    
                    ['left', 'center', 'right'].forEach(align => {
                        const btn = document.createElement('button');
                        btn.textContent = 'Align ' + align;
                        btn.style.margin = '2px';
                        btn.style.cursor = 'pointer';
                        btn.onclick = () => {
                            widget.align = align;
                            renderNetworkSettings();
                            menu.remove();
                        };
                        menu.appendChild(btn);
                    });
                    document.body.appendChild(menu);
                    
                    setTimeout(() => {
                        const closeMenu = (evt) => {
                            if (!menu.contains(evt.target)) {
                                menu.remove();
                                document.removeEventListener('click', closeMenu);
                            }
                        };
                        document.addEventListener('click', closeMenu);
                    }, 0);
                });
            }
            lcd.appendChild(header);
        } else if (widget.type === 'menu_row' || widget.type === 'blank') {
            const rowLcdRow = widget.lcdRow || 1;
            if (widget.type === 'menu_row') {
                console.log(`[DEBUG] Rendering MENU_ROW '${widget.label}' at lcdRow ${rowLcdRow}, pixel top: ${((rowLcdRow - 1) * menuRowPixelHeight)}`);
            } else if (widget.type === 'blank') {
                console.log(`[DEBUG] Rendering BLANK at lcdRow ${rowLcdRow}, pixel top: ${((rowLcdRow - 1) * menuRowPixelHeight)}`);
            }
            // Always use lcdRow math for vertical positioning
            const row = document.createElement('div');
            row.style.position = 'absolute';
            row.style.left = (data.layout?.rowLeftPadding || 0) + 'px';
            const lcdRow = widget.lcdRow || 1;
            row.style.top = ((lcdRow - 1) * menuRowPixelHeight) + 'px';
            row.style.transform = 'none';
            row.style.display = 'flex';
            row.style.flexDirection = 'row';
            row.style.alignItems = 'center';
            // Make row span the full canvas width minus left padding
            const rowLeftPad = data.layout?.rowLeftPadding || 0;
            const canvasW = data.layout?.canvas?.width || 320;
            row.style.width = (canvasW - rowLeftPad) + 'px';
            row.style.right = '';

            if (widget.type === 'menu_row') {
                                // Value
                                let liveWidget = (window._networkSettingsData?.widgets || []).find(w => w.type === 'menu_row' && w.id === widget.id) || widget;
                                const valueSpan = document.createElement('span');
                                valueSpan.textContent = (liveWidget.value ?? liveWidget.options?.[0] ?? '').toString();
                                valueSpan.style.display = 'inline-block';
                                valueSpan.style.padding = '0';
                                valueSpan.style.margin = '0';
                                valueSpan.style.background = '#fff';
                                valueSpan.style.color = '#003366';
                                valueSpan.style.fontWeight = 'bold';
                                valueSpan.style.borderRadius = '8px';
                                valueSpan.style.width = (widget.valueWidth || data.layout?.valueColumn?.width || 100) + 'px';
                                valueSpan.style.marginLeft = 'auto';
                                valueSpan.style.textAlign = 'left';
                                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                                valueSpan.style.paddingRight = 0;
                                valueSpan.style.whiteSpace = 'nowrap';
                                valueSpan.style.overflow = 'hidden';
                                valueSpan.style.textOverflow = 'ellipsis';
                // Render highlight background for every row, only visible for focused row
                const highlight = document.createElement('div');
                highlight.style.position = 'absolute';
                // Make the highlight one char narrower, with a char of space on each side
                const charWidth = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
                const halfChar = charWidth / 2;
                highlight.style.left = halfChar + 'px';
                highlight.style.top = '0';
                highlight.style.width = 'calc(100% - ' + charWidth + 'px)';
                highlight.style.height = '100%';
                highlight.style.background = data.styles?.highlight || '#008080';
                highlight.style.borderRadius = '8px';
                highlight.style.zIndex = '0';
                highlight.style.pointerEvents = 'none';
                // Focus logic: highlight only if this menu_row is the focused one (by id)
                const focusedMenuRow = menuRows[menuRowsFocusedIndex];
                highlight.style.opacity = (widget.id === focusedMenuRow.id) ? '1' : '0';
                row.insertBefore(highlight, row.firstChild);
                // Ensure row contents are above highlight
                setTimeout(() => {
                    Array.from(row.children).forEach(child => {
                        if (child !== highlight) {
                            child.style.position = 'relative';
                            child.style.zIndex = '1';
                        }
                    });
                }, 0);
                row.style.height = menuRowPixelHeight + 'px';
                // Default background for non-focused rows
                if (widget.id !== focusedMenuRow.id) {
                    row.style.background = 'rgba(0,0,0,0.08)';
                    row.style.boxShadow = '';
                } else {
                    row.style.background = 'transparent';
                    row.style.boxShadow = '';
                }
                row.style.borderRadius = '8px';
                row.style.fontSize = data.styles?.fontSize || '22px';
                row.style.fontFamily = data.styles?.fontFamily || 'monospace';
                row.style.paddingTop = '0';
                row.style.paddingBottom = '0';
                row.style.marginTop = '0';
                row.style.marginBottom = '0';
                // Label
                // Row number
                // Removed debug row number

                // Label
                const labelSpanFixed = document.createElement('span');
                labelSpanFixed.textContent = '\u00A0' + widget.label;
                // Removed left padding, use non-breaking space for shift
                labelSpanFixed.style.display = 'inline-block';
                labelSpanFixed.style.width = (widget.labelWidth || data.layout?.labelColumn?.width || 120) + 'px';
                labelSpanFixed.style.textAlign = 'left';
                labelSpanFixed.style.fontWeight = 'bold';
                labelSpanFixed.style.color = '#fff';
                labelSpanFixed.style.padding = '0';
                labelSpanFixed.style.margin = '0';
                labelSpanFixed.style.overflow = 'hidden';
                labelSpanFixed.style.textOverflow = 'ellipsis';
                labelSpanFixed.style.whiteSpace = 'nowrap';
                row.appendChild(labelSpanFixed);
                // (removed duplicate labelSpan code)
                valueSpan.style.textAlign = 'left';
                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                valueSpan.style.paddingRight = 0;
                valueSpan.style.whiteSpace = 'nowrap';
                valueSpan.style.overflow = 'hidden';
                valueSpan.style.textOverflow = 'ellipsis';
                row.appendChild(valueSpan);
            } else if (widget.type === 'blank') {
                row.style.height = menuRowPixelHeight + 'px';
                // Only show row number and label for blank rows that have a label property
                if (widget.label) {
                    const rowNumSpan = document.createElement('span');
                    rowNumSpan.textContent = (lcdRow <= 9) ? lcdRow : 0;
                    rowNumSpan.style.display = 'inline-block';
                    rowNumSpan.style.width = '18px';
                    rowNumSpan.style.textAlign = 'right';
                    rowNumSpan.style.fontWeight = 'bold';
                    rowNumSpan.style.color = '#ff0';
                    rowNumSpan.style.marginRight = '6px';
                    row.appendChild(rowNumSpan);

                    const labelSpanFixed = document.createElement('span');
                    labelSpanFixed.textContent = widget.label;
                    labelSpanFixed.style.display = 'inline-block';
                    labelSpanFixed.style.width = (data.layout?.labelColumn?.width || 120) + 'px';
                    labelSpanFixed.style.textAlign = 'left';
                    labelSpanFixed.style.fontWeight = 'bold';
                    labelSpanFixed.style.color = '#aaa';
                    labelSpanFixed.style.padding = '0';
                    labelSpanFixed.style.margin = '0';
                    labelSpanFixed.style.overflow = 'hidden';
                    labelSpanFixed.style.textOverflow = 'ellipsis';
                    labelSpanFixed.style.whiteSpace = 'nowrap';
                    row.appendChild(labelSpanFixed);
                }
            }
            lcd.appendChild(row);
        }
    });

    // Render all button widgets from JSON
    const buttonWidgets = data.widgets.filter(w => w.type === 'button');
    const footerPadding = data.layout?.footerPadding || 0;
    // Center the button row horizontally with gap
    const canvasWidth = data.layout?.canvas?.width || 320;
    const buttonGap = data.layout?.buttonGap || 0;
    const buttonWidths = buttonWidgets.map(w => w.width !== undefined ? w.width : 72);
    const totalButtonWidth = buttonWidths.reduce((a, b) => a + b, 0) + buttonGap * (buttonWidgets.length - 1);
    const startX = Math.round((canvasWidth - totalButtonWidth) / 2);
    let runningX = startX;
    buttonWidgets.forEach((widget, idx) => {
        const btn = document.createElement('div');
        btn.textContent = widget.label;
        btn.style.position = 'absolute';
        btn.style.left = runningX + 'px';
        let y = (widget.y !== undefined ? widget.y : (data.layout?.footer?.y || 435));
        btn.style.top = (y - footerPadding) + 'px';
        const btnWidth = widget.width !== undefined ? widget.width : 72;
        btn.style.width = btnWidth + 'px';
        btn.style.height = (widget.height !== undefined ? widget.height : 45) + 'px';
        btn.style.background = data.styles?.bg || '#003366';
        btn.style.color = '#fff';
        btn.style.fontWeight = 'bold';
        btn.style.fontFamily = data.styles?.fontFamily || 'monospace';
        btn.style.display = 'flex';
        btn.style.alignItems = 'center';
        btn.style.justifyContent = 'center';
        btn.style.lineHeight = '1.1';
        btn.style.borderRadius = '8px';
        btn.style.textAlign = 'center';
        btn.style.boxShadow = '0 2px 8px rgba(0,0,0,0.10)';
        btn.style.userSelect = 'none';
        btn.style.border = '2px solid #fff';
        if (widget.font) {
            btn.style.font = widget.font;
        } else {
            btn.style.fontSize = '20px';
        }
        lcd.appendChild(btn);
        runningX += btnWidth + buttonGap;
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
    // Use menuRows sorted by lcdRow for navigation and focus
    const menuRows = window._networkSettingsData.widgets.filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    let focusedIndex = typeof window._networkSettingsFocus === 'number' ? window._networkSettingsFocus : 0;

    // Navigation Standard: 
    // Right arrow moves to the PREV item (-1, visually UP the list)
    // Left arrow moves to the NEXT item (+1, visually DOWN the list)
    if (e.key === 'ArrowRight') {
        // Move focus UP: bottom → top (reverse order)
        focusedIndex = (focusedIndex - 1 + menuRows.length) % menuRows.length;
        window._networkSettingsFocus = focusedIndex;
        renderNetworkSettings();
        return;
    } else if (e.key === 'ArrowLeft') {
        // Move focus DOWN: top → bottom (forward order)
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
        } else if (origRow.id === 'ui_item_ip') {
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
