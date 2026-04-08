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
import { setupDebugToggles } from './debug-toggles.js';
import { updateDebugPanel } from './debug-panel-fixed.js';
import { ensureCanonicalSchema, validateLayoutData, writeStatus } from './lcd-editor-core.js';

const SIMULATED_LR_LONG_PRESS_MS = 900;
let _leftRightLongPressTimer = null;
let _leftArrowDown = false;
let _rightArrowDown = false;

function clearLeftRightLongPressTimer() {
    if (_leftRightLongPressTimer) {
        clearTimeout(_leftRightLongPressTimer);
        _leftRightLongPressTimer = null;
    }
}

function tryStartLeftRightLongPressTimer() {
    if (!_leftArrowDown || !_rightArrowDown || _leftRightLongPressTimer) return;
    _leftRightLongPressTimer = setTimeout(() => {
        _leftRightLongPressTimer = null;
        if (_leftArrowDown && _rightArrowDown) {
            const page = window._currentScreenData && window._currentScreenData.page;
            if (page === 'MAIN_DISPLAY') {
                window.navigateTo('setup');
            }
        }
    }, SIMULATED_LR_LONG_PRESS_MS);
}

/** Escape text for safe insertion into innerHTML */
function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * IPv4 with aligned periods: fixed-width octet spans so dots line up vertically across rows.
 */
function formatIPv4AlignedHtml(value) {
    const s = String(value).trim();
    const parts = s.split('.');
    if (parts.length !== 4) return null;
    if (!parts.every(p => /^\d{1,3}$/.test(p))) return null;
    const oct = (p) => `<span class="tstat-ipv4-oct">${escapeHtml(p)}</span>`;
    const dot = '<span class="tstat-ipv4-dot">.</span>';
    return `${oct(parts[0])}${dot}${oct(parts[1])}${dot}${oct(parts[2])}${dot}${oct(parts[3])}`;
}

function ensureIpv4AlignedStyles() {
    if (document.getElementById('tstat-ipv4-styles')) return;
    const st = document.createElement('style');
    st.id = 'tstat-ipv4-styles';
    st.textContent = `
        #tstat-lcd-container .tstat-ipv4-oct {
            display: inline-block;
            width: 3ch;
            text-align: right;
            font-variant-numeric: tabular-nums;
        }
        #tstat-lcd-container .tstat-ipv4-dot { display: inline-block; }
    `;
    document.head.appendChild(st);
}

// Central navigation function
window.navigateTo = function(screenName) {
    const screenMap = {
        'main': './main_display.json',
        'setup': './setup_menu.json',
        'settings': './network_settings.json',
        'ethernet': './ethernet_setup.json',
        'clock': './clock_setup.json',
        'oat': './oat_setup.json',
        'tbd': './tbd_setup.json'
    };
    const jsonPath = screenMap[screenName];
    if (jsonPath) {
        // Reset focus when changing screens
        window._currentScreenFocus = 0;
        renderScreen(jsonPath);
    } else {
        console.error(`[Navigate] Unknown screen: ${screenName}`);
    }
}

export async function renderScreen(jsonPath) {
    // Prepare LCD container
    const lcdGrid = document.getElementById('tstat-lcd-container');
    if (!lcdGrid) return;

    // Inject VS Code styling for debug tools and context menus to make them larger and monospaced
    if (!document.getElementById('vscode-debug-styles')) {
        const style = document.createElement('style');
        style.id = 'vscode-debug-styles';
        style.innerHTML = `
            /* Force the entire debug UI shell to use VS Code monospaced fonts */
            body {
                font-family: 'Consolas', 'Fira Mono', 'Menlo', 'Courier New', monospace !important;
                font-size: 14px;
            }
            
            /* VS Code style for visual edit context menus */
            #visual-edit-context-menu {
                font-family: inherit !important;
                font-size: 14px !important;
                min-width: 180px;
                padding: 8px !important;
            }
            #visual-edit-context-menu button {
                font-family: inherit !important;
                font-size: 14px !important;
                padding: 6px 12px !important;
                margin: 4px 2px !important;
                cursor: pointer;
                background: #f3f3f3;
                border: 1px solid #ccc;
                border-radius: 4px;
            }
            #visual-edit-context-menu button:hover {
                background: #e5e5e5;
            }
            
            /* Target specific debug elements to ensure legibility */
            [id*="debug-"], [id*="toggle"], #tstat-status-line {
                font-size: 14px !important;
            }
            #btn-lock-save {
                font-size: 15px !important;
                padding: 10px !important;
                border-radius: 6px;
            }
        `;
        document.head.appendChild(style);
    }
    // Remove any previous grid overlay
    const prevGrid = lcdGrid.querySelector('.debug-grid');
    if (prevGrid) prevGrid.remove();
    // Do NOT clear lcdGrid.innerHTML here—main UI will be rendered below

    // --- Lens outline ("redbox"): framed glass, aligned to top of thermostat body ---
    const deviceBezel = lcdGrid.closest('.device-bezel');
    const prevLensLegacy = lcdGrid.querySelector('.tstat-lens-outline');
    if (prevLensLegacy) prevLensLegacy.remove();
    if (deviceBezel) {
        const prevLens = deviceBezel.querySelector('.tstat-lens-outline');
        if (prevLens) prevLens.remove();
        const lens = document.createElement('div');
        lens.className = 'tstat-lens-outline';
        lens.setAttribute('aria-hidden', 'true');
        lens.style.position = 'absolute';
        lens.style.top = '0';
        lens.style.left = '50%';
        lens.style.transform = 'translateX(-50%)';
        lens.style.width = '475px';
        lens.style.height = `${Math.round(484 * 1.3 * 1.2 * 0.95)}px`; /* +30% / +20% vs 484px base, then −5% */
        lens.style.border = '3px solid #c4c4c4';
        lens.style.background = 'transparent';
        lens.style.boxSizing = 'border-box';
        lens.style.pointerEvents = 'none';
        lens.style.zIndex = '15';
        deviceBezel.appendChild(lens);
    }
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
                const data = window._currentScreenData;
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
        if (typeof updateRedboxDebugPanel === 'function') updateRedboxDebugPanel();
    }, 0);
    // Redbox debug flag: always sync with checkbox state if present
    const redboxToggle = document.getElementById('toggle-redbox');
    if (redboxToggle) {
        if (!redboxToggle._redboxListenerAttached) {
            redboxToggle.addEventListener('change', (e) => {
                window._tstatShowRedbox = redboxToggle.checked;
                renderScreen(jsonPath);
            });
            redboxToggle._redboxListenerAttached = true;
        }
        redboxToggle.checked = !!window._tstatShowRedbox;
    } else {
        window._tstatShowRedbox = window._tstatShowRedbox ?? false;
    }
    // Update debug event panel if present using reusable routine
    setTimeout(() => {
        if (typeof updateDebugPanel === 'function') updateDebugPanel(window._currentScreenData);
    }, 0);

    const lcd = document.getElementById('tstat-lcd-container');
    if (!lcd) return;

    // Clear old UI elements, but preserve the grid overlay (lens lives on .device-bezel)
    Array.from(lcd.children).forEach(child => {
        if (!child.classList.contains('debug-grid')) child.remove();
    });

    // Debug layer flags (global for toggling) - allow toggles to control overlays
    if (typeof window._tstatShowGridLayer === 'undefined') {
        window._tstatShowGridLayer = false; // Default grid OFF
    }
    document.body.classList.add('debug-active');
    window._tstatShowCoordsLayer = window._tstatShowCoordsLayer ?? false;

    // Attach debug layer toggle listeners (grid, coords) using reusable routine
    setupDebugToggles(() => renderScreen(jsonPath));
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

        lockBtn.addEventListener('click', async () => {
            window._isVisualEditMode = !window._isVisualEditMode;
            if (!window._isVisualEditMode && window._currentScreenData.page !== 'MAIN_DISPLAY') {
                const jsonString = JSON.stringify(window._currentScreenData, null, 2);
                // 1. Silent Save for T3000 Desktop Host
                if (window.chrome && window.chrome.webview) {
                    window.chrome.webview.postMessage({ action: 'save_settings', data: window._currentScreenData });
                } else {
                    // 2. Silent Save via local Node.js endpoint (no file prompts!)
                    const targetFile = jsonPath.split('/').pop();
                    fetch(`http://localhost:5001/save_settings?file=${targetFile}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: jsonString
                    }).catch(() => {
                        // 3. Fallback to silent browser cache if local server isn't running
                        localStorage.setItem(`tstat_cache_${jsonPath}`, jsonString);
                        console.warn('[Visual Edit] Local save server not found on port 5001. Saved to browser cache.');
                    });
                }
            } else if (!window._isVisualEditMode) {
                console.warn('[Visual Edit] Saving is disabled for the main screen.');
            }
            renderScreen(jsonPath);
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
    window._currentJsonPath = jsonPath;
    let data;
    // Check if we already have the data loaded for this specific screen
    if (!window._currentScreenData || window._lastLoadedJsonPath !== jsonPath) {
        try {
            const cachedData = localStorage.getItem(`tstat_cache_${jsonPath}`);
            if (cachedData) {
                data = JSON.parse(cachedData);
                console.log(`[Visual Edit] Loaded layout for ${jsonPath} from silent cache.`);
            } else {
                const resp = await fetch(jsonPath + '?_=' + Date.now());
                data = await resp.json();
            }
            window._currentScreenData = data;
            window._lastLoadedJsonPath = jsonPath;
        } catch (e) {
            lcd.innerHTML = `<div style="color:red; padding: 20px;">Failed to load ${jsonPath}</div>`;
            console.error(e);
            return;
        }
    }
    data = window._currentScreenData;
    ensureCanonicalSchema(data);
    ensureIpv4AlignedStyles();

    const bindEditorControls = () => {
        if (window._lcdEditorPanelBound) return;
        window._lcdEditorPanelBound = true;

        const widthInput = document.getElementById('editor-canvas-width');
        const heightInput = document.getElementById('editor-canvas-height');
        const orientationInput = document.getElementById('editor-orientation');
        const colorModeInput = document.getElementById('editor-color-mode');
        const applyBtn = document.getElementById('editor-apply-canvas');
        const validateBtn = document.getElementById('editor-validate');
        const resultBox = document.getElementById('editor-validation-result');

        const updateInputsFromData = () => {
            if (!window._currentScreenData) return;
            const d = window._currentScreenData;
            widthInput.value = d.canvasProfile?.width || 320;
            heightInput.value = d.canvasProfile?.height || 480;
            orientationInput.value = d.canvasProfile?.orientation || 'vertical';
            colorModeInput.value = d.colorProfile?.mode || 'indexed';
        };

        const showValidation = (result) => {
            if (!resultBox) return;
            const messages = [];
            if (result.errors.length) messages.push('Errors: ' + result.errors.join(' | '));
            if (result.warnings.length) messages.push('Warnings: ' + result.warnings.join(' | '));
            if (!messages.length) messages.push('Validation passed.');
            resultBox.textContent = messages.join('\n');
            resultBox.style.color = result.errors.length ? '#b00020' : '#0b6d2f';
        };

        applyBtn?.addEventListener('click', () => {
            const d = window._currentScreenData;
            if (!d) return;
            d.canvasProfile.width = Number(widthInput.value || 320);
            d.canvasProfile.height = Number(heightInput.value || 480);
            d.canvasProfile.orientation = orientationInput.value || 'vertical';
            d.colorProfile.mode = colorModeInput.value || 'indexed';
            ensureCanonicalSchema(d);
            writeStatus('Applied canvas/color profile to current screen JSON.');
            renderScreen(window._currentJsonPath || jsonPath);
        });

        validateBtn?.addEventListener('click', () => {
            const d = window._currentScreenData;
            if (!d) return;
            const result = validateLayoutData(d);
            showValidation(result);
            writeStatus(
                result.valid ? 'Validation passed for current screen.' : 'Validation errors found. Check LCD Editor panel.',
                !result.valid
            );
        });

        window._syncLcdEditorInputs = updateInputsFromData;
        updateInputsFromData();
    };

    bindEditorControls();
    if (typeof window._syncLcdEditorInputs === 'function') {
        window._syncLcdEditorInputs();
    }

    lcd.style.background = data.styles?.bg || '#2c7cc4';
    lcd.style.color = '#fff';
    lcd.style.position = 'relative';
    lcd.style.fontFamily = data.styles?.fontFamily || 'Segoe UI, Arial, sans-serif';
    lcd.style.padding = '0';
    const lcdCanvasWidth = data.canvasProfile?.width || data.layout?.canvas?.width || 320;
    const lcdCanvasHeight = data.canvasProfile?.height || data.layout?.canvas?.height || 480;
    lcd.style.width = lcdCanvasWidth + 'px';
    lcd.style.height = lcdCanvasHeight + 'px';

    // Allow dropping elements onto empty grid spaces
    if (!lcd._dragEventsAttached) {
        lcd.addEventListener('dragover', (e) => {
            if (window._isVisualEditMode) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
            }
        });
        lcd.addEventListener('drop', (e) => {
            if (!window._isVisualEditMode || !window._draggedWidget || data.page === 'MAIN_DISPLAY') return;
            e.preventDefault();
            const rect = lcd.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const targetRow = Math.max(1, Math.min(10, Math.floor(y / 48) + 1));
            const dragged = window._draggedWidget;
            const existingWidget = window._currentScreenData.widgets.find(w => w.lcdRow === targetRow && w.type !== 'button');
            
            if (existingWidget && existingWidget !== dragged) {
                const temp = dragged.lcdRow || 1;
                dragged.lcdRow = existingWidget.lcdRow || 1;
                existingWidget.lcdRow = temp;
            } else if (dragged.lcdRow !== targetRow) {
                dragged.lcdRow = targetRow;
            }
            renderScreen(jsonPath);
        });
        lcd._dragEventsAttached = true;
    }

    // Helper to show the alignment context menu during Visual Edit Mode
    const showAlignmentMenu = (e, widget, alignKey) => {
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
                widget[alignKey] = align;
                renderScreen(jsonPath);
                menu.remove();
            };
            menu.appendChild(btn);
        });

        // Add Width Nudging to fine-tune the exact horizontal spacing between text and values
        if (alignKey === 'labelAlign' || alignKey === 'valueAlign') {
            const hr = document.createElement('hr');
            hr.style.margin = '4px 0';
            menu.appendChild(hr);
            
            const widthKey = alignKey === 'labelAlign' ? 'labelWidth' : 'valueWidth';
            const defaultWidth = alignKey === 'labelAlign' ? (data.layout?.labelColumn?.width || 120) : (data.layout?.valueColumn?.width || 100);
            const charWidth = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
            
            const growBtn = document.createElement('button');
            growBtn.textContent = 'Grow Width (+1 char)';
            growBtn.style.margin = '2px';
            growBtn.onclick = () => { widget[widthKey] = (widget[widthKey] || defaultWidth) + charWidth; renderScreen(jsonPath); menu.remove(); };
            menu.appendChild(growBtn);
            
            const shrinkBtn = document.createElement('button');
            shrinkBtn.textContent = 'Shrink Width (-1 char)';
            shrinkBtn.style.margin = '2px';
            shrinkBtn.onclick = () => { widget[widthKey] = Math.max(charWidth, (widget[widthKey] || defaultWidth) - charWidth); renderScreen(jsonPath); menu.remove(); };
            menu.appendChild(shrinkBtn);
        }
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
    };

    // Render all widgets using LVGL-style layout
    // Only menu_row widgets are focusable, in JSON order
    // Sort menuRows by lcdRow for navigation and focus logic
    const menuRows = (data.widgets || []).filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    console.log('Menu row order (by lcdRow):', menuRows.map(r => `${r.label} (row ${r.lcdRow})`));
    // Focus is index in sorted menuRows array
    let menuRowsFocusedIndex = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
    if (menuRows.length > 0) {
        menuRowsFocusedIndex = ((menuRowsFocusedIndex % menuRows.length) + menuRows.length) % menuRows.length;
        window._currentScreenFocus = menuRowsFocusedIndex;
    }
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
                header.addEventListener('contextmenu', (e) => showAlignmentMenu(e, widget, 'align'));
            }
            lcd.appendChild(header);
        } else if (widget.type === 'label') {
            const label = document.createElement('div');
            if (widget.id) label.id = widget.id;
            label.style.position = 'absolute';
            const xPos = widget.x || 0;
            const yPos = widget.y || 0;
            label.style.left = xPos + 'px';
            label.style.top = yPos + 'px';
            if (widget.width != null) label.style.width = widget.width + 'px';
            if (widget.align === 'center') {
                label.style.transform = 'translateX(-50%)';
            } else if (widget.align === 'right') {
                label.style.transform = 'translateX(-100%)';
            }
            label.style.textAlign = widget.align || 'left';
            label.style.font = widget.font || (data.styles?.fontSize || '22px') + ' ' + (data.styles?.fontFamily || 'monospace');
            label.style.color = widget.color || '#fff';
            label.style.whiteSpace = widget.wrap ? 'normal' : 'nowrap';
            label.innerHTML = widget.text.replace(/\n/g, '<br>');
            lcd.appendChild(label);
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

            if (window._isVisualEditMode) {
                row.draggable = true;
                row.style.cursor = 'grab';
                row.addEventListener('dragstart', (e) => {
                    window._draggedWidget = widget;
                    e.dataTransfer.effectAllowed = 'move';
                    // Fade the row slightly while dragging it
                    setTimeout(() => row.style.opacity = '0.4', 0);
                });
                row.addEventListener('dragend', () => {
                    row.style.opacity = '1';
                    window._draggedWidget = null;
                });
                row.addEventListener('dragover', (e) => {
                    e.preventDefault(); // Necessary to allow dropping
                    e.dataTransfer.dropEffect = 'move';
                });
                row.addEventListener('dragenter', (e) => {
                    e.preventDefault();
                    row.style.outline = '2px dashed #ffeb3b';
                    row.style.outlineOffset = '-2px';
                });
                row.addEventListener('dragleave', () => {
                    row.style.outline = '';
                });
                row.addEventListener('drop', (e) => {
                    e.preventDefault();
                    e.stopPropagation(); // Stop LCD background drop from double-firing
                    row.style.outline = '';
                    const dragged = window._draggedWidget;
                    if (dragged && dragged !== widget) {
                        // Swap the lcdRow indexes between the two rows
                        const tempRow = dragged.lcdRow || 1;
                        dragged.lcdRow = widget.lcdRow || 1;
                        widget.lcdRow = tempRow;
                        renderScreen(jsonPath);
                    }
                });
            }

            if (widget.type === 'menu_row') {
                                // Value
                                let liveWidget = (window._currentScreenData?.widgets || []).find(w => w.type === 'menu_row' && w.id === widget.id) || widget;
                                const valueSpan = document.createElement('span');
                                if (widget.valueId) valueSpan.id = widget.valueId;
                                const isMainHome = data.page === 'MAIN_DISPLAY';
                                const rawVal = (liveWidget.value ?? liveWidget.options?.[0] ?? '').toString();
                                const ipv4RowIds = ['ui_item_ip', 'ui_item_mask', 'ui_item_gw'];
                                const ipv4Html = !isMainHome && ipv4RowIds.includes(widget.id) ? formatIPv4AlignedHtml(rawVal) : null;
                                if (ipv4Html) valueSpan.innerHTML = ipv4Html;
                                else valueSpan.textContent = rawVal;
                                valueSpan.style.display = 'inline-block';
                                valueSpan.style.padding = '0';
                                valueSpan.style.margin = '0';
                                if (isMainHome) {
                                    valueSpan.style.background = 'transparent';
                                    valueSpan.style.color = '#ffffff';
                                    valueSpan.style.border = '1px solid #ffffff';
                                    valueSpan.style.borderRadius = '4px';
                                    valueSpan.style.padding = '4px 10px';
                                    valueSpan.style.boxSizing = 'border-box';
                                } else {
                                    valueSpan.style.background = '#fff';
                                    valueSpan.style.color = '#003366';
                                    valueSpan.style.borderRadius = '8px';
                                    valueSpan.style.display = 'inline-flex';
                                    valueSpan.style.alignItems = 'center';
                                    valueSpan.style.justifyContent = ipv4Html ? 'flex-start' : 'flex-end';
                                    valueSpan.style.boxSizing = 'border-box';
                                    valueSpan.style.minHeight = Math.max(0, menuRowPixelHeight - 6) + 'px';
                                }
                                valueSpan.style.fontWeight = 'bold';
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
                if (data.page === 'MAIN_DISPLAY') {
                    highlight.style.background = 'rgba(255,255,255,0.22)';
                    highlight.style.opacity = (widget.id === focusedMenuRow?.id) ? '1' : '0';
                } else {
                    highlight.style.background = data.styles?.highlight || '#008080';
                    highlight.style.opacity = (widget.id === focusedMenuRow?.id) ? '1' : '0';
                }
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
                if (data.page === 'MAIN_DISPLAY') {
                    row.style.background = 'transparent';
                    row.style.boxShadow = '';
                } else if (widget.id !== focusedMenuRow.id) {
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
                labelSpanFixed.textContent = (data.page === 'MAIN_DISPLAY' ? '' : '\u00A0') + widget.label;
                // Removed left padding, use non-breaking space for shift
                labelSpanFixed.style.display = 'inline-block';
                labelSpanFixed.style.width = (widget.labelWidth || data.layout?.labelColumn?.width || 120) + 'px';
                labelSpanFixed.style.textAlign = widget.labelAlign || data.layout?.labelColumnLayout?.align || 'left';
                labelSpanFixed.style.fontWeight = 'bold';
                labelSpanFixed.style.color = '#fff';
                labelSpanFixed.style.padding = '0';
                labelSpanFixed.style.margin = '0';
                labelSpanFixed.style.overflow = 'hidden';
                labelSpanFixed.style.textOverflow = 'ellipsis';
                labelSpanFixed.style.whiteSpace = 'nowrap';

                if (window._isVisualEditMode) {
                    labelSpanFixed.style.outline = '1px dashed lightgrey';
                    labelSpanFixed.style.cursor = 'ew-resize';
                    labelSpanFixed.contentEditable = 'true';
                    labelSpanFixed.addEventListener('blur', (e) => {
                        widget.label = e.target.innerText.replace('\u00A0', '').trim();
                    });
                    labelSpanFixed.addEventListener('contextmenu', (e) => showAlignmentMenu(e, widget, 'labelAlign'));
                    // Fast resize using mouse wheel
                    labelSpanFixed.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const charWidth = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
                        const defaultWidth = data.layout?.labelColumn?.width || 120;
                        let currentWidth = widget.labelWidth || defaultWidth;
                        if (e.deltaY < 0) widget.labelWidth = currentWidth + charWidth; // scroll up grows
                        else widget.labelWidth = Math.max(charWidth, currentWidth - charWidth); // scroll down shrinks
                        renderScreen(jsonPath);
                    });
                }
                row.appendChild(labelSpanFixed);
                // (removed duplicate labelSpan code)
                valueSpan.style.textAlign = widget.valueAlign || data.layout?.valueBoxTextAlign || 'right';
                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                valueSpan.style.paddingRight = 0;
                valueSpan.style.whiteSpace = 'nowrap';
                valueSpan.style.overflow = 'hidden';
                valueSpan.style.textOverflow = 'ellipsis';
                if (data.page === 'MAIN_DISPLAY') {
                    valueSpan.style.padding = '4px 10px';
                    valueSpan.style.boxSizing = 'border-box';
                }

                const longParamIds = ['ui_item_ip', 'ui_item_mask', 'ui_item_gw'];
                const isLongParam = widget.longValue === true || longParamIds.includes(widget.id);
                if (isLongParam && !isMainHome) {
                    valueSpan.style.overflowX = 'auto';
                    valueSpan.style.overflowY = 'hidden';
                    valueSpan.style.textOverflow = 'clip';
                    valueSpan.title = 'Scroll wheel to see full text; ↑/↓ adjusts octet when editing IP';
                }

                if (window._isVisualEditMode) {
                    valueSpan.style.outline = '1px dashed lightgrey';
                    valueSpan.style.cursor = 'ew-resize';
                    valueSpan.addEventListener('contextmenu', (e) => showAlignmentMenu(e, widget, 'valueAlign'));
                    // Fast resize using mouse wheel
                    valueSpan.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const charWidth = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
                        const defaultWidth = data.layout?.valueColumn?.width || 100;
                        let currentWidth = widget.valueWidth || defaultWidth;
                        if (e.deltaY < 0) widget.valueWidth = currentWidth + charWidth; // scroll up grows
                        else widget.valueWidth = Math.max(charWidth, currentWidth - charWidth); // scroll down shrinks
                        renderScreen(jsonPath);
                    });
                } else if (isLongParam && !isMainHome) {
                    valueSpan.addEventListener('wheel', (e) => {
                        if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                        e.preventDefault();
                        valueSpan.scrollLeft += e.deltaY;
                    }, { passive: false });
                }
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
    const buttonWidgets = (data.widgets || []).filter(w => w.type === 'button');
    // Sanitize legacy hardcoded coordinates so auto-centering works properly again
    buttonWidgets.forEach(w => {
        if (w.x === 0) delete w.x;
    });
    const defaultFooterY = data.layout?.footerLayout?.y ?? data.layout?.footer?.y ?? 435;
    const footerPadding = data.layout?.footerPadding ?? 0;
    const footerBottomPadding = data.layout?.footerBottomPadding ?? 0;
    // Center the button row horizontally with gap (reuse lcdCanvasWidth from canvas setup above)
    const buttonGap = data.layout?.buttonGap ?? data.layout?.buttonHorizontalGap ?? 0;
    const buttonWidths = buttonWidgets.map(w => w.width !== undefined ? w.width : 72);
    const totalButtonWidth = buttonWidths.reduce((a, b) => a + b, 0) + buttonGap * (buttonWidgets.length - 1);
    const startX = Math.round((lcdCanvasWidth - totalButtonWidth) / 2);
    let runningX = startX;
    buttonWidgets.forEach((widget, idx) => {
        const btn = document.createElement('div');
        btn.textContent = widget.label;
        btn.style.position = 'absolute';
        const currentX = widget.x !== undefined ? widget.x : runningX;
        btn.style.left = currentX + 'px';
        let y = (widget.y !== undefined ? widget.y : defaultFooterY);
        btn.style.top = (y - footerPadding - footerBottomPadding) + 'px';
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
            btn.style.fontSize = data.styles?.fontSize || '22px';
        }

        // Add navigation click handlers
        if (widget.id === 'btn_back') {
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => {
                if (data.page === 'SETUP_MENU') {
                    window.navigateTo('main');
                } else if (data.page !== 'MAIN_DISPLAY') {
                    window.navigateTo('setup'); // All submenus go back to the setup menu
                }
            });
        } else if (widget.id === 'btn_settings') {
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => window.navigateTo('setup'));
        } else if (widget.id === 'btn_next') {
            btn.style.cursor = 'pointer';
            btn.addEventListener('click', () => {
                const menuRows = getMenuRows(data);
                if (!menuRows.length) return;
                let focusIdx = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
                focusIdx = ((focusIdx % menuRows.length) + menuRows.length) % menuRows.length;
                if (data.page === 'SETUP_MENU') {
                    openSetupFocusedRow(menuRows, focusIdx);
                    return;
                }
                if (data.page === 'MAIN_DISPLAY') {
                    // Home screen NEXT behavior: cycle focused parameter row.
                    focusIdx = (focusIdx + 1) % menuRows.length;
                    window._currentScreenFocus = focusIdx;
                    renderScreen(window._currentJsonPath);
                    return;
                }
                focusIdx = advanceFocusByRight(data, menuRows, focusIdx);
                window._currentScreenFocus = focusIdx;
                renderScreen(window._currentJsonPath);
            });
        }

        if (window._isVisualEditMode) {
            btn.style.outline = '1px dashed lightgrey';
            btn.style.cursor = 'context-menu';
            btn.contentEditable = 'true';
            btn.addEventListener('blur', (e) => {
                widget.label = e.target.innerText.trim();
            });
            
            btn.addEventListener('contextmenu', (e) => {
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
                const charW = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
                
                const nudgeLeft = document.createElement('button');
                nudgeLeft.textContent = 'Nudge Left (-1 char)';
                nudgeLeft.style.margin = '2px';
                nudgeLeft.onclick = () => { widget.x = currentX - charW; renderScreen(jsonPath); menu.remove(); };
                menu.appendChild(nudgeLeft);
                
                const nudgeRight = document.createElement('button');
                nudgeRight.textContent = 'Nudge Right (+1 char)';
                nudgeRight.style.margin = '2px';
                nudgeRight.onclick = () => { widget.x = currentX + charW; renderScreen(jsonPath); menu.remove(); };
                menu.appendChild(nudgeRight);
                
                document.body.appendChild(menu);
                setTimeout(() => { const closeMenu = (evt) => { if (!menu.contains(evt.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } }; document.addEventListener('click', closeMenu); }, 0);
            });
        }
        lcd.appendChild(btn);
        runningX = currentX + btnWidth + buttonGap;
    });

    // WiFi settings: show full focused value on the row immediately above the footer buttons
    if (data.page === 'WIFI_SETTINGS') {
        const menuRowsList = (data.widgets || []).filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
        const focusIdx = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
        const focused = menuRowsList[Math.min(Math.max(0, focusIdx), Math.max(0, menuRowsList.length - 1))];
        const firstBtn = buttonWidgets[0];
        const footerY = firstBtn && firstBtn.y !== undefined ? firstBtn.y : defaultFooterY;
        const footerPad = (data.layout?.footerPadding ?? 0) + (data.layout?.footerBottomPadding ?? 0);
        const buttonTopPx = footerY - footerPad;
        const previewTopPx = Math.max(0, buttonTopPx - menuRowPixelHeight);

        const preview = document.createElement('div');
        preview.className = 'tstat-wifi-focus-preview';
        preview.setAttribute('aria-live', 'polite');
        preview.style.position = 'absolute';
        preview.style.left = '0';
        preview.style.width = '100%';
        preview.style.height = menuRowPixelHeight + 'px';
        preview.style.top = previewTopPx + 'px';
        preview.style.boxSizing = 'border-box';
        preview.style.padding = '4px 10px';
        preview.style.display = 'flex';
        preview.style.alignItems = 'center';
        preview.style.justifyContent = 'center';
        preview.style.fontFamily = data.styles?.fontFamily || 'monospace';
        preview.style.fontSize = '22px';
        preview.style.fontWeight = 'bold';
        preview.style.color = '#fff';
        preview.style.background = 'rgba(0,0,0,0.32)';
        preview.style.borderTop = '1px solid rgba(255,255,255,0.22)';
        preview.style.borderBottom = '1px solid rgba(255,255,255,0.12)';
        preview.style.zIndex = '12';
        preview.style.overflowX = 'auto';
        preview.style.overflowY = 'hidden';
        preview.style.whiteSpace = 'nowrap';
        preview.style.pointerEvents = 'none';

        if (focused) {
            const live = (data.widgets || []).find(w => w.type === 'menu_row' && w.id === focused.id) || focused;
            const raw = (live.value ?? live.options?.[0] ?? '').toString();
            preview.textContent = `${live.label}: ${raw}`;
        }
        lcd.appendChild(preview);
    }
}

/**
 * Home screen (MAIN_DISPLAY): SET = setpoint step; FAN/SYS = MSV-style option lists (var2/var3).
 * Setpoint uses step/min/max on main_row_set; fan order matches MODBUS 0–4: OFF, LOW, MED, HIGH, AUTO.
 */
function adjustMainHomeRowValue(origRow, e) {
    const isUp = e.key === 'ArrowUp';
    const normalize = v => (typeof v === 'string' ? v.trim().toLowerCase() : String(v).toLowerCase());

    if (origRow.homeRow === 'setpoint' || origRow.id === 'main_row_set') {
        const step = origRow.step ?? 0.5;
        const min = origRow.min ?? 10;
        const max = origRow.max ?? 35;
        let v = parseFloat(String(origRow.value).replace(',', '.')) || 0;
        if (isUp) v = Math.min(max, Math.round((v + step) * 100) / 100);
        else v = Math.max(min, Math.round((v - step) * 100) / 100);
        origRow.value = v.toFixed(2);
        if (typeof window.updateUI === 'function') window.updateUI({ stp: v });
        return;
    }

    if (origRow.options && origRow.options.length) {
        let currentIdx = origRow.options.findIndex(opt => normalize(opt) === normalize(origRow.value));
        if (currentIdx === -1) currentIdx = 0;
        if (origRow.options.length === 2) {
            origRow.value = String(
                normalize(origRow.value) === normalize(origRow.options[0])
                    ? origRow.options[1]
                    : origRow.options[0]
            );
        } else if (isUp) {
            if (currentIdx < origRow.options.length - 1) currentIdx++;
            origRow.value = String(origRow.options[currentIdx]);
        } else {
            if (currentIdx > 0) currentIdx--;
            origRow.value = String(origRow.options[currentIdx]);
        }
        const payload = {};
        if (origRow.id === 'main_row_fan') payload.fan = origRow.value;
        if (origRow.id === 'main_row_sys') payload.sys = origRow.value;
        if (typeof window.updateUI === 'function' && Object.keys(payload).length) window.updateUI(payload);
    }
}

function getMenuRows(data) {
    return (data.widgets || [])
        .filter(w => w.type === 'menu_row')
        .sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
}

function openSetupFocusedRow(menuRows, focusedIndex) {
    const focusedRow = menuRows[focusedIndex];
    if (!focusedRow) return;
    if (focusedRow.id === 'ui_item_rs485') window.navigateTo('settings');
    else if (focusedRow.id === 'ui_item_ethernet') window.navigateTo('ethernet');
    else if (focusedRow.id === 'ui_item_clock') window.navigateTo('clock');
    else if (focusedRow.id === 'ui_item_oat') window.navigateTo('oat');
    else if (focusedRow.id === 'ui_item_tbd') window.navigateTo('tbd');
}

function advanceFocusByRight(data, menuRows, focusedIndex) {
    if (!menuRows.length) return focusedIndex;
    const focusedRow = menuRows[focusedIndex];
    // WIFI IP edit mode: Right moves to next octet instead of next row.
    if (data.page === 'WIFI_SETTINGS' && focusedRow && focusedRow.id === 'ui_item_ip') {
        const currentOctet = Number(window._ipEditOctetIndex || 0);
        window._ipEditOctetIndex = (currentOctet + 1) % 4;
        return focusedIndex;
    }
    window._ipEditOctetIndex = 0;
    return (focusedIndex + 1) % menuRows.length;
}

// Combined arrow key handler: handles both menu and redbox movement
function handleArrowKey(e) {
    if (e.key === 'ArrowLeft') {
        _leftArrowDown = true;
        tryStartLeftRightLongPressTimer();
    } else if (e.key === 'ArrowRight') {
        _rightArrowDown = true;
        tryStartLeftRightLongPressTimer();
    }

    // Try redbox movement first (only up/down)
    if (handleRedboxArrowKey(e)) return;
    window._tstatLastEvent = e.key;
    console.log('[KeyEvent]', e.key);

    // Setup Menu Shortcut: 's' key or simulated via Left+Right long press
    if (e.key.toLowerCase() === 's') {
        if (window._currentScreenData && window._currentScreenData.page === 'MAIN_DISPLAY') {
            window.navigateTo('setup');
        }
        return;
    }

    // Immediately update debug panel after key event
    if (typeof updateDebugPanel === 'function') {
        updateDebugPanel(window._currentScreenData);
    }
    const data = window._currentScreenData;
    if (!data) return;

    // Only handle menu navigation on screens with menu rows
    const menuRows = getMenuRows(data);
    if (menuRows.length === 0) {
        return;
    }
    let focusedIndex = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
    focusedIndex = ((focusedIndex % menuRows.length) + menuRows.length) % menuRows.length;
    window._currentScreenFocus = focusedIndex;

    if (data.page === 'SETUP_MENU') {
        // Setup Menu logic: Up/Down moves focus, Right selects, Left goes back
        if (e.key === 'ArrowUp') {
            focusedIndex = (focusedIndex - 1 + menuRows.length) % menuRows.length;
            window._currentScreenFocus = focusedIndex;
            window._ipEditOctetIndex = 0;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowDown') {
            focusedIndex = (focusedIndex + 1) % menuRows.length;
            window._currentScreenFocus = focusedIndex;
            window._ipEditOctetIndex = 0;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowRight') {
            openSetupFocusedRow(menuRows, focusedIndex);
            return;
        } else if (e.key === 'Enter') {
            openSetupFocusedRow(menuRows, focusedIndex);
            return;
        } else if (e.key === 'ArrowLeft') {
            window.navigateTo('main');
            return;
        }
    } else {
        // Home (MAIN_DISPLAY): Right cycles focus SET → FAN → SYS; Left opens setup menu; Up/Down reserved
        if (data.page === 'MAIN_DISPLAY') {
            if (e.key === 'ArrowRight') {
                focusedIndex = advanceFocusByRight(data, menuRows, focusedIndex);
                window._currentScreenFocus = focusedIndex;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (e.key === 'ArrowLeft') {
                window.navigateTo('setup');
                return;
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                const origRow = data.widgets.find(w => w.type === 'menu_row' && w.id === menuRows[focusedIndex].id);
                if (origRow) adjustMainHomeRowValue(origRow, e);
                renderScreen(window._currentJsonPath);
                return;
            }
            return;
        }
        // Settings Pages Navigation Standard: 
        // Right arrow (NEXT) moves focus to the NEXT item (+1, visually DOWN the list)
        // Left arrow (BACK) exits the current screen and returns to the Setup Menu
        if (e.key === 'ArrowRight') {
            focusedIndex = advanceFocusByRight(data, menuRows, focusedIndex);
            window._currentScreenFocus = focusedIndex;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowLeft') {
            window.navigateTo('setup');
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
                    let octetIndex = Number(window._ipEditOctetIndex || 0);
                    if (Number.isNaN(octetIndex) || octetIndex < 0 || octetIndex > 3) octetIndex = 0;
                    if (e.key === 'ArrowUp') parts[octetIndex] = (parts[octetIndex] + 1) % 256;
                    else parts[octetIndex] = (parts[octetIndex] - 1 + 256) % 256;
                    origRow.value = parts.join('.');
                }
            }
            renderScreen(window._currentJsonPath);
            return;
        }
    }
    // No action for other keys
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.navigateTo('main');
        window.addEventListener('keydown', handleArrowKey);
        window.addEventListener('keyup', (e) => {
            if (e.key === 'ArrowLeft') {
                _leftArrowDown = false;
                clearLeftRightLongPressTimer();
            } else if (e.key === 'ArrowRight') {
                _rightArrowDown = false;
                clearLeftRightLongPressTimer();
            }
        });
        window.addEventListener('blur', () => {
            _leftArrowDown = false;
            _rightArrowDown = false;
            clearLeftRightLongPressTimer();
        });
    });
} else {
    window.navigateTo('main');
    window.addEventListener('keydown', handleArrowKey);
    window.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft') {
            _leftArrowDown = false;
            clearLeftRightLongPressTimer();
        } else if (e.key === 'ArrowRight') {
            _rightArrowDown = false;
            clearLeftRightLongPressTimer();
        }
    });
    window.addEventListener('blur', () => {
        _leftArrowDown = false;
        _rightArrowDown = false;
        clearLeftRightLongPressTimer();
    });
}
