// debug-panel-fixed.js: Update debug/status panel values from global state
// Can be reused on other simulator pages

/**
 * Updates the debug panel values (event, keypad, focus, value) from global state.
 * @param {object} data - The menu data object (should have widgets).
 */
export function updateDebugPanel(data) {
    const eventVal = document.getElementById('debug-event-value');
    const keypadVal = document.getElementById('debug-keypad-value');
    const focusVal = document.getElementById('debug-focus-value');
    const valueVal = document.getElementById('debug-value-value');
    const menuRows = (data?.widgets || []).filter(w => w.type === 'menu_row');
    const focusIdx = window._currentScreenFocus || 0;
    const debugObj = {
        event: window._tstatLastEvent || '',
        keypad: window._tstatLastKeypad || '',
        focus: menuRows[focusIdx]?.label || '',
        value: menuRows[focusIdx]?.value || ''
    };
    if (eventVal) eventVal.textContent = debugObj.event;
    if (keypadVal) keypadVal.textContent = debugObj.keypad;
    if (focusVal) focusVal.textContent = debugObj.focus;
    if (valueVal) valueVal.textContent = debugObj.value;
    // Pipe debug data to local endpoint (DISABLED)
    // No fetch call here!
    // Update status line if present
    const statusLine = document.getElementById('tstat-status-line');
    if (statusLine) {
        statusLine.textContent = `Event: ${debugObj.event} | Focus: ${debugObj.focus} | Value: ${debugObj.value}`;
    }
}
