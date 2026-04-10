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
import {
    ensureCanonicalSchema,
    validateLayoutData,
    writeStatus,
    attachFloatingPanelDrag,
    widgetAcceptsChildren,
    normalizeWidgetTreeOrder,
    isWidgetDescendantOf
} from './lcd-editor-core.js';

const SIMULATED_LR_LONG_PRESS_MS = 3000;
let _leftRightLongPressTimer = null;
let _leftArrowDown = false;
let _rightArrowDown = false;

function clearLeftRightLongPressTimer() {
    if (_leftRightLongPressTimer) {
        clearTimeout(_leftRightLongPressTimer);
        _leftRightLongPressTimer = null;
    }
}

function performMainDisplayEnterSetupMenu() {
    const page = window._currentScreenData?.page;
    if (page !== 'MAIN_DISPLAY') return;
    window._ipEditMode = false;
    window._valueEditMode = false;
    window.navigateTo('setup');
}

function tryStartLeftRightLongPressTimer() {
    if (!_leftArrowDown || !_rightArrowDown || _leftRightLongPressTimer) return;
    _leftRightLongPressTimer = setTimeout(() => {
        _leftRightLongPressTimer = null;
        if (_leftArrowDown && _rightArrowDown) {
            performMainDisplayEnterSetupMenu();
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
function formatIPv4AlignedHtml(value, activeOctetIndex = null) {
    const s = String(value).trim();
    const parts = s.split('.');
    if (parts.length !== 4) return null;
    if (!parts.every(p => /^\d{1,3}$/.test(p))) return null;
    const oct = (p, idx) => {
        const activeClass = idx === activeOctetIndex ? ' tstat-ipv4-oct--active' : '';
        return `<span class="tstat-ipv4-oct${activeClass}">${escapeHtml(p)}</span>`;
    };
    const dot = '<span class="tstat-ipv4-dot">.</span>';
    return `${oct(parts[0], 0)}${dot}${oct(parts[1], 1)}${dot}${oct(parts[2], 2)}${dot}${oct(parts[3], 3)}`;
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
            border-radius: 4px;
            padding: 1px 2px;
        }
        #tstat-lcd-container .tstat-ipv4-oct--active {
            background: #f59e0b;
            color: #0f172a;
            box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.35);
        }
        #tstat-lcd-container .tstat-ipv4-dot { display: inline-block; }
        #tstat-lcd-container .tstat-value-box.tstat-endpoint-flash {
            background: #ef4444 !important;
            color: #ffffff !important;
            box-shadow: 0 0 0 2px rgba(127, 29, 29, 0.45) inset;
        }
        #tstat-lcd-container .tstat-value-box.tstat-edit-active {
            box-shadow: 0 0 0 2px #f59e0b inset;
            border-color: #f59e0b !important;
            background: #fff7ed !important;
            color: #7c2d12 !important;
        }
    `;
    document.head.appendChild(st);
}

function getScreenStateMap() {
    if (!window._screenStateByJsonPath) window._screenStateByJsonPath = {};
    return window._screenStateByJsonPath;
}

function cacheKeyForJsonPath(jsonPath) {
    return `tstat_cache_${jsonPath}`;
}

function saveScreenToCache(jsonPath, data) {
    if (!jsonPath || !data) return;
    try {
        localStorage.setItem(cacheKeyForJsonPath(jsonPath), JSON.stringify(data, null, 2));
    } catch (err) {
        console.warn('[Visual Edit] Failed to persist cache:', err);
    }
}

function loadScreenFromCache(jsonPath) {
    try {
        const raw = localStorage.getItem(cacheKeyForJsonPath(jsonPath));
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        console.warn('[Visual Edit] Failed to read cache:', err);
        return null;
    }
}

function getIconPaletteStorageKey() {
    return 'tstat_icon_palette_custom_svgs_v2';
}

function loadCustomPaletteSvgs() {
    try {
        const raw = localStorage.getItem(getIconPaletteStorageKey());
        const arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return [];
        return arr
            .map((item, idx) => {
                if (typeof item === 'string' && item.includes('<svg')) {
                    return { name: `Custom ${idx + 1}`, svg: item };
                }
                if (item && typeof item === 'object' && typeof item.svg === 'string' && item.svg.includes('<svg')) {
                    return { name: String(item.name || `Custom ${idx + 1}`), svg: item.svg };
                }
                return null;
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

function saveCustomPaletteSvgs(list) {
    try {
        const normalized = list
            .slice(0, 32)
            .map((item, idx) => ({
                name: String(item?.name || `Custom ${idx + 1}`),
                svg: String(item?.svg || '')
            }))
            .filter((item) => item.svg.includes('<svg'));
        localStorage.setItem(getIconPaletteStorageKey(), JSON.stringify(normalized));
    } catch (err) {
        console.warn('[IconPalette] Failed to persist custom SVGs:', err);
    }
}

function ensureMainDisplayIconLayout(data) {
    if (!data || data.page !== 'MAIN_DISPLAY') return;
    if (!Array.isArray(data.widgets)) data.widgets = [];
    const maxY = 480 - 64;
    const clampY = (y) => Math.max(0, Math.min(maxY, Number(y || 0)));
    const iconIds = ['main_icon_day_night', 'main_icon_occupied', 'main_icon_heat_cool', 'main_icon_fan'];
    const group = data.widgets.find((w) => w?.id === 'main_icons_group');
    const parts = data.widgets.filter((w) => iconIds.includes(w?.id));

    if (!group && parts.length === 0) {
        data.widgets.push({
            type: 'label',
            id: 'main_icons_group',
            text: '<div style="display:flex;gap:10px;justify-content:center;align-items:center;width:296px;box-sizing:border-box;padding:0 8px"></div>',
            x: 160,
            y: 400,
            align: 'center',
            color: '#ffffff',
            wrap: true,
            width: 320
        });
    }

    data.widgets.forEach((w) => {
        if (!w || w.type !== 'label') return;
        const iconLikeText = typeof w.text === 'string' && (
            w.text.includes('title="Day / night"') ||
            w.text.includes('title="Occupied / unoccupied"') ||
            w.text.includes('title="Heat / cool"') ||
            w.text.includes('title="Fan"')
        );
        const iconLikeId = (typeof w.id === 'string' && w.id.startsWith('main_icon_')) || iconIds.includes(w.id);
        if (w.id === 'main_icons_group' || iconLikeId || iconLikeText) {
            w.y = clampY(w.y);
        }
    });
}

function resolveMenuRowLabel(widget) {
    const base = String(widget?.label || '');
    const custom = String(widget?.labelCustom ?? base);
    const mode = String(widget?.labelDisplayMode || '').toLowerCase();
    if (mode === 'none') return '';
    if (mode === '8char') return custom.slice(0, 8);
    if (mode === '20char') return custom.slice(0, 20);
    if (mode === 'custom') return custom;
    // Backward-compatible default behavior.
    return base;
}

function inferMenuRowTreeName(widget) {
    const id = String(widget?.id || '').toLowerCase();
    const label = String(widget?.label || '').trim();
    const value = String(widget?.value ?? '').trim();
    const known = {
        ui_item_ip: 'IP Address',
        ui_item_mask: 'Subnet Mask',
        ui_item_gw: 'Gateway',
        ui_item_dhcp: 'DHCP',
        ui_item_prov_ap: 'Provisioning AP',
        ui_item_prov_pwd: 'Provisioning Password',
        ui_item_prov_ap: 'AP',
        ui_item_prov_ssid: 'Network (from phone)',
        ui_item_prov_pass: 'Pass',
        ui_item_prov_status: 'Status',
        ui_item_prov_rssi: 'RSSI',
        ui_item_prov_rssi_quality: 'Signal strength',
        ui_item_addr: 'Device Address',
        ui_item_baud: 'Baud Rate'
    };
    if (known[id]) return known[id];
    if (label.toUpperCase() === 'IP') return 'IP Address';
    if (label.toUpperCase() === 'MASK') return 'Subnet Mask';
    if (label.toUpperCase() === 'GATE') return 'Gateway';
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return `${label || 'IPv4'} Address`;
    return label || widget?.id || 'Row';
}

function getWidgetTreeName(widget) {
    if (!widget || typeof widget !== 'object') return '(unnamed)';
    if (typeof widget.treeName === 'string' && widget.treeName.trim()) return widget.treeName.trim();
    if (widget.type === 'menu_row') return inferMenuRowTreeName(widget);
    if (widget.type === 'label' && (widget.libraryIconName || widget.libraryIconId)) {
        return `Icon ${widget.libraryIconName || widget.libraryIconId}`;
    }
    if (widget.id) return widget.id;
    if (widget.label) return widget.label;
    if (typeof widget.text === 'string' && widget.text.trim()) {
        const raw = widget.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return raw || '(unnamed)';
    }
    return '(unnamed)';
}

function getLastScreenStorageKey() {
    return 'tstat_last_screen_v1';
}

function saveLastScreenPath(jsonPath) {
    if (!jsonPath) return;
    try {
        localStorage.setItem(getLastScreenStorageKey(), String(jsonPath));
    } catch {}
}

function loadLastScreenPath() {
    try {
        const v = localStorage.getItem(getLastScreenStorageKey());
        return v || null;
    } catch {
        return null;
    }
}

function ensureT3000PointState() {
    if (!window._t3000PointState) {
        window._t3000PointState = {};
        for (let i = 1; i <= 9; i += 1) {
            window._t3000PointState[`IN${i}`] = { name: `Input ${i}`, value: i === 9 ? 22.4 : 0 };
        }
        for (let i = 1; i <= 4; i += 1) {
            window._t3000PointState[`VAR${i}`] = { name: `Variable ${i}`, value: 0 };
        }
        // Requested default: occupied icon follows VAR4.
        window._t3000PointState.VAR4.value = 1;
    }
    return window._t3000PointState;
}

function getT3000PointOptions(prefix) {
    const state = ensureT3000PointState();
    const points = Object.keys(state)
        .filter((k) => !prefix || k.startsWith(prefix))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return points.map((key) => ({
        key,
        label: `${key} - ${state[key].name}: ${state[key].value}`
    }));
}

function getT3000PointValue(pointKey) {
    if (!pointKey) return null;
    const state = ensureT3000PointState();
    return state[pointKey] ? state[pointKey].value : null;
}

function asBoolean(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    const normalized = String(v ?? '').trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

function buildMainIconMarkup(iconKey, active) {
    const occupiedPerson = active
        ? '<circle cx="24" cy="33" r="2.5" fill="#fff"/><path d="M24 35.5v3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M21 38h6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>'
        : '<circle cx="39" cy="33" r="2.5" fill="#fff"/><path d="M39 35.5v3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M36 38h6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/>';
    const iconMap = {
        day_night: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="20" r="5" fill="#fff"/><path d="M13 11v2M13 27v2M7 20h2M17 20h2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="33" cy="20" r="7" fill="#fff"/><circle cx="37" cy="20" r="6.5" fill="#2c7cc4"/></svg>',
        occupied: `<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 28 L24 16 L38 28" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="12" y="28" width="24" height="12" stroke="#fff" stroke-width="1.5" fill="none"/><path d="M20 40v-7h8v7" stroke="#fff" stroke-width="1.2" fill="none"/>${occupiedPerson}</svg>`,
        heat_cool: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 30c-4-8 6-12 6-20 0 8 8 8 4 10-4-2-2-12-2-10z" fill="#fff"/><line x1="23" y1="10" x2="23" y2="38" stroke="#fff" stroke-width="2" stroke-linecap="round"/><g transform="translate(36,24)" stroke="#fff" stroke-width="1.2" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="9"/><line x1="-7.8" y1="-4.5" x2="7.8" y2="4.5"/><line x1="-7.8" y1="4.5" x2="7.8" y2="-4.5"/></g></svg>',
        fan: '<svg width="50" height="50" viewBox="0 0 52 48" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(14,24)"><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(120)"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(240)"/></g><circle cx="14" cy="24" r="2.5" fill="#fff"/><line x1="28" y1="8" x2="28" y2="40" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="31" y="10" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="19" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="28" width="11" height="8" rx="0.5" fill="#e8f4ff" stroke="#fff" stroke-width="1.2"/></svg>'
    };
    const activeBg = active ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.1)';
    return `<div data-icon-key="${iconKey}" style="width:54px;height:54px;border:1px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;background:${activeBg}">${iconMap[iconKey]}</div>`;
}

function renderMainIconsGroupText(widget) {
    const bindings = widget.t3IconBindings || {};
    const icons = [
        ['day_night', bindings.day_night || 'VAR1'],
        ['occupied', bindings.occupied || 'VAR4'],
        ['heat_cool', bindings.heat_cool || 'VAR2'],
        ['fan', bindings.fan || 'VAR3']
    ];
    const html = icons.map(([iconKey, point]) => buildMainIconMarkup(iconKey, asBoolean(getT3000PointValue(point)))).join('');
    return `<div style="display:flex;gap:10px;justify-content:center;align-items:center;width:296px;box-sizing:border-box;padding:0 8px">${html}</div>`;
}

function isIpv4RowId(rowId) {
    return rowId === 'ui_item_ip' || rowId === 'ui_item_mask' || rowId === 'ui_item_gw';
}

function triggerEndpointFlash(rowId) {
    if (!rowId) return;
    const row = document.querySelector(`[data-menu-row-id="${rowId}"]`);
    if (!row) return;
    const valueEl = row.querySelector('.tstat-value-box');
    if (!valueEl) return;
    valueEl.classList.remove('tstat-endpoint-flash');
    void valueEl.offsetWidth;
    valueEl.classList.add('tstat-endpoint-flash');
    setTimeout(() => valueEl.classList.remove('tstat-endpoint-flash'), 180);
}

function ungroupMainIcons() {
    const data = window._currentScreenData;
    if (!data || data.page !== 'MAIN_DISPLAY') return false;
    const widgets = data.widgets || [];
    const groupIdx = widgets.findIndex((w) => w.type === 'label' && (w.id === 'main_icons_group' || String(w.text || '').includes('title="Day / night"')));
    if (groupIdx === -1) return false;
    const group = widgets[groupIdx];
    window._mainIconsGroupTemplate = JSON.parse(JSON.stringify(group));
    const iconDefs = [
        { id: 'main_icon_day_night', x: 79, y: 352, title: 'Day / night', svg: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="13" cy="20" r="5" fill="#fff"/><path d="M13 11v2M13 27v2M7 20h2M17 20h2" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><circle cx="33" cy="20" r="7" fill="#fff"/><circle cx="37" cy="20" r="6.5" fill="#2c7cc4"/></svg>' },
        { id: 'main_icon_occupied', x: 143, y: 352, title: 'Occupied / unoccupied', svg: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 28 L24 16 L38 28" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/><rect x="12" y="28" width="24" height="12" stroke="#fff" stroke-width="1.5" fill="none"/><path d="M20 40v-7h8v7" stroke="#fff" stroke-width="1.2" fill="none"/><circle cx="24" cy="33" r="2.5" fill="#fff"/><path d="M24 35.5v3.5" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/><path d="M21 38h6" stroke="#fff" stroke-width="1.3" stroke-linecap="round"/></svg>' },
        { id: 'main_icon_heat_cool', x: 207, y: 352, title: 'Heat / cool', svg: '<svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 30c-4-8 6-12 6-20 0 8 8 8 4 10-4-2-2-12-2-10z" fill="#fff"/><line x1="23" y1="10" x2="23" y2="38" stroke="#fff" stroke-width="2" stroke-linecap="round"/><g transform="translate(36,24)" stroke="#fff" stroke-width="1.2" stroke-linecap="round"><line x1="0" y1="-9" x2="0" y2="9"/><line x1="-7.8" y1="-4.5" x2="7.8" y2="4.5"/><line x1="-7.8" y1="4.5" x2="7.8" y2="-4.5"/></g></svg>' },
        { id: 'main_icon_fan', x: 271, y: 352, title: 'Fan', svg: '<svg width="50" height="50" viewBox="0 0 52 48" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(14,24)"><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(120)"/><ellipse cx="0" cy="-8" rx="4.2" ry="11" fill="#fff" transform="rotate(240)"/></g><circle cx="14" cy="24" r="2.5" fill="#fff"/><line x1="28" y1="8" x2="28" y2="40" stroke="#fff" stroke-width="2" stroke-linecap="round"/><rect x="31" y="10" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="19" width="11" height="8" rx="0.5" fill="none" stroke="#fff" stroke-width="1.2"/><rect x="31" y="28" width="11" height="8" rx="0.5" fill="#e8f4ff" stroke="#fff" stroke-width="1.2"/></svg>' }
    ];
    const ungrouped = iconDefs.map((d) => ({
        type: 'label',
        id: d.id,
        text: `<div style="width:54px;height:54px;border:1px solid #fff;border-radius:4px;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.1)" title="${d.title}">${d.svg}</div>`,
        x: d.x,
        y: d.y,
        align: 'center',
        color: '#ffffff'
    }));
    widgets.splice(groupIdx, 1, ...ungrouped);
    return true;
}

function regroupMainIcons() {
    const data = window._currentScreenData;
    if (!data || data.page !== 'MAIN_DISPLAY') return false;
    const widgets = data.widgets || [];
    const ids = ['main_icon_day_night', 'main_icon_occupied', 'main_icon_heat_cool', 'main_icon_fan'];
    const parts = widgets.filter((w) => ids.includes(w.id));
    if (parts.length !== 4) return false;
    const minX = Math.min(...parts.map((p) => Number(p.x || 160)));
    const avgY = Math.round(parts.reduce((a, b) => a + Number(b.y || 352), 0) / parts.length);
    const template = window._mainIconsGroupTemplate || {
        type: 'label',
        id: 'main_icons_group',
        text: '<div style="display:flex;gap:10px;justify-content:center;align-items:center;width:296px;box-sizing:border-box;padding:0 8px"></div>',
        x: 160,
        y: 352,
        align: 'center',
        color: '#ffffff',
        wrap: true,
        width: 320
    };
    const grouped = { ...template, id: 'main_icons_group', x: minX + 96, y: avgY, align: 'center' };
    const firstIdx = widgets.findIndex((w) => ids.includes(w.id));
    const filtered = widgets.filter((w) => !ids.includes(w.id));
    filtered.splice(firstIdx >= 0 ? firstIdx : filtered.length, 0, grouped);
    data.widgets = filtered;
    return true;
}

function removeExistingPropertyEditor() {
    const existing = document.getElementById('layout-property-editor');
    if (existing) existing.remove();
}

function removeExistingTreeContextMenu() {
    const existing = document.getElementById('layout-tree-context-menu');
    if (existing) existing.remove();
}

function removeExistingCanvasPickMenu() {
    const existing = document.getElementById('layout-canvas-pick-menu');
    if (existing) existing.remove();
}

/** SquareLine-style: right-click on LCD shows widgets under the cursor (overlapping pick). */
function openCanvasWidgetPickMenu(e) {
    if (!window._isVisualEditMode) return;
    const stack = document.elementsFromPoint(e.clientX, e.clientY);
    const seen = new Set();
    const picks = [];
    for (const el of stack) {
        const t = el.closest?.('[data-tree-node-id]');
        if (!t) continue;
        const id = t.getAttribute('data-tree-node-id');
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const data = window._currentScreenData;
        const nodes = data ? buildPageNodes(data) : [];
        const n = nodes.find((x) => x.id === id);
        picks.push({ id, label: (n && n.text) ? String(n.text) : id });
    }
    if (picks.length === 0) return;
    e.preventDefault();
    removeExistingCanvasPickMenu();
    const menu = document.createElement('div');
    menu.id = 'layout-canvas-pick-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10040';
    menu.style.background = '#111827';
    menu.style.color = '#e5e7eb';
    menu.style.border = '1px solid #374151';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    menu.style.padding = '6px';
    menu.style.minWidth = '220px';
    menu.style.maxHeight = 'min(360px, 60vh)';
    menu.style.overflowY = 'auto';
    menu.style.fontFamily = 'Segoe UI, Inter, Arial, sans-serif';
    menu.style.fontSize = '12px';
    const title = document.createElement('div');
    title.textContent = 'Select widget';
    title.style.fontWeight = '700';
    title.style.marginBottom = '6px';
    title.style.color = '#a7f3d0';
    menu.appendChild(title);
    picks.forEach((p) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = p.label;
        btn.style.display = 'block';
        btn.style.width = '100%';
        btn.style.textAlign = 'left';
        btn.style.padding = '6px 8px';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.background = 'transparent';
        btn.style.color = '#e5e7eb';
        btn.style.cursor = 'pointer';
        btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        btn.addEventListener('click', () => {
            removeExistingCanvasPickMenu();
            if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(p.id);
            const jp = window._currentJsonPath;
            if (jp) renderScreen(jp);
        });
        menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const close = (evt) => {
        if (!menu.contains(evt.target)) {
            removeExistingCanvasPickMenu();
            document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function ensureLcdCanvasPickMenuAttached(lcd) {
    if (!lcd || lcd._slsCanvasPickBound) return;
    lcd._slsCanvasPickBound = true;
    lcd.addEventListener('contextmenu', openCanvasWidgetPickMenu);
}

function getParentIdSelectOptions(widgets, selectedIdx) {
    const opts = [{ value: '', label: '(screen root)' }];
    if (!Array.isArray(widgets) || selectedIdx < 0) return opts;
    widgets.forEach((w, i) => {
        if (!w || i === selectedIdx) return;
        if (!widgetAcceptsChildren(w)) return;
        if (isWidgetDescendantOf(widgets, i, selectedIdx)) return;
        const label = w.treeName || w.id || `widget ${i}`;
        opts.push({ value: w.id, label: `${label} (${w.type || 'item'})` });
    });
    return opts;
}

function openTreeContextMenu(e, node, jsonPath, rerender) {
    removeExistingTreeContextMenu();
    const menu = document.createElement('div');
    menu.id = 'layout-tree-context-menu';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10030';
    menu.style.background = '#111827';
    menu.style.color = '#e5e7eb';
    menu.style.border = '1px solid #374151';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    menu.style.padding = '6px';
    menu.style.minWidth = '210px';
    menu.style.fontFamily = "Segoe UI, Inter, Arial, sans-serif";
    menu.style.fontSize = '12px';

    const addItem = (label, handler, danger = false) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.display = 'block';
        btn.style.width = '100%';
        btn.style.textAlign = 'left';
        btn.style.padding = '6px 8px';
        btn.style.border = 'none';
        btn.style.borderRadius = '6px';
        btn.style.background = 'transparent';
        btn.style.color = danger ? '#fecaca' : '#e5e7eb';
        btn.style.cursor = 'pointer';
        btn.addEventListener('mouseenter', () => { btn.style.background = '#1f2937'; });
        btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
        btn.onclick = () => {
            handler?.();
            menu.remove();
        };
        menu.appendChild(btn);
    };

    const addSep = () => {
        const hr = document.createElement('div');
        hr.style.height = '1px';
        hr.style.margin = '6px 2px';
        hr.style.background = '#374151';
        menu.appendChild(hr);
    };

    const isWidgetNode = node?.childKind === 'widget';
    const idxMatch = String(node?.id || '').match(/^w-(\d+)$/);
    const widgetIndex = idxMatch ? Number(idxMatch[1]) : -1;
    const widgets = window._currentScreenData?.widgets || [];
    const widget = (widgetIndex >= 0 && widgetIndex < widgets.length) ? widgets[widgetIndex] : node?.widget;

    addItem('Rename', () => {
        const next = window.prompt('Tree name', String(widget?.treeName || getWidgetTreeName(widget) || ''));
        if (next === null) return;
        if (!widget) return;
        const clean = String(next).trim();
        if (!clean) delete widget.treeName;
        else widget.treeName = clean;
        rerender(jsonPath);
    });

    if (isWidgetNode && widgetIndex >= 0) {
        addItem('Duplicate', () => {
            if (typeof window._duplicateSelectedLayoutNode === 'function') {
                window._selectLayoutNode?.(node.id);
                window._duplicateSelectedLayoutNode();
            } else {
                const copy = JSON.parse(JSON.stringify(widget));
                if (copy?.id) copy.id = `${copy.id}_copy`;
                widgets.splice(widgetIndex + 1, 0, copy);
                rerender(jsonPath);
            }
        });
        addItem('Delete', () => {
            window._selectLayoutNode?.(node.id);
            window._deleteSelectedLayoutNode?.();
        }, true);
        addSep();
        addItem('Bring To Front', () => {
            if (widgetIndex < 0 || widgetIndex >= widgets.length) return;
            const [w] = widgets.splice(widgetIndex, 1);
            widgets.push(w);
            window._layoutSelectedNodeId = `w-${widgets.length - 1}`;
            rerender(jsonPath);
        });
        addItem('Send To Back', () => {
            if (widgetIndex < 0 || widgetIndex >= widgets.length) return;
            const [w] = widgets.splice(widgetIndex, 1);
            widgets.unshift(w);
            window._layoutSelectedNodeId = 'w-0';
            rerender(jsonPath);
        });
        addItem('Move Up', () => {
            if (widgetIndex <= 0) return;
            const tmp = widgets[widgetIndex - 1];
            widgets[widgetIndex - 1] = widgets[widgetIndex];
            widgets[widgetIndex] = tmp;
            window._layoutSelectedNodeId = `w-${widgetIndex - 1}`;
            rerender(jsonPath);
        });
        addItem('Move Down', () => {
            if (widgetIndex < 0 || widgetIndex >= widgets.length - 1) return;
            const tmp = widgets[widgetIndex + 1];
            widgets[widgetIndex + 1] = widgets[widgetIndex];
            widgets[widgetIndex] = tmp;
            window._layoutSelectedNodeId = `w-${widgetIndex + 1}`;
            rerender(jsonPath);
        });
    }

    if (widget?.id === 'main_icons_group') {
        addSep();
        addItem('Ungroup Icons', () => {
            if (typeof ungroupMainIcons === 'function' && ungroupMainIcons()) rerender(jsonPath);
        });
    }

    addSep();
    addItem('Undo', () => window._undoLayoutChange?.());

    document.body.appendChild(menu);
    setTimeout(() => {
        const closeOnOutside = (evt) => {
            if (!menu.contains(evt.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        document.addEventListener('mousedown', closeOnOutside);
    }, 0);
}

/** Menu/blank rows share lcdRow vertical slots; label/header use canvas x/y (not row slots). */
function isRowSlotWidget(w) {
    return !!w && (w.type === 'menu_row' || w.type === 'blank');
}
function isLabelLikeLayoutWidget(w) {
    return !!w && (w.type === 'label' || w.type === 'header');
}

/** CSS modifier classes for SquareLine-style hierarchy row / icon chip appearance. */
function getLayoutTreeNodeLayoutClasses(n) {
    const parts = [];
    const w = n.widget;
    if (n.childKind === 'widget' && w && typeof w.type === 'string') {
        const t = w.type.replace(/[^a-z0-9_-]/gi, '');
        if (t) parts.push(`layout-tree-node--wtype-${t}`);
    }
    if (n.childKind === 'label') parts.push('layout-tree-node--part-label');
    else if (n.childKind === 'value') parts.push('layout-tree-node--part-value');
    else if (n.childKind === 'group_icon') parts.push('layout-tree-node--part-icon');
    return parts.join(' ');
}

/**
 * Reorder drops (tree or LCD): only swap/move among peers — rows↔rows, labels/headers↔labels/headers,
 * otherwise same widget type only (no dropping a row onto a label or mixing unrelated types).
 */
function layoutDropTargetsSameHierarchy(fromW, toW) {
    if (!fromW || !toW || fromW === toW) return false;
    if (isRowSlotWidget(fromW) && isRowSlotWidget(toW)) return true;
    if (isLabelLikeLayoutWidget(fromW) && isLabelLikeLayoutWidget(toW)) return true;
    if (isRowSlotWidget(fromW) || isLabelLikeLayoutWidget(fromW)) return false;
    if (isRowSlotWidget(toW) || isLabelLikeLayoutWidget(toW)) return false;
    return fromW.type === toW.type;
}

function normalizeLcdRowSlot(n) {
    const r = Math.round(Number(n));
    return Number.isFinite(r) && r > 0 ? r : 1;
}

/**
 * True when the LCD/hierarchy selection refers to the same widget index as `nodeId`.
 * Lets row `w-3`, `w-3-label`, and `w-3-value` all act as one selection for resize/drag handles.
 * Does not match `w-3-icon-*` to value/label (different subtree).
 */
function layoutTreeSelectionMatchesNode(selectedId, nodeId) {
    if (!selectedId || !nodeId) return true;
    if (selectedId === nodeId) return true;
    const iconRe = /^w-(\d+)-icon-/;
    if (iconRe.test(selectedId) || iconRe.test(nodeId)) return false;
    const rowRe = /^w-(\d+)$/;
    const partRe = /^w-(\d+)-(label|value)$/;
    const mSelRow = selectedId.match(rowRe);
    const mNodeRow = nodeId.match(rowRe);
    const mSelPart = selectedId.match(partRe);
    const mNodePart = nodeId.match(partRe);
    const idxSel = mSelRow?.[1] || mSelPart?.[1];
    const idxNode = mNodeRow?.[1] || mNodePart?.[1];
    if (idxSel !== undefined && idxNode !== undefined && idxSel === idxNode) {
        if (mSelRow || mNodeRow) return true;
        if (mSelPart && mNodePart) return true;
    }
    return false;
}

/** Logical Y inside LCD (0 = top) from screen coordinates; correct when the bezel is CSS-scaled. */
function lcdClientYToLocalY(clientY, lcdElement) {
    if (!lcdElement) return 0;
    const rect = lcdElement.getBoundingClientRect();
    const logicalH = lcdElement.clientHeight || Math.max(1, rect.height);
    const dispH = Math.max(1, rect.height);
    return ((clientY - rect.top) / dispH) * logicalH;
}

/** Match label-drag math: X/Y in LCD logical pixels (uses bezel zoom). */
function lcdClientToLocalXY(clientX, clientY, lcdElement) {
    if (!lcdElement) return { x: 0, y: 0 };
    const rect = lcdElement.getBoundingClientRect();
    const zoom = Number(window._tstatZoom || 1) || 1;
    return {
        x: (clientX - rect.left) / zoom,
        y: (clientY - rect.top) / zoom
    };
}

function snapLcdCoordQuarter(valuePx, screenData) {
    const cw = Number(screenData?.layout?.lcdCanvas?.width || screenData?.layout?.canvas?.width || 320);
    const cols = Number(screenData?.layout?.lcdTextColumns || 16);
    const step = Math.max(2, cw / Math.max(1, cols) / 4);
    return Math.round(Number(valuePx) / step) * step;
}

function isSvgLibraryIconLabel(widget) {
    if (!widget || widget.type !== 'label') return false;
    if (widget.id === 'main_icons_group' || widget.id === 'main_ticker_line') return false;
    if (widget.libraryIconName || widget.libraryIconId) return true;
    const t = typeof widget.text === 'string' ? widget.text.trim() : '';
    return /^<svg[\s>]/i.test(t);
}

/** Drag preset icons from the widget panel onto the live LCD (layout edit only). */
function bindLcdPaletteIconDropOnce(lcd) {
    if (!lcd || lcd._tstatPaletteIconDropBound) return;
    lcd._tstatPaletteIconDropBound = true;

    const clearHint = () => lcd.classList.remove('lcd--palette-drop-hint');

    const onDragOver = (evt) => {
        if (!window._isVisualEditMode || !window._layoutPaletteDrag) return;
        evt.preventDefault();
        evt.dataTransfer.dropEffect = 'copy';
        lcd.classList.add('lcd--palette-drop-hint');
    };

    const onDrop = (evt) => {
        if (!window._isVisualEditMode || !window._layoutPaletteDrag) return;
        evt.preventDefault();
        evt.stopPropagation();
        clearHint();
        const pal = window._layoutPaletteDrag;
        window._layoutPaletteDrag = null;
        const data = window._currentScreenData;
        const widgets = data?.widgets;
        if (!Array.isArray(widgets) || !pal?.svg) return;

        const path = window._currentJsonPath || './main_display.json';
        const { x: lx, y: ly } = lcdClientToLocalXY(evt.clientX, evt.clientY, lcd);
        const cw = Number(data?.layout?.lcdCanvas?.width || data?.layout?.canvas?.width || 320);
        const ch = Number(data?.layout?.lcdCanvas?.height || data?.layout?.canvas?.height || 480);
        const defaultW = Math.max(32, snapLcdCoordQuarter(40, data));
        let x = snapLcdCoordQuarter(lx - defaultW / 2, data);
        let y = snapLcdCoordQuarter(ly - defaultW / 2, data);
        x = Math.max(0, Math.min(Math.max(0, cw - defaultW), x));
        y = Math.max(0, Math.min(Math.max(0, ch - defaultW), y));

        const id = `palette_${Date.now()}`;
        widgets.push({
            type: 'label',
            id,
            text: pal.svg,
            libraryIconId: pal.id,
            libraryIconName: pal.name || pal.id || 'Icon',
            x,
            y,
            width: defaultW,
            align: 'left',
            color: '#ffffff'
        });
        normalizeWidgetTreeOrder(widgets);
        const newIdx = widgets.findIndex((w) => w && w.id === id);
        window._layoutSelectedNodeId = newIdx >= 0 ? `w-${newIdx}` : `w-${widgets.length - 1}`;
        renderScreen(path);
    };

    lcd.addEventListener('dragover', onDragOver, true);
    lcd.addEventListener('drop', onDrop, true);
    document.addEventListener('dragend', clearHint, true);
}

/**
 * Snap a row-slot widget to the grid row under local Y: swap lcdRow with another row at that slot, or move to an empty slot.
 * Always stores numeric lcdRow to avoid duplicate-slot bugs from string/number mismatch.
 */
function ensureFloatingPanelsDragBound() {
    if (window._floatingPanelsDragBound) return;
    window._floatingPanelsDragBound = true;
    const widgets = document.getElementById('layout-widgets-panel');
    const tree = document.getElementById('layout-tree-panel');
    const props = document.getElementById('layout-props-panel');
    const widgetsHead = widgets?.querySelector('.layout-widgets-panel__header');
    const treeHead = tree?.querySelector('.layout-tree-panel__tabs');
    const propsHead = props?.querySelector('.layout-props-panel__header');
    if (widgets && widgetsHead) attachFloatingPanelDrag(widgets, widgetsHead, { minTop: 46 });
    if (tree && treeHead) attachFloatingPanelDrag(tree, treeHead, { minTop: 46 });
    if (props && propsHead) attachFloatingPanelDrag(props, propsHead, { minTop: 46 });
}

function syncSlStudioWorkbenchChrome(jsonPath, data) {
    const fileEl = document.getElementById('sls-file-readout');
    const screenEl = document.getElementById('sls-screen-readout');
    const zoomEl = document.getElementById('sls-zoom-readout');
    if (fileEl && jsonPath) {
        const base = jsonPath.split('/').pop() || jsonPath;
        fileEl.textContent = base;
        fileEl.title = jsonPath;
    }
    if (screenEl && data) {
        const p = data.page || '';
        screenEl.textContent = p ? String(p).replace(/_/g, ' ') : 'Screen';
    }
    if (zoomEl && typeof window._tstatZoom === 'number') {
        zoomEl.textContent = `${Math.round(window._tstatZoom * 100)}%`;
    }
}

function applyRowSlotReorderAtLocalY(draggedWidget, localY, widgets, menuRowPixelHeight, canvasLogicalHeight) {
    if (!isRowSlotWidget(draggedWidget) || !Array.isArray(widgets)) return false;
    const h = Math.max(24, menuRowPixelHeight);
    const maxRow = Math.max(1, Math.floor(Math.max(h, Number(canvasLogicalHeight) || 480) / h));
    const targetRow = Math.max(1, Math.min(maxRow, Math.floor(localY / h) + 1));

    const blocker = widgets.find(
        (w) => normalizeLcdRowSlot(w.lcdRow) === targetRow && !isRowSlotWidget(w) && w.type !== 'button'
    );
    if (blocker) return false;

    const existingRow = widgets.find(
        (w) => w !== draggedWidget && isRowSlotWidget(w) && normalizeLcdRowSlot(w.lcdRow) === targetRow
    );

    const cur = normalizeLcdRowSlot(draggedWidget.lcdRow);
    if (existingRow) {
        const b = normalizeLcdRowSlot(existingRow.lcdRow);
        draggedWidget.lcdRow = b;
        existingRow.lcdRow = cur;
        return true;
    }
    if (cur !== targetRow) {
        draggedWidget.lcdRow = targetRow;
        return true;
    }
    return false;
}

function buildPageNodes(data) {
    const iconForWidget = (w) => {
        if (w.type === 'button') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.4"/></svg>';
        }
        if (w.type === 'menu_row') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
        }
        if (w.type === 'box') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>';
        }
        if (w.type === 'header') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3v10M13 3v10M3 8h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        }
        if (w.type === 'label' && typeof w.text === 'string' && w.text.includes('<svg')) {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2l4.5 3v6L8 14l-4.5-3V5L8 2z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>';
        }
        if (w.type === 'label') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M8 4v8M5 12h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
        }
        if (w.type === 'blank') {
            return '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="1.6" fill="currentColor"/></svg>';
        }
        return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="3" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
    };

    const widgets = data.widgets || [];
    const byId = new Map();
    widgets.forEach((w, i) => {
        if (w && w.id) byId.set(w.id, i);
    });
    const nodes = [];

    const nodeTitleFor = (w) => {
        if (w.type === 'label' && (w.libraryIconName || w.libraryIconId)) {
            return `Icon :: ${w.libraryIconName || w.libraryIconId}`;
        }
        if (w.type === 'label' && typeof w.text === 'string' && w.text.includes('<svg')) {
            return `Icon :: ${w.id || 'SVG Icon'}`;
        }
        if (w.type === 'menu_row') {
            return `Row :: ${getWidgetTreeName(w)}`;
        }
        return `${w.type || 'item'} :: ${getWidgetTreeName(w)}`;
    };

    const pushSyntheticForWidget = (w, i, indent) => {
        if (w.id === 'main_icons_group') {
            const parts = [
                { key: 'day_night', label: 'Icon :: Day/Night' },
                { key: 'occupied', label: 'Icon :: Occupied' },
                { key: 'heat_cool', label: 'Icon :: Heat/Cool' },
                { key: 'fan', label: 'Icon :: Fan' }
            ];
            parts.forEach((p, pIdx) => {
                const iconBinding = w.t3IconBindings?.[p.key] || '';
                nodes.push({
                    id: `w-${i}-icon-${p.key}`,
                    text: iconBinding ? `${p.label} [${iconBinding}]` : p.label,
                    icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
                    status: 'ok',
                    widget: w,
                    indent,
                    childKind: 'group_icon',
                    groupPartIndex: pIdx
                });
            });
        }
        if (w.type === 'menu_row') {
            nodes.push({
                id: `w-${i}-label`,
                text: `label text :: ${w.label || ''}`,
                icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M8 4v8M5 12h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
                status: 'ok',
                widget: w,
                indent,
                childKind: 'label'
            });
            nodes.push({
                id: `w-${i}-value`,
                text: `edit box :: ${(w.t3ValueBinding ? `[${w.t3ValueBinding}] ` : '')}${(w.value ?? '').toString()}`,
                icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5 8h6" stroke="currentColor" stroke-width="1.2"/></svg>',
                status: 'ok',
                widget: w,
                indent,
                childKind: 'value'
            });
        }
    };

    const MAX_TREE_DEPTH = 96;
    /** True only when this widget can be a parent in the tree (parentId links use string ids). */
    const canBeParent = (w) => {
        const id = w && w.id;
        return typeof id === 'string' && id.length > 0;
    };
    const emitSubtree = (w, i, depth, visited) => {
        if (!w) return;
        if (depth > MAX_TREE_DEPTH) {
            console.warn('[buildPageNodes] Max widget tree depth exceeded; check parentId chain at index', i);
            return;
        }
        if (visited.has(i)) {
            console.warn('[buildPageNodes] parentId cycle detected; skipping subtree at index', i);
            return;
        }
        visited.add(i);
        try {
            const nodeTitle = nodeTitleFor(w);
            nodes.push({
                id: `w-${i}`,
                text: nodeTitle,
                icon: iconForWidget(w),
                status: (w.id || w.label || w.text) ? 'ok' : 'warn',
                widget: w,
                widgetIndex: i,
                indent: depth,
                childKind: 'widget'
            });
            pushSyntheticForWidget(w, i, depth + 1);
            const parentId = canBeParent(w) ? w.id : null;
            const children = widgets
                .map((child, idx) => ({ child, idx }))
                .filter(({ child }) => child && parentId != null && child.parentId === parentId)
                .sort((a, b) => a.idx - b.idx);
            children.forEach(({ idx }) => emitSubtree(widgets[idx], idx, depth + 1, visited));
        } finally {
            visited.delete(i);
        }
    };

    const rootIndices = [];
    widgets.forEach((w, i) => {
        if (!w) return;
        if (!w.parentId || !byId.has(w.parentId)) rootIndices.push(i);
    });
    rootIndices.sort((a, b) => a - b);
    rootIndices.forEach((i) => emitSubtree(widgets[i], i, 0, new Set()));
    return nodes;
}

function openPropertyEditorMenu(e, node, onApply) {
    const widget = node.widget;
    const childKind = node.childKind || 'widget';
    removeExistingPropertyEditor();
    const menu = document.createElement('div');
    menu.id = 'layout-property-editor';
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10020';
    menu.style.background = '#fff';
    menu.style.border = '1px solid #cbd5e1';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 6px 24px rgba(0,0,0,0.18)';
    menu.style.padding = '8px';
    menu.style.minWidth = '260px';
    menu.style.fontFamily = "ui-monospace, 'Cascadia Code', Consolas, monospace";
    menu.style.fontSize = '12px';

    // SquareLine-like action menu for grouped main icons.
    if (widget?.id === 'main_icons_group') {
        const title = document.createElement('div');
        title.style.fontWeight = '700';
        title.style.margin = '2px 0 8px';
        title.textContent = 'Main Icons Group';
        menu.appendChild(title);

        const info = document.createElement('div');
        info.style.marginBottom = '10px';
        info.style.color = '#475569';
        info.textContent = 'Use actions for this group. Geometry is edited in the right inspector.';
        menu.appendChild(info);

        const actionRow = document.createElement('div');
        actionRow.style.display = 'flex';
        actionRow.style.gap = '8px';
        actionRow.style.justifyContent = 'flex-end';

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Close';
        closeBtn.onclick = () => menu.remove();
        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = 'Delete';
        deleteBtn.style.background = '#7f1d1d';
        deleteBtn.style.color = '#fff';
        deleteBtn.onclick = () => {
            if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(node.id);
            if (typeof window._deleteSelectedLayoutNode === 'function') window._deleteSelectedLayoutNode();
            menu.remove();
        };

        const ungroupBtn = document.createElement('button');
        ungroupBtn.textContent = 'Ungroup';
        ungroupBtn.style.background = '#0f766e';
        ungroupBtn.style.color = '#fff';
        ungroupBtn.onclick = () => {
            if (typeof ungroupMainIcons === 'function' && ungroupMainIcons()) onApply();
            menu.remove();
        };

        actionRow.appendChild(closeBtn);
        actionRow.appendChild(deleteBtn);
        actionRow.appendChild(ungroupBtn);
        menu.appendChild(actionRow);
        document.body.appendChild(menu);
        setTimeout(() => {
            const closeOnOutside = (evt) => {
                if (!menu.contains(evt.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', closeOnOutside);
                }
            };
            document.addEventListener('mousedown', closeOnOutside);
        }, 0);
        return;
    }

    const baseFields = [
        { key: 'x', label: 'x', type: 'number' },
        { key: 'y', label: 'y', type: 'number' },
        { key: 'fontSize', label: 'fontSize', type: 'number' },
        { key: 'color', label: 'color', type: 'text' }
    ];
    const labelFields = [
        { key: 'label', label: 'label', type: 'text' },
        { key: 'labelWidth', label: 'labelWidth', type: 'number' },
        { key: 'labelAlign', label: 'labelAlign', type: 'text' },
        { key: 'labelOffsetX', label: 'labelOffsetX', type: 'number' },
        { key: 'labelOffsetY', label: 'labelOffsetY', type: 'number' }
    ];
    const valueFields = [
        { key: 'value', label: 'value', type: 'text' },
        { key: 'valueWidth', label: 'valueWidth', type: 'number' },
        { key: 'valueAlign', label: 'valueAlign', type: 'text' },
        { key: 'valueOffsetX', label: 'valueOffsetX', type: 'number' },
        { key: 'valueOffsetY', label: 'valueOffsetY', type: 'number' }
    ];
    const highlightFields = [
        { key: 'highlightInsetX', label: 'highlightInsetX', type: 'number' },
        { key: 'highlightInsetY', label: 'highlightInsetY', type: 'number' },
        { key: 'highlightWidthAdjust', label: 'highlightWidthAdjust', type: 'number' },
        { key: 'highlightHeightAdjust', label: 'highlightHeightAdjust', type: 'number' },
        { key: 'highlightRadius', label: 'highlightRadius', type: 'number' }
    ];
    let fields = [...baseFields, ...labelFields, ...valueFields, ...highlightFields];
    if (childKind === 'label') fields = [...labelFields];
    if (childKind === 'value') fields = [...valueFields];

    fields.forEach((f) => {
        const row = document.createElement('div');
        row.style.display = 'grid';
        row.style.gridTemplateColumns = '88px 1fr';
        row.style.gap = '6px';
        row.style.marginBottom = '6px';
        const lab = document.createElement('label');
        lab.textContent = f.label;
        const input = document.createElement('input');
        input.type = f.type;
        input.dataset.key = f.key;
        input.value = widget[f.key] ?? '';
        input.style.width = '100%';
        row.appendChild(lab);
        row.appendChild(input);
        menu.appendChild(row);
    });

    const btnRow = document.createElement('div');
    btnRow.style.display = 'flex';
    btnRow.style.gap = '8px';
    btnRow.style.justifyContent = 'flex-end';
    const applyBtn = document.createElement('button');
    applyBtn.textContent = 'Apply';
    applyBtn.onclick = () => {
        menu.querySelectorAll('input[data-key]').forEach((inp) => {
            const k = inp.dataset.key;
            const val = inp.value;
            if (val === '') {
                delete widget[k];
                return;
            }
            widget[k] = inp.type === 'number' ? Number(val) : val;
        });
        onApply();
        menu.remove();
    };
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => menu.remove();
    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.background = '#7f1d1d';
    deleteBtn.style.color = '#fff';
    deleteBtn.onclick = () => {
        if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(node.id);
        if (typeof window._deleteSelectedLayoutNode === 'function') window._deleteSelectedLayoutNode();
        menu.remove();
    };
    const undoBtn = document.createElement('button');
    undoBtn.textContent = 'Undo';
    undoBtn.onclick = () => {
        if (typeof window._undoLayoutChange === 'function') window._undoLayoutChange();
        menu.remove();
    };
    btnRow.appendChild(closeBtn);
    btnRow.appendChild(undoBtn);
    btnRow.appendChild(deleteBtn);
    btnRow.appendChild(applyBtn);
    menu.appendChild(btnRow);
    document.body.appendChild(menu);

    setTimeout(() => {
        const closeOnOutside = (evt) => {
            if (!menu.contains(evt.target)) {
                menu.remove();
                document.removeEventListener('mousedown', closeOnOutside);
            }
        };
        document.addEventListener('mousedown', closeOnOutside);
    }, 0);
}

function renderLayoutTreePanel(data, jsonPath, rerender) {
    const panel = document.getElementById('layout-tree-panel');
    const widgetsPanel = document.getElementById('layout-widgets-panel');
    const content = document.getElementById('layout-tree-content');
    const searchInput = document.getElementById('layout-tree-search');
    if (!panel || !content) return;
    const isEdit = !!window._isVisualEditMode;
    if (widgetsPanel) widgetsPanel.classList.toggle('debug-ui-hidden', !isEdit);
    panel.classList.toggle('debug-ui-hidden', !isEdit);
    if (!isEdit) return;
    content.innerHTML = '';

    const screenNodes = [
        { key: 'main', name: 'Home' },
        { key: 'setup', name: 'Setup Menu' },
        { key: 'ethernet', name: 'WiFi Setup' },
        { key: 'provisioning', name: 'Provisioning' },
        { key: 'settings', name: 'RS485 Settings' },
        { key: 'clock', name: 'Clock Setup' },
        { key: 'oat', name: 'Outside Air Temp' },
        { key: 'tbd', name: 'To Be Done' }
    ];
    const pageToJsonPath = {
        main: './main_display.json',
        setup: './setup_menu.json',
        ethernet: './ethernet_setup.json',
        provisioning: './provisioning_setup.json',
        settings: './network_settings.json',
        clock: './clock_setup.json',
        oat: './oat_setup.json',
        tbd: './tbd_setup.json'
    };
    if (!window._layoutTreeExpandedPages) window._layoutTreeExpandedPages = { [jsonPath]: true };
    const pageNodes = buildPageNodes(data);
    const query = (searchInput?.value || '').trim().toLowerCase();
    const filteredNodes = !query ? pageNodes : pageNodes.filter((n) => n.text.toLowerCase().includes(query));

    screenNodes.forEach((s) => {
        const folder = document.createElement('div');
        folder.className = 'layout-tree-folder';
        const row = document.createElement('div');
        const targetPath = pageToJsonPath[s.key];
        const isCurrent = targetPath === jsonPath;
        const expanded = !!window._layoutTreeExpandedPages[targetPath];
        row.className = `layout-tree-node layout-tree-node--screen${isCurrent ? ' layout-tree-node--screen-active' : ''}`;
        const chev = document.createElement('span');
        chev.className = 'layout-tree-node__chevron';
        chev.setAttribute('aria-hidden', 'true');
        chev.textContent = expanded ? '▼' : '▶';
        const screenIcon = document.createElement('span');
        screenIcon.className = 'layout-tree-node__icon layout-tree-node__icon--screen';
        screenIcon.innerHTML =
            '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2 12h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
        const screenLabel = document.createElement('span');
        screenLabel.className = 'layout-tree-node__label';
        screenLabel.textContent = s.name;
        const screenStatus = document.createElement('span');
        screenStatus.className = `layout-tree-node__status${isCurrent ? ' is-screen-current' : ''}`;
        row.appendChild(chev);
        row.appendChild(screenIcon);
        row.appendChild(screenLabel);
        row.appendChild(screenStatus);
        row.addEventListener('click', () => {
            window._layoutTreeExpandedPages[targetPath] = !expanded;
            if (!isCurrent) window.navigateTo(s.key);
            else renderLayoutTreePanel(data, jsonPath, rerender);
        });
        folder.appendChild(row);

        const children = document.createElement('div');
        children.className = 'layout-tree-folder__children';
        children.style.display = expanded ? '' : 'none';
        if (isCurrent) {
            filteredNodes.forEach((n) => {
                const div = document.createElement('div');
                const typeMods = getLayoutTreeNodeLayoutClasses(n);
                div.className = `layout-tree-node${n.indent ? ' layout-tree-node--child' : ''}${typeMods ? ` ${typeMods}` : ''}`.trim();
                div.style.paddingLeft = `${8 + (n.indent || 0) * 16}px`;
                const chevronSp = document.createElement('span');
                chevronSp.className = 'layout-tree-node__chevron';
                chevronSp.setAttribute('aria-hidden', 'true');
                const icon = document.createElement('span');
                icon.className = 'layout-tree-node__icon';
                icon.innerHTML = n.icon;
                const label = document.createElement('span');
                label.className = 'layout-tree-node__label';
                label.textContent = n.text;
                if (n.childKind === 'widget') {
                    label.title = 'Double-click to rename in tree';
                    label.addEventListener('dblclick', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        const widgetRef = n.widget;
                        if (!widgetRef) return;
                        label.contentEditable = 'true';
                        label.focus();
                        document.getSelection()?.selectAllChildren(label);
                        const commitRename = () => {
                            label.contentEditable = 'false';
                            const raw = label.innerText.trim();
                            if (!raw) {
                                delete widgetRef.treeName;
                            } else {
                                widgetRef.treeName = raw
                                    .replace(/^row\s*::\s*/i, '')
                                    .replace(/^label\s*::\s*/i, '')
                                    .replace(/^icon\s*::\s*/i, '')
                                    .trim();
                            }
                            rerender(jsonPath);
                        };
                        const cancelRename = () => {
                            label.contentEditable = 'false';
                            label.textContent = n.text;
                        };
                        const onKey = (kevt) => {
                            if (kevt.key === 'Enter') {
                                kevt.preventDefault();
                                label.removeEventListener('keydown', onKey);
                                commitRename();
                            } else if (kevt.key === 'Escape') {
                                kevt.preventDefault();
                                label.removeEventListener('keydown', onKey);
                                cancelRename();
                            }
                        };
                        label.addEventListener('keydown', onKey);
                        label.addEventListener('blur', () => {
                            label.removeEventListener('keydown', onKey);
                            commitRename();
                        }, { once: true });
                    });
                }
                const status = document.createElement('span');
                status.className = `layout-tree-node__status ${n.status === 'warn' ? 'is-warning' : 'is-event'}`;
                div.appendChild(chevronSp);
                div.appendChild(icon);
                div.appendChild(label);
                div.appendChild(status);
                const parseWidgetIndexFromNodeId = (id) => {
                    const m = String(id || '').match(/^w-(\d+)$/);
                    return m ? Number(m[1]) : -1;
                };
                const isTopLevelWidgetNode = n.childKind === 'widget' && parseWidgetIndexFromNodeId(n.id) >= 0;
                if (isTopLevelWidgetNode) {
                    div.draggable = true;
                    div.addEventListener('dragstart', (evt) => {
                        window._layoutTreeDragNodeId = n.id;
                        evt.dataTransfer.effectAllowed = 'move';
                        setTimeout(() => { div.style.opacity = '0.45'; }, 0);
                    });
                    div.addEventListener('dragend', () => {
                        div.style.opacity = '';
                        window._layoutTreeDragNodeId = null;
                    });
                    div.addEventListener('dragover', (evt) => {
                        const widgetsOv = window._currentScreenData?.widgets;
                        const toIdx = parseWidgetIndexFromNodeId(n.id);
                        if (toIdx < 0) return;
                        const toW = widgetsOv?.[toIdx];
                        const rect = div.getBoundingClientRect();
                        const y = evt.clientY - rect.top;
                        const inside = y > rect.height * 0.28 && y < rect.height * 0.72;

                        if (window._layoutPaletteDrag) {
                            if (!widgetAcceptsChildren(toW) || !inside) return;
                            evt.preventDefault();
                            evt.dataTransfer.dropEffect = 'copy';
                            content.querySelectorAll('.layout-tree-node--drop-line-top, .layout-tree-node--drop-line-bottom, .layout-tree-node--drop-inside')
                                .forEach((el) => el.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside'));
                            div.classList.add('layout-tree-node--drop-inside');
                            return;
                        }

                        const draggedId = window._layoutTreeDragNodeId;
                        if (!draggedId || draggedId === n.id) return;
                        const fromIdx = parseWidgetIndexFromNodeId(draggedId);
                        if (fromIdx < 0 || toIdx < 0) return;
                        const fromW = widgetsOv?.[fromIdx];
                        if (inside && widgetAcceptsChildren(toW) && !isWidgetDescendantOf(widgetsOv, toIdx, fromIdx)) {
                            evt.preventDefault();
                            evt.dataTransfer.dropEffect = 'copy';
                            content.querySelectorAll('.layout-tree-node--drop-line-top, .layout-tree-node--drop-line-bottom, .layout-tree-node--drop-inside')
                                .forEach((el) => el.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside'));
                            div.classList.add('layout-tree-node--drop-inside');
                            return;
                        }
                        if (!layoutDropTargetsSameHierarchy(fromW, toW)) return;
                        evt.preventDefault();
                        evt.dataTransfer.dropEffect = 'move';
                        const side = y < rect.height / 2 ? 'top' : 'bottom';
                        content.querySelectorAll('.layout-tree-node--drop-line-top, .layout-tree-node--drop-line-bottom, .layout-tree-node--drop-inside')
                            .forEach((el) => el.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside'));
                        div.classList.add(side === 'top' ? 'layout-tree-node--drop-line-top' : 'layout-tree-node--drop-line-bottom');
                    });
                    div.addEventListener('dragleave', () => {
                        div.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside');
                    });
                    div.addEventListener('drop', (evt) => {
                        evt.preventDefault();
                        div.classList.remove('layout-tree-node--drop-line-top', 'layout-tree-node--drop-line-bottom', 'layout-tree-node--drop-inside');
                        const widgets = window._currentScreenData?.widgets;
                        if (!Array.isArray(widgets)) return;
                        const toIdx = parseWidgetIndexFromNodeId(n.id);
                        if (toIdx < 0) return;
                        const toWidget = widgets[toIdx];
                        const rect = div.getBoundingClientRect();
                        const y = evt.clientY - rect.top;
                        const inside = y > rect.height * 0.28 && y < rect.height * 0.72;

                        if (window._layoutPaletteDrag) {
                            if (!inside || !widgetAcceptsChildren(toWidget)) return;
                            const pal = window._layoutPaletteDrag;
                            const id = `palette_${Date.now()}`;
                            widgets.push({
                                type: 'label',
                                id,
                                text: pal.svg || '',
                                libraryIconId: pal.id,
                                libraryIconName: pal.name || pal.id || 'Icon',
                                x: 32,
                                y: 48,
                                width: Math.max(32, snapLcdCoordQuarter(40, window._currentScreenData)),
                                align: 'left',
                                parentId: toWidget.id,
                                color: '#ffffff'
                            });
                            window._layoutPaletteDrag = null;
                            normalizeWidgetTreeOrder(widgets);
                            const newIdx = widgets.findIndex((w) => w && w.id === id);
                            window._layoutSelectedNodeId = newIdx >= 0 ? `w-${newIdx}` : `w-${widgets.length - 1}`;
                            rerender(jsonPath);
                            return;
                        }

                        const draggedId = window._layoutTreeDragNodeId;
                        if (!draggedId || draggedId === n.id) return;
                        const fromIdx = parseWidgetIndexFromNodeId(draggedId);
                        if (fromIdx < 0 || toIdx < 0 || fromIdx >= widgets.length || toIdx >= widgets.length) return;
                        const fromWidget = widgets[fromIdx];
                        if (inside && widgetAcceptsChildren(toWidget) && !isWidgetDescendantOf(widgets, toIdx, fromIdx)) {
                            fromWidget.parentId = toWidget.id;
                            normalizeWidgetTreeOrder(widgets);
                            const ni = widgets.indexOf(fromWidget);
                            window._layoutSelectedNodeId = ni >= 0 ? `w-${ni}` : n.id;
                            rerender(jsonPath);
                            return;
                        }

                        if (!layoutDropTargetsSameHierarchy(fromWidget, toWidget)) return;
                        const fromIsRow = fromWidget?.type === 'menu_row' || fromWidget?.type === 'blank';
                        const toIsRow = toWidget?.type === 'menu_row' || toWidget?.type === 'blank';
                        const fromIsLabelLike = fromWidget?.type === 'label' || fromWidget?.type === 'header';
                        const toIsLabelLike = toWidget?.type === 'label' || toWidget?.type === 'header';
                        if (fromIsRow && toIsRow) {
                            const aRow = normalizeLcdRowSlot(fromWidget.lcdRow);
                            const bRow = normalizeLcdRowSlot(toWidget.lcdRow);
                            fromWidget.lcdRow = bRow;
                            toWidget.lcdRow = aRow;
                        } else if (fromIsLabelLike && toIsLabelLike) {
                            fromWidget.parentId = toWidget.parentId;
                            const ax = Number(fromWidget.x || 0);
                            const ay = Number(fromWidget.y || 0);
                            const bx = Number(toWidget.x || 0);
                            const by = Number(toWidget.y || 0);
                            fromWidget.x = bx;
                            fromWidget.y = by;
                            toWidget.x = ax;
                            toWidget.y = ay;
                        } else {
                            fromWidget.parentId = toWidget.parentId;
                            const tmp = widgets[fromIdx];
                            widgets[fromIdx] = widgets[toIdx];
                            widgets[toIdx] = tmp;
                            normalizeWidgetTreeOrder(widgets);
                        }
                        window._layoutSelectedNodeId = `w-${toIdx}`;
                        rerender(jsonPath);
                    });
                }
                div.addEventListener('click', () => {
                    if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(n.id);
                    else window._layoutSelectedNodeId = n.id;
                    content.querySelectorAll('.layout-tree-node--selected').forEach((el) => el.classList.remove('layout-tree-node--selected'));
                    div.classList.add('layout-tree-node--selected');
                    div.classList.add('layout-tree-node--pulse');
                    setTimeout(() => div.classList.remove('layout-tree-node--pulse'), 260);
                    div.scrollIntoView({ block: 'nearest' });
                    renderLayoutPropertiesPanel(data, jsonPath, rerender);
                });
                div.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode(n.id);
                    openTreeContextMenu(e, n, jsonPath, rerender);
                });
                if (window._layoutSelectedNodeId === n.id) {
                    div.classList.add('layout-tree-node--selected');
                }
                children.appendChild(div);
            });
        } else {
            const hint = document.createElement('div');
            hint.className = 'layout-tree-node layout-tree-node--child';
            hint.innerHTML = '<span class="layout-tree-node__chevron" aria-hidden="true"></span><span class="layout-tree-node__icon">…</span><span class="layout-tree-node__label">Open page to view objects</span><span class="layout-tree-node__status"></span>';
            children.appendChild(hint);
        }
        folder.appendChild(children);
        content.appendChild(folder);
    });
    const selectedTreeEl = content.querySelector('.layout-tree-node--selected');
    if (selectedTreeEl) selectedTreeEl.scrollIntoView({ block: 'nearest' });
    if (searchInput && !searchInput._layoutTreeSearchBound) {
        searchInput.addEventListener('input', () => renderLayoutTreePanel(data, jsonPath, rerender));
        searchInput._layoutTreeSearchBound = true;
    }
    const ensureIconPaletteUi = () => {
        const host = document.getElementById('layout-icon-palette-host');
        if (!host) return;
        let palette = document.getElementById('layout-icon-palette');
        if (!palette) {
            palette = document.createElement('div');
            palette.id = 'layout-icon-palette';
            palette.className = 'layout-icon-palette';
            palette.innerHTML = `
                <div class="layout-icon-palette__head">
                    <span>Presets</span>
                    <div class="layout-icon-palette__head-actions">
                        <button type="button" id="icon-palette-import">Import SVG</button>
                    </div>
                </div>
                <input id="icon-palette-file" type="file" accept=".svg,image/svg+xml" style="display:none" />
                <div id="layout-icon-palette-grid" class="layout-icon-palette__grid"></div>
            `;
            host.appendChild(palette);
        } else if (palette.parentNode !== host) {
            host.appendChild(palette);
        }
        const grid = document.getElementById('layout-icon-palette-grid');
        const importBtn = document.getElementById('icon-palette-import');
        const fileInput = document.getElementById('icon-palette-file');
        if (!grid || !importBtn || !fileInput) return;

        // SquareLine-style preset symbols: use currentColor so tiles (light/dark) and LCD (widget.color) both work.
        const presets = [
            { id: 'wifi', name: 'Wi‑Fi', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 12.55a11 11 0 0 1 14.08 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M1.42 9a16 16 0 0 1 21.16 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="20" r="1.2" fill="currentColor"/></svg>' },
            { id: 'gauge', name: 'Gauge', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 15a8 8 0 1 1 16 0" stroke="currentColor" stroke-width="1.6"/><path d="M12 12l5-3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></svg>' },
            { id: 'fan', name: 'Fan', svg: '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(13,13)"><ellipse cx="0" cy="-4" rx="2.2" ry="6" fill="currentColor"/><ellipse cx="0" cy="-4" rx="2.2" ry="6" fill="currentColor" transform="rotate(120)"/><ellipse cx="0" cy="-4" rx="2.2" ry="6" fill="currentColor" transform="rotate(240)"/></g><circle cx="13" cy="13" r="1.6" fill="currentColor"/></svg>' },
            { id: 'thermo', name: 'Thermo', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5a2 2 0 0 0-2 2v7.2a4 4 0 1 0 4 0V7a2 2 0 0 0-2-2z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="17" r="1.8" fill="currentColor"/></svg>' },
            { id: 'home', name: 'Home', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 11.5L12 4l9 7.5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5.5 10.5V20h13v-9.5" stroke="currentColor" stroke-width="1.6"/></svg>' },
            { id: 'settings', name: 'Settings', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82 1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>' },
            { id: 'power', name: 'Power', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M18.36 6.64a9 9 0 1 1-12.73 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
            { id: 'lock', name: 'Lock', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 11V8a5 5 0 0 1 10 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>' },
            { id: 'unlock', name: 'Unlock', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M7 11V8a5 5 0 0 1 9.9-1" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16" r="1.2" fill="currentColor"/></svg>' },
            { id: 'back', name: 'Back', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'forward', name: 'Next', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'menu', name: 'Menu', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 7h16M4 12h16M4 17h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'close', name: 'Close', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'check', name: 'OK', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 13l5 5L20 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'heat', name: 'Heat', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-2 4-4 5-4 9a4 4 0 0 0 8 0c0-4-2-5-4-9z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'cool', name: 'Cool', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>' },
            { id: 'humid', name: 'Humid', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 3c-4 6-7 8-7 12a7 7 0 0 0 14 0c0-4-3-6-7-12z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'sun', name: 'Sun', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.6"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M19.1 4.9l-1.5 1.5M6.9 17.6l-1.5 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'moon', name: 'Moon', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M21 14.5A8.5 8.5 0 0 1 9.5 3 6.5 6.5 0 1 0 21 14.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'cloud', name: 'Cloud', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 18h11a4 4 0 0 0 .2-8 5 5 0 0 0-9.7-1.5A3.5 3.5 0 0 0 7 18z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'phone', name: 'Phone', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="7" y="3" width="10" height="18" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M10 18h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'bt', name: 'Bluetooth', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 7l10 5-5 2.5V7zm0 10l10-5-5-2.5V17zM12 3v18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'signal', name: 'Signal', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 20V12M9 20V9M13 20V6M17 20v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'alert', name: 'Alert', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 4l9 14H3L12 4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 10v3M12 17h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'info', name: 'Info', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 11v5M12 8h.01" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'clock', name: 'Clock', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.5"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' },
            { id: 'calendar', name: 'Cal', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="5" width="16" height="15" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 3v4M16 3v4M4 10h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'play', name: 'Play', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 5v14l11-7L8 5z" fill="currentColor"/></svg>' },
            { id: 'pause', name: 'Pause', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>' },
            { id: 'auto', name: 'Auto', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8a8 8 0 0 1 8-4v4M20 16a8 8 0 0 1-8 4v-4M4 16l2-2M20 8l-2 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'bolt', name: 'Boost', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13 2L4 14h7l-1 8 10-12h-7l0-8z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>' },
            { id: 'chart', name: 'Graph', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 19h16M6 17l4-6 4 3 5-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'target', name: 'Setpt', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="7" stroke="currentColor" stroke-width="1.3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' },
            { id: 'up', name: 'Up', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 19V5M6 11l6-6 6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'down', name: 'Down', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 5v14M18 13l-6 6-6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
            { id: 'search', name: 'Search', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="11" cy="11" r="6" stroke="currentColor" stroke-width="1.6"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' },
            { id: 'user', name: 'User', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'eye', name: 'View', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="1.5"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/></svg>' },
            { id: 'brightness', name: 'Bright', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' },
            { id: 'battery', name: 'Battery', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="7" width="16" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M21 10v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M6 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>' },
            { id: 'link', name: 'Link', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 14a4 4 0 0 1 0-5l2-2a4 4 0 0 1 5.5.2 4 4 0 0 1 0 5.6L16 14M14 10a4 4 0 0 1 0 5l-2 2a4 4 0 0 1-5.5-.2 4 4 0 0 1 0-5.6L8 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' },
            { id: 'filter', name: 'Filter', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 5h16l-6 7v5l-4 2v-7L4 5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>' },
            { id: 'vent', name: 'Vent', svg: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 8h16M4 12h12M4 16h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M18 10l2 2-2 2M18 14l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' }
        ];
        const custom = loadCustomPaletteSvgs().map((item, idx) => ({ id: `custom-${idx}`, name: item.name, svg: item.svg, custom: true }));
        const all = [...presets, ...custom];
        if (!window._selectedPaletteIcon || !window._selectedPaletteIcon.svg) window._selectedPaletteIcon = { id: presets[0].id, name: presets[0].name, svg: presets[0].svg };

        grid.innerHTML = '';
        all.forEach((item) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'layout-icon-palette__item';
            if (window._selectedPaletteIcon?.svg === item.svg) btn.classList.add('is-selected');
            btn.innerHTML = `<span class="layout-icon-palette__preview">${item.svg}</span><span class="layout-icon-palette__label">${item.name || (item.custom ? 'Custom' : item.id)}</span>`;
            btn.draggable = true;
            btn.title = (btn.title || '') + ' Drag onto the LCD or into Hierarchy (center on a group to parent).';
            btn.addEventListener('dragstart', (e) => {
                window._layoutPaletteDrag = { svg: item.svg, name: item.name || item.id, id: item.id };
                try {
                    e.dataTransfer.setData('text/plain', 'palette-icon');
                    e.dataTransfer.effectAllowed = 'copy';
                } catch (_) {}
                setTimeout(() => { btn.style.opacity = '0.5'; }, 0);
            });
            btn.addEventListener('dragend', () => {
                btn.style.opacity = '';
                window._layoutPaletteDrag = null;
            });
            btn.addEventListener('click', () => {
                window._selectedPaletteIcon = { id: item.id, name: item.name || item.id, svg: item.svg };
                renderLayoutTreePanel(data, jsonPath, rerender);
            });
            if (item.custom) {
                btn.addEventListener('contextmenu', (evt) => {
                    evt.preventDefault();
                    const now = loadCustomPaletteSvgs();
                    const next = now.filter((s) => s.svg !== item.svg);
                    saveCustomPaletteSvgs(next);
                    if (window._selectedPaletteIcon?.svg === item.svg) {
                        window._selectedPaletteIcon = { id: presets[0].id, name: presets[0].name, svg: presets[0].svg };
                    }
                    renderLayoutTreePanel(data, jsonPath, rerender);
                });
            }
            grid.appendChild(btn);
        });

        if (!importBtn._boundPaletteImport) {
            importBtn.addEventListener('click', () => fileInput.click());
            fileInput.addEventListener('change', async () => {
                const f = fileInput.files?.[0];
                if (!f) return;
                const txt = await f.text();
                if (!txt.includes('<svg')) return;
                const now = loadCustomPaletteSvgs();
                const base = (f.name || 'Custom').replace(/\.svg$/i, '').trim() || 'Custom';
                now.unshift({ name: base, svg: txt });
                saveCustomPaletteSvgs(now);
                window._selectedPaletteIcon = { id: `custom-${Date.now()}`, name: base, svg: txt };
                fileInput.value = '';
                renderLayoutTreePanel(data, jsonPath, rerender);
            });
            importBtn._boundPaletteImport = true;
        }
    };
    ensureIconPaletteUi();
    const factories = {
        text: (row, idx) => ({
            type: 'label',
            id: `label_${idx}`,
            text: 'New Text',
            x: 160,
            y: row * 20,
            align: 'center',
            color: '#ffffff'
        }),
        icon: (row, idx) => ({
            type: 'label',
            id: `icon_${idx}`,
            text:
                window._selectedPaletteIcon?.svg ||
                '<svg width="20" height="20" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>',
            libraryIconId: window._selectedPaletteIcon?.id || 'icon',
            libraryIconName: window._selectedPaletteIcon?.name || 'Icon',
            x: 280,
            y: row * 20,
            align: 'right',
            width: 40,
            color: '#ffffff'
        }),
        box: (row, idx) => ({
            type: 'menu_row',
            id: `row_${idx}`,
            label: 'New Param',
            value: '0',
            lcdRow: row,
            labelWidth: 140,
            valueWidth: 140
        }),
        row: (row, idx) => ({
            type: 'menu_row',
            id: `item_${idx}`,
            label: `Item ${idx}`,
            value: '',
            lcdRow: row,
            labelWidth: 240,
            valueWidth: 30
        })
    };
    document.querySelectorAll('[data-widget-add]').forEach((btn) => {
        const kind = btn.getAttribute('data-widget-add');
        const factory = factories[kind];
        if (!factory || btn._boundAddWidget) return;
        btn.addEventListener('click', () => {
            const path = window._currentJsonPath || jsonPath;
            const widgets = window._currentScreenData?.widgets || [];
            const nextRow = Math.min(8, Math.max(2, ...widgets.map((w) => Number(w.lcdRow) || 2)) + 1);
            widgets.push(factory(nextRow, widgets.length));
            rerender(path);
        });
        btn._boundAddWidget = true;
    });
}

function renderLayoutPropertiesPanel(data, jsonPath, rerender) {
    const panel = document.getElementById('layout-props-panel');
    const content = document.getElementById('layout-props-content');
    const header = panel?.querySelector('.layout-props-panel__header');
    if (!panel || !content) return;
    /* Inspector drag: attachFloatingPanelDrag(layout-props header) in ensureFloatingPanelsDragBound */
    const isEdit = !!window._isVisualEditMode;
    panel.classList.toggle('debug-ui-hidden', !isEdit);
    if (!isEdit) return;

    const nodes = buildPageNodes(data);
    const selected = nodes.find((n) => n.id === window._layoutSelectedNodeId);
    if (!selected) {
        content.innerHTML = '<div>Select an item in the tree to edit properties.</div>';
        return;
    }
    const widget = selected.widget;
    const isValueChild = selected.childKind === 'value';
    const isIconChild = selected.childKind === 'group_icon';
    content.innerHTML = '';
    const title = document.createElement('div');
    title.style.marginBottom = '10px';
    title.style.fontWeight = '700';
    const titleText = (() => {
        if (widget.type === 'label' && (widget.libraryIconName || widget.libraryIconId)) {
            return `Icon :: ${widget.libraryIconName || widget.libraryIconId}`;
        }
        return `${selected.text}`;
    })();
    title.textContent = titleText;
    content.appendChild(title);

    const widgetsArr = data.widgets || [];
    let wIdx = typeof selected.widgetIndex === 'number' ? selected.widgetIndex : widgetsArr.indexOf(widget);
    if (wIdx < 0) {
        const m = String(selected.id || '').match(/^w-(\d+)(?:-|$)/);
        if (m) wIdx = Number(m[1]);
    }

    const appendSection = (heading) => {
        const sec = document.createElement('div');
        sec.className = 'layout-props-section';
        const h = document.createElement('div');
        h.className = 'layout-props-section__title';
        h.textContent = heading;
        sec.appendChild(h);
        content.appendChild(sec);
        return sec;
    };

    const appendField = (parentEl, key, type) => {
        const row = document.createElement('div');
        row.className = 'layout-props-row';
        const label = document.createElement('label');
        label.textContent = key;
        const input = document.createElement('input');
        input.type = type === 'number' ? 'number' : 'text';
        input.dataset.key = key;
        if (key === 'optionsCsv') input.value = Array.isArray(widget.options) ? widget.options.join(', ') : '';
        else input.value = widget[key] ?? '';
        row.appendChild(label);
        row.appendChild(input);
        parentEl.appendChild(row);
    };

    const identitySec = appendSection('Identity');
    appendField(identitySec, 'treeName', 'text');
    appendField(identitySec, 'id', 'text');
    appendField(identitySec, 'type', 'text');

    if (wIdx >= 0 && selected.childKind !== 'group_icon') {
        const hierSec = appendSection('Hierarchy');
        const row = document.createElement('div');
        row.className = 'layout-props-row';
        const lab = document.createElement('label');
        lab.textContent = 'parentId';
        const sel = document.createElement('select');
        sel.dataset.key = 'parentId';
        getParentIdSelectOptions(widgetsArr, wIdx).forEach((o) => {
            const opt = document.createElement('option');
            opt.value = o.value;
            opt.textContent = o.label;
            sel.appendChild(opt);
        });
        sel.value = widget.parentId || '';
        row.appendChild(lab);
        row.appendChild(sel);
        hierSec.appendChild(row);
    }

    const transformSec = appendSection('Transform');
    ['x', 'y', 'lcdRow', 'width', 'height', 'labelWidth', 'valueWidth'].forEach((k) => appendField(transformSec, k, 'number'));
    ['align', 'labelAlign', 'valueAlign'].forEach((k) => appendField(transformSec, k, 'text'));
    ['labelOffsetX', 'labelOffsetY', 'valueOffsetX', 'valueOffsetY'].forEach((k) => appendField(transformSec, k, 'number'));

    const contentSec = appendSection('Content');
    appendField(contentSec, 'label', 'text');
    appendField(contentSec, 'value', 'text');
    appendField(contentSec, 'text', 'text');

    const styleSec = appendSection('Style');
    ['fontSize', 'fontFamily', 'fontWeight'].forEach((k) => appendField(styleSec, k, k === 'fontSize' ? 'number' : 'text'));
    ['color', 'bg', 'borderColor', 'borderWidth', 'borderRadius'].forEach((k) => appendField(styleSec, k, k.includes('Width') || k.includes('Radius') ? 'number' : 'text'));
    ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].forEach((k) => appendField(styleSec, k, 'number'));

    const advSec = appendSection('Layout extras');
    ['highlightInsetX', 'highlightInsetY', 'highlightWidthAdjust', 'highlightHeightAdjust', 'highlightRadius'].forEach((k) => appendField(advSec, k, 'number'));
    appendField(advSec, 'optionsCsv', 'text');

    const makeSelectRow = (key, labelText, options, currentValue) => {
        const row = document.createElement('div');
        row.className = 'layout-props-row';
        const label = document.createElement('label');
        label.textContent = labelText;
        const sel = document.createElement('select');
        sel.dataset.key = key;
        options.forEach((opt) => {
            const o = document.createElement('option');
            o.value = opt.key;
            o.textContent = opt.label;
            sel.appendChild(o);
        });
        if (currentValue) sel.value = currentValue;
        row.appendChild(label);
        row.appendChild(sel);
        content.appendChild(row);
    };

    if (widget.type === 'menu_row' && isValueChild) {
        makeSelectRow('t3ValueBinding', 't3000Binding', getT3000PointOptions('VAR'), widget.t3ValueBinding || '');
    }
    if (widget.type === 'menu_row') {
        makeSelectRow(
            'labelDisplayMode',
            'labelDisplayMode',
            [
                { key: '', label: '(default)' },
                { key: '20char', label: '20char' },
                { key: '8char', label: '8char' },
                { key: 'none', label: 'none' },
                { key: 'custom', label: 'custom' }
            ],
            widget.labelDisplayMode || ''
        );
    }
    if (widget.type === 'label' && typeof widget.text === 'string' && widget.text.includes('id="temp_val"')) {
        makeSelectRow('t3ValueBinding', 't3000Binding', getT3000PointOptions('IN'), widget.t3ValueBinding || '');
    }
    if (widget.id === 'main_icons_group' && isIconChild) {
        const iconKey = selected.id.split('-icon-')[1] || 'day_night';
        const current = widget.t3IconBindings?.[iconKey] || '';
        makeSelectRow(`t3IconBinding:${iconKey}`, `${iconKey}Binding`, getT3000PointOptions('VAR'), current);
    }

    const actions = document.createElement('div');
    actions.className = 'layout-props-actions';
    const apply = document.createElement('button');
    apply.textContent = 'Apply';
    apply.onclick = () => {
        const widgetsApply = window._currentScreenData?.widgets;
        content.querySelectorAll('[data-key]').forEach((inp) => {
            const k = inp.dataset.key;
            const raw = inp.value;
            if (k === 'parentId') {
                if (!raw) delete widget.parentId;
                else widget.parentId = raw;
                if (Array.isArray(widgetsApply)) normalizeWidgetTreeOrder(widgetsApply);
                return;
            }
            if (k === 'optionsCsv') {
                if (!raw.trim()) delete widget.options;
                else widget.options = raw.split(',').map((s) => s.trim()).filter(Boolean);
                return;
            }
            if (k === 't3ValueBinding') {
                if (!raw) delete widget.t3ValueBinding;
                else widget.t3ValueBinding = raw;
                return;
            }
            if (k.startsWith('t3IconBinding:')) {
                const iconKey = k.split(':')[1];
                if (!widget.t3IconBindings) widget.t3IconBindings = {};
                if (!raw) delete widget.t3IconBindings[iconKey];
                else widget.t3IconBindings[iconKey] = raw;
                return;
            }
            if (raw === '') {
                delete widget[k];
                return;
            }
            widget[k] = inp.type === 'number' ? Number(raw) : raw;
        });
        rerender(jsonPath);
    };
    actions.appendChild(apply);
    const testBtn = document.createElement('button');
    testBtn.textContent = 'Run UI Self-Test';
    testBtn.onclick = () => {
        const steps = [];
        try {
            const lock = document.getElementById('thermostat-lock-toggle');
            if (lock) { lock.click(); steps.push('lock-toggle'); }
            const treeNode = document.querySelector('.layout-tree-node:not(.layout-tree-node--screen)');
            if (treeNode) { treeNode.dispatchEvent(new MouseEvent('click', { bubbles: true })); steps.push('tree-select'); }
            const nextBtn = document.getElementById('btn_next');
            if (nextBtn) { nextBtn.dispatchEvent(new MouseEvent('click', { bubbles: true })); steps.push('next-click'); }
            console.log(`[Self-Test] OK: ${steps.join(', ')}`);
        } catch (err) {
            console.error('[Self-Test] FAIL:', err?.message || err);
        }
    };
    actions.appendChild(testBtn);
    const scenarioBtn = document.createElement('button');
    scenarioBtn.textContent = 'Run Scenario Test';
    scenarioBtn.onclick = async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const log = [];
        try {
            console.log('[Scenario] starting...');
            // 1) Go Home
            window.navigateTo('main');
            await wait(120);
            if (window._currentScreenData?.page !== 'MAIN_DISPLAY') throw new Error('not on MAIN_DISPLAY');
            log.push('home');
            // 2) Go Setup
            window.navigateTo('setup');
            await wait(120);
            if (window._currentScreenData?.page !== 'SETUP_MENU') throw new Error('not on SETUP_MENU');
            log.push('setup');
            // 3) Go WiFi
            window.navigateTo('ethernet');
            await wait(120);
            if (window._currentScreenData?.page !== 'WIFI_SETTINGS') throw new Error('not on WIFI_SETTINGS');
            log.push('wifi');
            // 4) Enter edit mode
            if (!window._isVisualEditMode) {
                const lock = document.getElementById('thermostat-lock-toggle');
                if (lock) lock.click();
            }
            await wait(150);
            if (!window._isVisualEditMode) throw new Error('edit mode not enabled');
            log.push('unlock');
            // 5) Adjust width field
            const before = Number((window._currentScreenData.widgets || []).find((w) => w.id === 'ui_item_dhcp')?.valueWidth || 0);
            window._layoutSelectedNodeId = (() => {
                const nodes = buildPageNodes(window._currentScreenData);
                return nodes.find((n) => n.childKind === 'value' && n.widget?.id === 'ui_item_dhcp')?.id || null;
            })();
            renderScreen(window._currentJsonPath);
            await wait(120);
            const input = document.querySelector('#layout-props-content input[data-key="valueWidth"]');
            if (!input) throw new Error('valueWidth input not found');
            input.value = String(before + 4);
            const applyBtn = Array.from(document.querySelectorAll('#layout-props-content .layout-props-actions button')).find((b) => b.textContent === 'Apply');
            if (!applyBtn) throw new Error('Apply button not found');
            applyBtn.click();
            await wait(140);
            const after = Number((window._currentScreenData.widgets || []).find((w) => w.id === 'ui_item_dhcp')?.valueWidth || 0);
            if (after === before) throw new Error('valueWidth did not change');
            log.push('resize');
            // 6) Lock/save
            const lock = document.getElementById('thermostat-lock-toggle');
            if (lock && window._isVisualEditMode) lock.click();
            await wait(200);
            if (window._isVisualEditMode) throw new Error('lock/save did not complete');
            log.push('save');
            console.log(`[Scenario] PASS: ${log.join(' -> ')}`);
        } catch (err) {
            console.error('[Scenario] FAIL:', err?.message || err);
        }
    };
    actions.appendChild(scenarioBtn);
    content.appendChild(actions);
}

function applySelectionOutline() {
    document.querySelectorAll('.layout-selected-el').forEach((el) => el.classList.remove('layout-selected-el'));
    const selectedId = window._layoutSelectedNodeId;
    if (!selectedId) return;
    let target = document.querySelector(`[data-tree-node-id="${selectedId}"]`);
    if (!target && selectedId.includes('-icon-')) {
        const parentId = selectedId.split('-').slice(0, 2).join('-');
        const iconKey = selectedId.split('-icon-')[1];
        target = document.querySelector(`[data-tree-node-id="${parentId}"] [data-icon-key="${iconKey}"]`) ||
            document.querySelector(`[data-tree-node-id="${parentId}"]`);
    }
    if (!target && (selectedId.includes('-label') || selectedId.includes('-value'))) {
        const parentId = selectedId.split('-').slice(0, 2).join('-');
        target = document.querySelector(`[data-tree-node-id="${selectedId}"]`) ||
            document.querySelector(`[data-tree-node-id="${parentId}"]`);
    }
    if (target) {
        target.classList.add('layout-selected-el');
        target.classList.add('layout-selected-pulse');
        setTimeout(() => target.classList.remove('layout-selected-pulse'), 260);
    }
}

function setupMainTickerSimulation(data) {
    if (!data || data.page !== 'MAIN_DISPLAY') {
        if (window._tickerTimer) {
            clearInterval(window._tickerTimer);
            window._tickerTimer = null;
        }
        return;
    }
    const tickerHost = document.querySelector('#tstat-lcd-container [data-tree-node-id][id="main_ticker_line"], #main_ticker_line');
    if (!tickerHost) return;

    // Ensure we can safely render animated text inside the ticker box.
    const tickerInner = tickerHost.querySelector('div');
    if (!tickerInner) return;
    if (tickerInner.dataset.tickerInit !== '1') {
        const initial = (tickerInner.textContent || '168.0.151').trim();
        tickerInner.innerHTML = `<span class="tstat-ticker-text">${escapeHtml(initial)}</span>`;
        tickerInner.style.position = 'relative';
        tickerInner.style.overflow = 'hidden';
        tickerInner.dataset.tickerInit = '1';
    }
    const tickerText = tickerInner.querySelector('.tstat-ticker-text');
    if (!tickerText) return;

    const messages = [
        '168.0.151',
        'WIFI: LINK OK',
        'SYNC: CLOUD OK',
        'SENSOR: NORMAL',
        'ALARM: NONE'
    ];
    if (typeof window._tickerMsgIndex !== 'number') window._tickerMsgIndex = 0;
    if (typeof window._tickerOffsetX !== 'number') window._tickerOffsetX = tickerInner.clientWidth;

    const stopTicker = () => {
        if (window._tickerTimer) {
            clearInterval(window._tickerTimer);
            window._tickerTimer = null;
        }
        tickerInner.style.overflow = 'hidden';
        tickerText.style.position = 'relative';
        tickerText.style.display = 'inline-block';
        tickerText.style.whiteSpace = 'normal';
        tickerText.style.transform = '';
    };

    if (window._isVisualEditMode) {
        stopTicker();
        return;
    }

    if (window._tickerTimer) return;
    tickerInner.style.overflow = 'hidden';
    tickerText.style.position = 'absolute';
    tickerText.style.left = '0';
    tickerText.style.top = '50%';
    tickerText.style.transform = 'translateY(-50%)';
    tickerText.style.whiteSpace = 'nowrap';

    const restartLine = () => {
        const boxW = tickerInner.clientWidth || 240;
        window._tickerMsgIndex = (window._tickerMsgIndex + 1) % messages.length;
        tickerText.textContent = messages[window._tickerMsgIndex];
        window._tickerOffsetX = boxW;
    };

    // Start with current index without skipping.
    tickerText.textContent = messages[window._tickerMsgIndex % messages.length];
    window._tickerOffsetX = tickerInner.clientWidth || 240;

    // Requested: run ticker at 1/3 of prior speed.
    window._tickerTimer = setInterval(() => {
        const textW = Math.max(60, tickerText.scrollWidth);
        window._tickerOffsetX -= (1 / 3);
        tickerText.style.transform = `translate(${window._tickerOffsetX}px, -50%)`;
        if (window._tickerOffsetX < -textW - 12) {
            restartLine();
        }
    }, 18);
}

// Central navigation function
window.navigateTo = function(screenName) {
    const screenMap = {
        'main': './main_display.json',
        'setup': './setup_menu.json',
        'settings': './network_settings.json',
        'ethernet': './ethernet_setup.json',
        'provisioning': './provisioning_setup.json',
        'clock': './clock_setup.json',
        'oat': './oat_setup.json',
        'tbd': './tbd_setup.json'
    };
    const jsonPath = screenMap[screenName];
    if (jsonPath) {
        saveLastScreenPath(jsonPath);
        // Restore per-screen focus state when returning to this screen.
        const state = getScreenStateMap()[jsonPath] || {};
        window._currentScreenFocus = typeof state.focusIndex === 'number' ? state.focusIndex : 0;
        window._ipEditOctetIndex = typeof state.ipOctetIndex === 'number' ? state.ipOctetIndex : 0;
        window._ipEditMode = !!state.ipEditMode;
        window._wifiRowEditMode = !!state.wifiRowEditMode;
        window._valueEditMode = !!state.valueEditMode;
        if (jsonPath.includes('provisioning_setup')) {
            window._provisioningButtonFocus = typeof state.provisioningButtonFocus === 'number' ? state.provisioningButtonFocus : 0;
        }
        renderScreen(jsonPath);
    } else {
        console.error(`[Navigate] Unknown screen: ${screenName}`);
    }
}

function syncVisualEditShellClass() {
    document.body.classList.toggle('visual-edit-shell', !!window._isVisualEditMode);
}

/** Debug UI lives inside #layout-props-panel; visibility follows layout edit. */
function syncDebugEventPanelVisibility() {
    /* no-op: #debug-event-panel is nested in layout-props-panel */
}

const TSTAT_SKIP_SAVE_SERVER_KEY = 'tstat_skip_optional_save_server_v1';

/**
 * Optional: POST JSON to save-server.js on port 5001 so edits write to disk.
 * If nothing listens, the browser logs one failed network request; we then skip further tries for this tab session to avoid spam.
 * Data is always persisted via saveScreenToCache (localStorage) regardless.
 */
function postToOptionalLocalSaveServer(activeJsonPath, jsonString) {
    if (window._tstatAlwaysTrySaveServer === false) return;
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(TSTAT_SKIP_SAVE_SERVER_KEY) === '1') return;
    const targetFile = activeJsonPath.split('/').pop();
    fetch(`http://localhost:5001/save_settings?file=${targetFile}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonString
    })
        .then((resp) => {
            if (!resp.ok) throw new Error(`save HTTP ${resp.status}`);
        })
        .catch(() => {
            try {
                sessionStorage.setItem(TSTAT_SKIP_SAVE_SERVER_KEY, '1');
            } catch (_) {
                /* ignore */
            }
            console.debug(
                '[Visual Edit] Optional disk save (localhost:5001) unavailable — edits remain in browser localStorage. Run `node save-server.js` to write JSON files.',
                { file: targetFile }
            );
        });
}
window.__tstat_resetOptionalSaveServerProbe = () => {
    try {
        sessionStorage.removeItem(TSTAT_SKIP_SAVE_SERVER_KEY);
    } catch (_) {
        /* ignore */
    }
};

/** Show Hierarchy + Inspector as soon as layout edit toggles, even if renderScreen() returns early (e.g. JSON fetch error). */
function syncLayoutEditPanelsShellVisibility() {
    const widgets = document.getElementById('layout-widgets-panel');
    const tree = document.getElementById('layout-tree-panel');
    const props = document.getElementById('layout-props-panel');
    const isEdit = !!window._isVisualEditMode;
    if (widgets) widgets.classList.toggle('debug-ui-hidden', !isEdit);
    if (tree) tree.classList.toggle('debug-ui-hidden', !isEdit);
    if (props) props.classList.toggle('debug-ui-hidden', !isEdit);
}

/**
 * Tstat10-only: toggle runtime vs visual layout edit (not in SquareLine).
 * Shared by the bezel lock, debug panel button, and top bar control — do not rely on .click() delegation.
 */
function runVisualEditLockToggle() {
    const activeJsonPath = window._currentJsonPath || './main_display.json';
    window._isVisualEditMode = !window._isVisualEditMode;
    syncVisualEditShellClass();
    const gridToggle = document.getElementById('toggle-grid-layer');
    if (window._isVisualEditMode) {
        window._gridBeforeVisualEdit = !!window._tstatShowGridLayer;
        window._tstatShowGridLayer = true;
        document.body.classList.add('debug-active');
        if (gridToggle) {
            window._tstatSuppressGridToggleRender = true;
            try {
                gridToggle.checked = true;
            } finally {
                window._tstatSuppressGridToggleRender = false;
            }
        }
    } else {
        const restore = typeof window._gridBeforeVisualEdit === 'boolean' ? window._gridBeforeVisualEdit : false;
        window._tstatShowGridLayer = restore;
        if (restore) document.body.classList.add('debug-active');
        else document.body.classList.remove('debug-active');
        if (gridToggle) {
            window._tstatSuppressGridToggleRender = true;
            try {
                gridToggle.checked = restore;
            } finally {
                window._tstatSuppressGridToggleRender = false;
            }
        }
    }
    if (!window._isVisualEditMode) {
        const d = window._currentScreenData;
        if (d && typeof validateLayoutData === 'function') {
            const vr = validateLayoutData(d);
            if (!vr.valid && typeof writeStatus === 'function') {
                writeStatus(`Layout validation: ${vr.errors.join('; ') || 'errors'}`, true);
            }
        }
        const jsonString = JSON.stringify(window._currentScreenData, null, 2);
        saveScreenToCache(activeJsonPath, window._currentScreenData);
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage({ action: 'save_settings', data: window._currentScreenData });
        } else {
            postToOptionalLocalSaveServer(activeJsonPath, jsonString);
        }
    }
    syncDebugEventPanelVisibility();
    syncLayoutEditPanelsShellVisibility();
    renderScreen(activeJsonPath);
}
window.runVisualEditLockToggle = runVisualEditLockToggle;

/** Capture-phase handler so nothing can sit above the lock in the bubble chain; works with touch + mouse. */
function bindGlobalVisualEditLockControlsOnce() {
    if (window._visualEditLockControlsBound) return;
    window._visualEditLockControlsBound = true;
    const onActivate = (e) => {
        const raw = e.target;
        const el = raw && raw.nodeType === 1 ? raw : raw && raw.parentElement;
        const t =
            el &&
            el.closest &&
            el.closest('#thermostat-lock-toggle, #sls-edit-lock-toggle, #btn-lock-save, #phone-send-creds-btn');
        if (!t) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof runVisualEditLockToggle === 'function') runVisualEditLockToggle();
    };
    document.addEventListener('click', onActivate, true);
}
bindGlobalVisualEditLockControlsOnce();

/** Simulated RSSI label + wifi_N icon file (no extension) vs provisioning status. */
function getProvisioningRssiPresentation(statusValue) {
    const s = String(statusValue || 'Ready').trim();
    const table = {
        Ready: { icon: 'wifi_2', text: '-68 dBm', quality: 'Good' },
        Connecting: { icon: 'wifi_1', text: '-74 dBm', quality: 'Weak' },
        Requesting: { icon: 'wifi_3', text: '-59 dBm', quality: 'Good' },
        Success: { icon: 'wifi_4', text: '-52 dBm', quality: 'Strong' },
        Failed: { icon: 'wifi_none', text: 'No signal', quality: 'No signal' },
        'WiFi connected': { icon: 'wifi_4', text: '-46 dBm', quality: 'Excellent' }
    };
    return table[s] || table.Ready;
}

const PROV_RSSI_ICON_WIDGET = {
    type: 'label',
    id: 'prov_rssi_icon',
    text: '',
    x: 308,
    y: 8,
    align: 'right',
    width: 36,
    color: '#ffffff'
};
const PROV_RSSI_ROW_WIDGET = {
    type: 'menu_row',
    id: 'ui_item_prov_rssi',
    label: 'RSSI',
    value: '-68 dBm',
    lcdRow: 6,
    labelWidth: 52,
    valueWidth: 248,
    notes: 'Simulated dBm; wide value for dBm / No signal'
};
const PROV_RSSI_QUALITY_ROW_WIDGET = {
    type: 'menu_row',
    id: 'ui_item_prov_rssi_quality',
    label: 'Signal',
    value: 'Good',
    lcdRow: 7,
    labelWidth: 56,
    valueWidth: 244,
    notes: 'Qualitative RSSI (Weak … Excellent) vs provisioning status'
};

/**
 * Heal stale copies (other worktrees, cached localStorage) that predate RSSI widgets.
 * Canonical order: AP=3, Pass=4, Status=5, RSSI=6, Signal=7.
 */
function ensureProvisioningSetupHasRssi(data) {
    if (data?.page !== 'PROVISIONING_SETUP' || !Array.isArray(data.widgets)) return;
    const widgets = data.widgets;
    const headerIdx = widgets.findIndex((x) => x && x.type === 'header');

    if (!widgets.some((x) => x && x.id === 'prov_rssi_icon')) {
        const ins = headerIdx >= 0 ? headerIdx + 1 : 0;
        widgets.splice(ins, 0, { ...PROV_RSSI_ICON_WIDGET });
    }
    if (!widgets.some((x) => x && x.id === 'ui_item_prov_rssi')) {
        const iconI = widgets.findIndex((x) => x && x.id === 'prov_rssi_icon');
        const ins = iconI >= 0 ? iconI + 1 : (headerIdx >= 0 ? headerIdx + 1 : 0);
        widgets.splice(ins, 0, { ...PROV_RSSI_ROW_WIDGET });
    }
    if (!widgets.some((x) => x && x.id === 'ui_item_prov_rssi_quality')) {
        const rssiI = widgets.findIndex((x) => x && x.id === 'ui_item_prov_rssi');
        const ins = rssiI >= 0 ? rssiI + 1 : 0;
        widgets.splice(ins, 0, { ...PROV_RSSI_QUALITY_ROW_WIDGET });
    }

    const ap = widgets.find((x) => x && x.id === 'ui_item_prov_ap');
    const pass = widgets.find((x) => x && x.id === 'ui_item_prov_pass');
    const st = widgets.find((x) => x && x.id === 'ui_item_prov_status');
    const rssi = widgets.find((x) => x && x.id === 'ui_item_prov_rssi');
    const qual = widgets.find((x) => x && x.id === 'ui_item_prov_rssi_quality');
    const icon = widgets.find((x) => x && x.id === 'prov_rssi_icon');
    if (ap) ap.lcdRow = 3;
    if (pass) {
        pass.lcdRow = 4;
        if (String(pass.label || '') === 'Password') pass.label = 'Pass';
        if (Number(pass.labelWidth) > 80) {
            pass.labelWidth = 52;
            pass.valueWidth = 248;
        }
    }
    if (st) st.lcdRow = 5;
    if (rssi) {
        rssi.lcdRow = 6;
        /* Do not overwrite labelWidth/valueWidth here — that blocked layout-editor resizes and forced a too-narrow RSSI box. */
        if (Number(rssi.valueWidth) === 118 && Number(rssi.labelWidth) === 44) {
            rssi.labelWidth = 52;
            rssi.valueWidth = 248;
        }
    }
    if (qual) {
        qual.lcdRow = 7;
        /* Keep qualitative row positions only; preserve user widths from the inspector. */
    }
    if (icon) {
        icon.y = 8;
        icon.width = 36;
    }

    const c = widgets.find((x) => x && x.id === 'btn_connect_phone');
    const b = widgets.find((x) => x && x.id === 'btn_back');
    if (c) c.y = 352;
    if (b) b.y = 408;
}

function shouldProvSimulateFailure() {
    try {
        if (window._provSimulateFailure === true) return true;
        return new URLSearchParams(window.location.search).get('provFail') === '1';
    } catch {
        return false;
    }
}

function clearProvisioningFlowTimers() {
    window.clearTimeout(window._provConnectTimer);
    window.clearTimeout(window._provConnectTimer2);
    window.clearTimeout(window._provOutcomeTimer);
    window.clearTimeout(window._provWifiTimer);
}

/** After Requesting: apply password from phone app (simulated); then Success → WiFi connected. */
function runProvisioningSuccessExchange(jsonPath) {
    const path = jsonPath || window._currentJsonPath || './provisioning_setup.json';
    const data = window._currentScreenData;
    if (!data?.widgets) return;
    if (data.page !== 'PROVISIONING_SETUP' && !String(path).includes('provisioning_setup')) return;

    const pass = data.widgets.find((w) => w && w.id === 'ui_item_prov_pass');
    const st = data.widgets.find((w) => w && w.id === 'ui_item_prov_status');
    if (pass) pass.value = '********';
    if (st) st.value = 'Success';

    saveScreenToCache(path, data);
    renderScreen(path);

    window.clearTimeout(window._provWifiTimer);
    window._provWifiTimer = window.setTimeout(() => {
        const d = window._currentScreenData;
        if (!d || d.page !== 'PROVISIONING_SETUP') return;
        const st2 = d.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
        if (st2 && String(st2.value) === 'Success') {
            st2.value = 'WiFi connected';
            saveScreenToCache(window._currentJsonPath || path, d);
            renderScreen(window._currentJsonPath || path);
        }
    }, 1200);
}

function startProvisioningConnectFlow(jsonPath) {
    const path = jsonPath || window._currentJsonPath || './provisioning_setup.json';
    const data = window._currentScreenData;
    if (!data || data.page !== 'PROVISIONING_SETUP') return;
    const st0 = data.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
    const busy = st0 && ['Connecting', 'Requesting'].includes(String(st0.value));
    if (busy) return;

    clearProvisioningFlowTimers();
    const st = data.widgets.find((w) => w && w.id === 'ui_item_prov_status');
    if (st) st.value = 'Connecting';
    saveScreenToCache(path, data);
    renderScreen(path);

    window._provConnectTimer = window.setTimeout(() => {
        const d = window._currentScreenData;
        if (!d || d.page !== 'PROVISIONING_SETUP') return;
        const s2 = d.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
        if (s2 && String(s2.value) === 'Connecting') {
            s2.value = 'Requesting';
            saveScreenToCache(window._currentJsonPath || path, d);
            renderScreen(window._currentJsonPath || path);
        }
    }, 900);

    window._provConnectTimer2 = window.setTimeout(() => {
        const d = window._currentScreenData;
        if (!d || d.page !== 'PROVISIONING_SETUP') return;
        const s3 = d.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
        if (!s3 || String(s3.value) !== 'Requesting') return;
        if (shouldProvSimulateFailure()) {
            s3.value = 'Failed';
            saveScreenToCache(window._currentJsonPath || path, d);
            renderScreen(window._currentJsonPath || path);
            return;
        }
        runProvisioningSuccessExchange(window._currentJsonPath || path);
    }, 900 + 1000);
}

/** Arrow keys: focus Connect ↔ Back; Enter activates; Left exits to setup. */
function handleProvisioningArrowKey(e) {
    if (window._isVisualEditMode) return false;
    const path = window._currentJsonPath;
    if (!path) return false;
    let bf = typeof window._provisioningButtonFocus === 'number' ? window._provisioningButtonFocus : 0;
    bf = bf ? 1 : 0;

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.key === 'ArrowRight') {
            bf = (bf + 1) % 2;
        } else if (e.key === 'ArrowDown') {
            bf = Math.min(1, bf + 1);
        } else {
            bf = Math.max(0, bf - 1);
        }
        window._provisioningButtonFocus = bf;
        const sm = getScreenStateMap();
        sm[path] = { ...sm[path], provisioningButtonFocus: bf };
        renderScreen(path);
        return true;
    }
    if (e.key === 'ArrowLeft') {
        e.preventDefault();
        window._ipEditMode = false;
        window._valueEditMode = false;
        window.navigateTo('setup');
        return true;
    }
    if (e.key === 'Enter') {
        e.preventDefault();
        bf = typeof window._provisioningButtonFocus === 'number' ? window._provisioningButtonFocus : 0;
        if (bf === 0) {
            startProvisioningConnectFlow(path);
        } else {
            window.navigateTo('setup');
        }
        return true;
    }
    return false;
}

/** Provisioning is automatic; hide dev phone shortcut on this screen. */
function syncPhoneSendCredsButtonVisibility() {
    const btn = document.getElementById('phone-send-creds-btn');
    if (!btn) return;
    const path = String(window._currentJsonPath || '');
    const page = window._currentScreenData?.page;
    const onProv = page === 'PROVISIONING_SETUP' || path.includes('provisioning_setup');
    btn.classList.toggle('phone-send-creds-btn--hidden', onProv);
    if (onProv) {
        btn.classList.remove('phone-send-creds-btn--disabled');
        btn.removeAttribute('disabled');
    }
}

function ensurePhoneSendCredsButtonBound() {
    if (window._phoneSendCredsBound) return;
    window._phoneSendCredsBound = true;
    const btn = document.getElementById('phone-send-creds-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Hidden on provisioning (automatic flow); no-op if somehow clicked.
        runProvisioningSuccessExchange(window._currentJsonPath);
    });
}

export async function renderScreen(jsonPath) {
    if (window._tstatRenderScreenInFlight) {
        window._tstatRenderScreenQueuedPath = jsonPath;
        return;
    }
    window._tstatRenderScreenInFlight = true;
    try {
    // Track active screen path immediately so lock/save actions always apply to current page.
    window._currentJsonPath = jsonPath;
    saveLastScreenPath(jsonPath);
    // Prepare LCD container
    const lcdGrid = document.getElementById('tstat-lcd-container');
    if (!lcdGrid) {
        const ph = document.getElementById('phone-send-creds-btn');
        if (ph) ph.classList.add('phone-send-creds-btn--hidden');
        return;
    }
    ensureFloatingPanelsDragBound();
    syncVisualEditShellClass();
    syncDebugEventPanelVisibility();
    syncLayoutEditPanelsShellVisibility();

    // Inject VS Code styling for debug tools and context menus to make them larger and monospaced
    if (!document.getElementById('vscode-debug-styles')) {
        const style = document.createElement('style');
        style.id = 'vscode-debug-styles';
        style.innerHTML = `
            /* Keep monospace only for editor/debug surfaces, not the LCD UI itself */
            /* SquareLine-style UI uses system sans for hierarchy/inspector; monospace reserved for validation output */
            #layout-widgets-panel,
            #layout-tree-panel,
            #layout-props-panel {
                font-family: 'Segoe UI', 'Inter', system-ui, sans-serif !important;
                font-size: 12px;
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
            [id*="debug-"], [id*="toggle"] {
                font-size: 14px !important;
            }
            #btn-lock-save.layout-widgets-panel__play-btn {
                font-size: 11px !important;
                padding: 4px 10px !important;
                font-weight: 600 !important;
                border-radius: 4px !important;
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
                const gridLineColor = window._isVisualEditMode ? 'rgba(203,213,225,0.95)' : 'rgba(255,255,255,0.9)';
                for (let c = 1; c < cols; c++) {
                    const vline = document.createElement('div');
                    vline.style.position = 'absolute';
                    vline.style.left = (c * cellW) + 'px';
                    vline.style.top = '0';
                    vline.style.width = '1px';
                    vline.style.height = height + 'px';
                    vline.style.background = gridLineColor;
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
                    hline.style.background = gridLineColor;
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
    bindLcdPaletteIconDropOnce(lcd);
    ensureLcdCanvasPickMenuAttached(lcd);

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
    // Sync grid toggle button state after refresh (suppress change → renderScreen feedback loops)
    const gridToggle = document.getElementById('toggle-grid-layer');
    if (gridToggle) {
        window._tstatSuppressGridToggleRender = true;
        try {
            gridToggle.checked = !!window._tstatShowGridLayer;
        } finally {
            window._tstatSuppressGridToggleRender = false;
        }
    }

    const lockBtn = document.getElementById('btn-lock-save');
    if (lockBtn) {
        if (window._isVisualEditMode) {
            lockBtn.textContent = 'Play';
            lockBtn.title = 'Play mode — save and preview (exit layout edit)';
            lockBtn.setAttribute('aria-label', 'Play mode, save and exit layout edit');
            lockBtn.classList.add('is-active');
        } else {
            lockBtn.textContent = 'Edit';
            lockBtn.title = 'Edit layout';
            lockBtn.setAttribute('aria-label', 'Edit layout');
            lockBtn.classList.remove('is-active');
        }
    }
    const thermostatLockBtn = document.getElementById('thermostat-lock-toggle');
    const slsEditLockBtn = document.getElementById('sls-edit-lock-toggle');
    if (slsEditLockBtn) {
        slsEditLockBtn.textContent = window._isVisualEditMode ? '🔓' : '🔒';
        slsEditLockBtn.classList.toggle('is-active', !!window._isVisualEditMode);
        slsEditLockBtn.title = window._isVisualEditMode
            ? 'Unlock: exit layout edit (lock & save)'
            : 'Lock: enter layout edit (Tstat10)';
        slsEditLockBtn.setAttribute('aria-label', window._isVisualEditMode ? 'Lock and exit layout edit' : 'Unlock layout edit');
    }
    if (thermostatLockBtn) {
        // Semantics: locked = runtime mode (grid usually off), unlocked = edit mode (grid on).
        thermostatLockBtn.textContent = window._isVisualEditMode ? '🔓' : '🔒';
        thermostatLockBtn.classList.toggle('is-active', !!window._isVisualEditMode);
        thermostatLockBtn.title = window._isVisualEditMode
            ? 'Editing unlocked (tap to lock)'
            : 'Locked runtime mode (tap to unlock for edit)';
    }

    // Only fetch JSON and set window._networkSettingsData if not already set (preserve user changes)
    let data;
    // Check if we already have the data loaded for this specific screen
    if (!window._currentScreenData || window._lastLoadedJsonPath !== jsonPath) {
        const preferCacheFirst = !!window._isVisualEditMode;
        const applyFetched = (parsed) => {
            data = parsed;
            window._currentScreenData = data;
            window._lastLoadedJsonPath = jsonPath;
        };
        const loadFromCache = () => {
            const cached = loadScreenFromCache(jsonPath);
            if (cached) {
                applyFetched(cached);
                return true;
            }
            return false;
        };
        const loadFromNetwork = async () => {
            const resp = await fetch(jsonPath + '?_=' + Date.now());
            applyFetched(await resp.json());
        };

        if (preferCacheFirst) {
            // Layout edit: keep unsaved work from localStorage when present.
            if (!loadFromCache()) {
                try {
                    await loadFromNetwork();
                } catch (e) {
                    lcd.innerHTML = `<div style="color:red; padding: 20px;">Failed to load ${jsonPath}</div>`;
                    console.error(e);
                    return;
                }
            }
        } else {
            // Runtime: always prefer fresh JSON from disk so cached drafts cannot diverge from repo files.
            try {
                await loadFromNetwork();
            } catch (e) {
                if (loadFromCache()) {
                    console.warn(`[Simulator] Fetch failed, loaded ${jsonPath} from local cache.`);
                } else {
                    lcd.innerHTML = `<div style="color:red; padding: 20px;">Failed to load ${jsonPath}</div>`;
                    console.error(e);
                    return;
                }
            }
        }
    }
    data = window._currentScreenData;
    ensureCanonicalSchema(data);
    ensureProvisioningSetupHasRssi(data);
    if (data.page === 'MAIN_DISPLAY') {
        data.canvasProfile = data.canvasProfile || {};
        data.layout = data.layout || {};
        data.layout.lcdCanvas = data.layout.lcdCanvas || {};
        data.layout.canvas = data.layout.canvas || {};
        data.canvasProfile.width = 320;
        data.canvasProfile.height = 480;
        data.layout.lcdCanvas.width = 320;
        data.layout.lcdCanvas.height = 480;
        data.layout.canvas.width = 320;
        data.layout.canvas.height = 480;
    }
    ensureMainDisplayIconLayout(data);
    // Guard against stale cached canvas heights (older edit sessions used compressed LCD heights).
    const cw = Number(data?.canvasProfile?.width || data?.layout?.lcdCanvas?.width || data?.layout?.canvas?.width || 320);
    const ch = Number(data?.canvasProfile?.height || data?.layout?.lcdCanvas?.height || data?.layout?.canvas?.height || 480);
    if (cw < 300 || ch < 450) {
        data.canvasProfile = data.canvasProfile || {};
        data.layout = data.layout || {};
        data.layout.lcdCanvas = data.layout.lcdCanvas || {};
        data.layout.canvas = data.layout.canvas || {};
        data.canvasProfile.width = 320;
        data.canvasProfile.height = 480;
        data.layout.lcdCanvas.width = 320;
        data.layout.lcdCanvas.height = 480;
        data.layout.canvas.width = 320;
        data.layout.canvas.height = 480;
    }
    // Persist working copy continuously so refresh does not drop recent edits.
    saveScreenToCache(jsonPath, data);
    ensureIpv4AlignedStyles();
    syncSlStudioWorkbenchChrome(jsonPath, data);
    renderLayoutTreePanel(data, jsonPath, renderScreen);
    renderLayoutPropertiesPanel(data, jsonPath, renderScreen);
    const gridCols = data.layout?.lcdTextColumns || 16;
    const gridRows = data.layout?.lcdTextRows || 10;
    const canvasWidthPx = data.layout?.lcdCanvas?.width || 320;
    const canvasHeightPx = data.layout?.lcdCanvas?.height || 480;
    const gridCellW = canvasWidthPx / gridCols;
    const gridCellH = canvasHeightPx / gridRows;
    const quarterCharStep = gridCellW / 4;

    function snapToGrid(valuePx, stepPx) {
        return Math.round(valuePx / stepPx) * stepPx;
    }
    /** Keep keypad/Next focus in sync with the row you select in the tree or on the LCD (fixes highlight/row vanishing when editing). */
    function syncMenuFocusFromLayoutNodeId(nodeId, screenData) {
        if (!nodeId || !screenData || !Array.isArray(screenData.widgets)) return;
        const m = String(nodeId).match(/^w-(\d+)/);
        if (!m) return;
        const widgetIdx = Number(m[1]);
        if (Number.isNaN(widgetIdx) || widgetIdx < 0 || widgetIdx >= screenData.widgets.length) return;
        const w = screenData.widgets[widgetIdx];
        if (!w || w.type !== 'menu_row') return;
        const menuRows = screenData.widgets
            .filter((x) => x && x.type === 'menu_row')
            .sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
        const fi = menuRows.findIndex((r) => r === w || (r.id && w.id && r.id === w.id));
        if (fi >= 0) window._currentScreenFocus = fi;
    }
    function selectLayoutNode(nodeId) {
        window._layoutSelectedNodeId = nodeId;
        syncMenuFocusFromLayoutNodeId(nodeId, window._currentScreenData || data);
        renderScreen(jsonPath);
    }
    window._selectLayoutNode = selectLayoutNode;
    const pushUndoSnapshot = () => {
        if (!window._layoutUndoStack) window._layoutUndoStack = [];
        window._layoutUndoStack.push({
            jsonPath,
            data: JSON.parse(JSON.stringify(window._currentScreenData || data || {})),
            selectedId: window._layoutSelectedNodeId || null
        });
        if (window._layoutUndoStack.length > 60) window._layoutUndoStack.shift();
    };
    const undoLayoutChange = () => {
        const stack = window._layoutUndoStack || [];
        if (!stack.length) return false;
        const snap = stack.pop();
        if (!snap || !snap.data) return false;
        window._currentScreenData = snap.data;
        window._lastLoadedJsonPath = snap.jsonPath || jsonPath;
        window._layoutSelectedNodeId = snap.selectedId || null;
        renderScreen(window._lastLoadedJsonPath);
        return true;
    };
    const deleteSelectedLayoutNode = () => {
        const selectedId = String(window._layoutSelectedNodeId || '');
        if (!selectedId.startsWith('w-')) return false;
        const m = selectedId.match(/^w-(\d+)/);
        if (!m) return false;
        const idx = Number(m[1]);
        const widgets = Array.isArray(window._currentScreenData?.widgets) ? window._currentScreenData.widgets : null;
        if (!widgets || Number.isNaN(idx) || idx < 0 || idx >= widgets.length) return false;
        pushUndoSnapshot();
        widgets.splice(idx, 1);
        window._layoutSelectedNodeId = null;
        renderScreen(jsonPath);
        return true;
    };
    const duplicateSelectedLayoutNode = () => {
        const selectedId = String(window._layoutSelectedNodeId || '');
        if (!selectedId.startsWith('w-')) return false;
        const m = selectedId.match(/^w-(\d+)/);
        if (!m) return false;
        const idx = Number(m[1]);
        const widgets = Array.isArray(window._currentScreenData?.widgets) ? window._currentScreenData.widgets : null;
        if (!widgets || Number.isNaN(idx) || idx < 0 || idx >= widgets.length) return false;
        const src = widgets[idx];
        pushUndoSnapshot();
        const copy = JSON.parse(JSON.stringify(src));
        if (copy && typeof copy.id === 'string' && copy.id.length) {
            let candidate = `${copy.id}_copy`;
            let seq = 2;
            const existing = new Set(widgets.map((w) => String(w?.id || '')));
            while (existing.has(candidate)) {
                candidate = `${copy.id}_copy${seq}`;
                seq += 1;
            }
            copy.id = candidate;
        }
        widgets.splice(idx + 1, 0, copy);
        window._layoutSelectedNodeId = `w-${idx + 1}`;
        renderScreen(jsonPath);
        return true;
    };
    window._undoLayoutChange = undoLayoutChange;
    window._deleteSelectedLayoutNode = deleteSelectedLayoutNode;
    window._duplicateSelectedLayoutNode = duplicateSelectedLayoutNode;

    function installLcdSelectionSync() {
        if (!lcd || lcd._selectionSyncBound) return;
        lcd._selectionSyncBound = true;
        lcd.addEventListener('mousedown', (evt) => {
            if (!window._isVisualEditMode) return;
            const target = evt.target;
            if (!target || !target.closest) return;
            const nodeEl = target.closest('[data-tree-node-id]');
            const nodeId = nodeEl?.dataset?.treeNodeId;
            if (!nodeId) return;
            if (window._layoutSelectedNodeId !== nodeId) {
                selectLayoutNode(nodeId);
            }
        }, true);
    }
    installLcdSelectionSync();
    const ensureEditHint = () => {
        const hint = document.getElementById('layout-edit-hint');
        if (!window._isVisualEditMode) {
            if (hint) hint.remove();
            return;
        }
        if (hint) hint.remove();
    };
    ensureEditHint();

    function enableInlineTextEdit(el, initialGetter, commitFn) {
        if (!el || el._inlineEditBound) return;
        el._inlineEditBound = true;
        el.contentEditable = 'false';
        const startEditing = () => {
            if (el._inlineEditing) return;
            el._inlineEditing = true;
            el.contentEditable = 'true';
            el.style.cursor = 'text';
            if (typeof initialGetter === 'function') {
                const txt = initialGetter();
                if (typeof txt === 'string' && txt.length) el.innerText = txt;
            }
            el.focus();
            document.getSelection()?.selectAllChildren(el);
        };
        const stopEditing = (commit) => {
            if (!el._inlineEditing) return;
            el._inlineEditing = false;
            el.contentEditable = 'false';
            el.style.cursor = 'grab';
            if (commit && typeof commitFn === 'function') commitFn(el.innerText);
        };
        el._startInlineEdit = startEditing;
        el.addEventListener('dblclick', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            startEditing();
        });
        el.addEventListener('keydown', (evt) => {
            if (!el._inlineEditing) return;
            if (evt.key === 'Enter') {
                evt.preventDefault();
                stopEditing(true);
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                stopEditing(false);
            }
        });
        el.addEventListener('blur', () => stopEditing(true));
    }

    function attachWidthDragResize(el, widgetRef, widthKey, defaultWidth, options = {}) {
        const EDGE_HIT_PX = 12;
        let resizing = false;
        let startX = 0;
        let startWidth = 0;
        let startSide = 'right';
        let startOffset = 0;
        let startAnchorX = 0;
        let startAlign = 'left';
        if (!el || !widgetRef) return;
        const computedPos = window.getComputedStyle(el).position;
        if (!computedPos || computedPos === 'static') el.style.position = 'relative';
        // Ensure the resize handle remains clickable at the edge.
        el.style.overflow = 'visible';

        const xKey = options.xKey || null;
        const alignKey = options.alignKey || null;
        const defaultAlign = options.defaultAlign || 'left';
        const offsetKey = options.offsetKey || null;
        const edgeBehavior = options.edgeBehavior || 'default';
        const nodeId = options.nodeId || null;
        const selectedOnly = options.selectedOnly !== false;

        const resolveAlign = () => (alignKey ? (widgetRef[alignKey] || defaultAlign) : defaultAlign);
        const widthForCalc = () => Number(widgetRef[widthKey] || defaultWidth || Math.max(40, el.offsetWidth || 80));
        const anchorXForCalc = () => Number(widgetRef[xKey] || 0);
        const offsetForCalc = () => Number(widgetRef[offsetKey] || 0);

        const previewApply = (side, dx) => {
            const baseWidth = startWidth;
            let newWidth = baseWidth;
            if (side === 'left') newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth - dx, quarterCharStep));
            else newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth + dx, quarterCharStep));
            el.style.width = `${newWidth}px`;
            if (xKey) {
                const oldW = Math.max(quarterCharStep, baseWidth);
                const align = startAlign;
                const centerX = startAnchorX;
                const leftBefore = align === 'center' ? (centerX - oldW / 2) : (align === 'right' ? (centerX - oldW) : centerX);
                const rightBefore = leftBefore + oldW;
                const leftAfter = side === 'left' ? (rightBefore - newWidth) : leftBefore;
                const xPreview = align === 'center' ? (leftAfter + (newWidth / 2)) : (align === 'right' ? (leftAfter + newWidth) : leftAfter);
                el.style.left = `${xPreview}px`;
            }
            if (offsetKey && (side === 'left' || edgeBehavior === 'flexAutoRight')) {
                const deltaForOffset = edgeBehavior === 'flexAutoRight'
                    ? (side === 'right' ? (newWidth - baseWidth) : 0)
                    : dx;
                const newOffset = snapToGrid(startOffset + deltaForOffset, quarterCharStep);
                el.style.transform = `translate(${newOffset}px, ${Number(widgetRef[offsetKey.replace('X', 'Y')] || 0)}px)`;
            }
        };

        /** Visible handles + edge resize cursor/drag only when this node is the selected tree item (not just same row). */
        const widthHandleTargetStrictFocus = () =>
            !selectedOnly || !nodeId || window._layoutSelectedNodeId === nodeId;

        const commitApply = (side, dx) => {
            const baseWidth = startWidth;
            let newWidth = baseWidth;
            if (side === 'left') newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth - dx, quarterCharStep));
            else newWidth = Math.max(quarterCharStep, snapToGrid(baseWidth + dx, quarterCharStep));
            widgetRef[widthKey] = newWidth;

            // Floating labels: keep the opposite edge anchored to avoid centroid drift.
            if (xKey) {
                const oldW = Math.max(quarterCharStep, baseWidth);
                const align = startAlign;
                const centerX = startAnchorX;
                const leftBefore = align === 'center' ? (centerX - oldW / 2) : (align === 'right' ? (centerX - oldW) : centerX);
                const rightBefore = leftBefore + oldW;
                const leftAfter = side === 'left' ? (rightBefore - newWidth) : leftBefore;
                if (align === 'center') widgetRef[xKey] = leftAfter + (newWidth / 2);
                else if (align === 'right') widgetRef[xKey] = leftAfter + newWidth;
                else widgetRef[xKey] = leftAfter;
            }

            // Inline row boxes: left edge drag updates offset independently.
            if (offsetKey && (side === 'left' || edgeBehavior === 'flexAutoRight')) {
                const deltaForOffset = edgeBehavior === 'flexAutoRight'
                    ? (side === 'right' ? (newWidth - baseWidth) : 0)
                    : dx;
                widgetRef[offsetKey] = snapToGrid(startOffset + deltaForOffset, quarterCharStep);
            }
        };

        el.addEventListener('mousemove', (evt) => {
            if (!widthHandleTargetStrictFocus()) {
                el.style.cursor = '';
                return;
            }
            const rect = el.getBoundingClientRect();
            const nearLeftEdge = evt.clientX <= rect.left + EDGE_HIT_PX;
            const nearRightEdge = evt.clientX >= rect.right - EDGE_HIT_PX;
            el.style.cursor = (nearLeftEdge || nearRightEdge) ? 'ew-resize' : 'grab';
        });

        el.addEventListener('mousedown', (evt) => {
            if (selectedOnly && nodeId && !layoutTreeSelectionMatchesNode(window._layoutSelectedNodeId, nodeId)) {
                selectLayoutNode(nodeId);
                return;
            }
            const rect = el.getBoundingClientRect();
            const nearLeftEdge = evt.clientX <= rect.left + EDGE_HIT_PX;
            const nearRightEdge = evt.clientX >= rect.right - EDGE_HIT_PX;
            if (!nearLeftEdge && !nearRightEdge) return;
            if (!widthHandleTargetStrictFocus()) return;
            evt.preventDefault();
            evt.stopPropagation();
            resizing = true;
            startSide = nearLeftEdge ? 'left' : 'right';
            startX = evt.clientX;
            startWidth = widthForCalc();
            startOffset = offsetForCalc();
            startAnchorX = anchorXForCalc();
            startAlign = resolveAlign();
            document.body.style.userSelect = 'none';

            const onMove = (moveEvt) => {
                if (!resizing) return;
                const delta = moveEvt.clientX - startX;
                previewApply(startSide, delta);
            };
            const onUp = (upEvt) => {
                if (!resizing) return;
                resizing = false;
                const delta = upEvt.clientX - startX;
                commitApply(startSide, delta);
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                renderScreen(jsonPath);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        if (!widthHandleTargetStrictFocus()) return;

        // Add a visible right drag handle.
        if (!el.querySelector('.tstat-width-handle')) {
            const handle = document.createElement('span');
            handle.className = 'tstat-width-handle';
            handle.style.position = 'absolute';
            handle.style.right = '-2px';
            handle.style.top = '50%';
            handle.style.transform = 'translateY(-50%)';
            handle.style.width = '10px';
            handle.style.height = '20px';
            handle.style.borderRadius = '3px';
            handle.style.background = 'rgba(245, 158, 11, 0.85)';
            handle.style.cursor = 'ew-resize';
            handle.style.zIndex = '4';
            handle.style.pointerEvents = 'auto';
            el.appendChild(handle);
            handle.addEventListener('mousedown', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (!widthHandleTargetStrictFocus()) return;
                resizing = true;
                startSide = 'right';
                startX = evt.clientX;
                startWidth = widthForCalc();
                startOffset = offsetForCalc();
                startAnchorX = anchorXForCalc();
                startAlign = resolveAlign();
                document.body.style.userSelect = 'none';
                const onMove = (moveEvt) => {
                    if (!resizing) return;
                    const delta = moveEvt.clientX - startX;
                    previewApply('right', delta);
                };
                const onUp = (upEvt) => {
                    if (!resizing) return;
                    resizing = false;
                    const delta = upEvt.clientX - startX;
                    commitApply('right', delta);
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    renderScreen(jsonPath);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
        // Add a visible left drag handle.
        if (!el.querySelector('.tstat-width-handle-left')) {
            const handleL = document.createElement('span');
            handleL.className = 'tstat-width-handle-left';
            handleL.style.position = 'absolute';
            handleL.style.left = '-2px';
            handleL.style.top = '50%';
            handleL.style.transform = 'translateY(-50%)';
            handleL.style.width = '10px';
            handleL.style.height = '20px';
            handleL.style.borderRadius = '3px';
            handleL.style.background = 'rgba(56, 189, 248, 0.9)';
            handleL.style.cursor = 'ew-resize';
            handleL.style.zIndex = '4';
            handleL.style.pointerEvents = 'auto';
            el.appendChild(handleL);
            handleL.addEventListener('mousedown', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (!widthHandleTargetStrictFocus()) return;
                resizing = true;
                startSide = 'left';
                startX = evt.clientX;
                startWidth = widthForCalc();
                startOffset = offsetForCalc();
                startAnchorX = anchorXForCalc();
                startAlign = resolveAlign();
                document.body.style.userSelect = 'none';
                const onMove = (moveEvt) => {
                    if (!resizing) return;
                    const delta = moveEvt.clientX - startX;
                    previewApply('left', delta);
                };
                const onUp = (upEvt) => {
                    if (!resizing) return;
                    resizing = false;
                    const delta = upEvt.clientX - startX;
                    commitApply('left', delta);
                    document.body.style.userSelect = '';
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    renderScreen(jsonPath);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        }
    }

    function attachOffsetDrag(el, widgetRef, xKey, yKey) {
        const nodeId = el?.dataset?.treeNodeId || null;
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let baseX = 0;
        let baseY = 0;
        el.addEventListener('mousedown', (evt) => {
            if (evt.target && evt.target.classList && (evt.target.classList.contains('tstat-width-handle') || evt.target.classList.contains('tstat-width-handle-left'))) return;
            if (nodeId && !layoutTreeSelectionMatchesNode(window._layoutSelectedNodeId, nodeId)) {
                selectLayoutNode(nodeId);
                return;
            }
            evt.preventDefault();
            evt.stopPropagation();
            dragging = true;
            startX = evt.clientX;
            startY = evt.clientY;
            baseX = Number(widgetRef[xKey] || 0);
            baseY = Number(widgetRef[yKey] || 0);
            document.body.style.userSelect = 'none';
            const onMove = (mv) => {
                if (!dragging) return;
                const dx = snapToGrid(mv.clientX - startX, quarterCharStep);
                const dy = snapToGrid(mv.clientY - startY, quarterCharStep);
                el.style.transform = `translate(${baseX + dx}px, ${baseY + dy}px)`;
            };
            const onUp = (up) => {
                if (!dragging) return;
                dragging = false;
                const dx = snapToGrid(up.clientX - startX, quarterCharStep);
                const dy = snapToGrid(up.clientY - startY, quarterCharStep);
                widgetRef[xKey] = baseX + dx;
                widgetRef[yKey] = baseY + dy;
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                renderScreen(jsonPath);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    const bindEditorControls = () => {
        if (window._lcdEditorPanelBound) return;
        window._lcdEditorPanelBound = true;

        const widthInput = document.getElementById('editor-canvas-width');
        const heightInput = document.getElementById('editor-canvas-height');
        const orientationInput = document.getElementById('editor-orientation');
        const colorModeInput = document.getElementById('editor-color-mode');
        if (!widthInput || !heightInput || !orientationInput || !colorModeInput) return;

        const updateInputsFromData = () => {
            if (!window._currentScreenData) return;
            const d = window._currentScreenData;
            widthInput.value = d.canvasProfile?.width || 320;
            heightInput.value = d.canvasProfile?.height || 480;
            orientationInput.value = d.canvasProfile?.orientation || 'vertical';
            colorModeInput.value = d.colorProfile?.mode || 'indexed';
        };

        const applyCanvasFromInputs = () => {
            const d = window._currentScreenData;
            if (!d) return;
            if (!d.canvasProfile) d.canvasProfile = {};
            if (!d.colorProfile) d.colorProfile = {};
            d.canvasProfile.width = Number(widthInput.value || 320);
            d.canvasProfile.height = Number(heightInput.value || 480);
            d.canvasProfile.orientation = orientationInput.value || 'vertical';
            d.colorProfile.mode = colorModeInput.value || 'indexed';
            ensureCanonicalSchema(d);
            writeStatus('Screen canvas updated.');
            renderScreen(window._currentJsonPath || jsonPath);
        };

        const onFieldChange = () => applyCanvasFromInputs();
        widthInput.addEventListener('change', onFieldChange);
        heightInput.addEventListener('change', onFieldChange);
        orientationInput.addEventListener('change', onFieldChange);
        colorModeInput.addEventListener('change', onFieldChange);

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
    const lcdCanvasWidth = data.page === 'MAIN_DISPLAY'
        ? 320
        : (data.canvasProfile?.width || data.layout?.canvas?.width || 320);
    const lcdCanvasHeight = data.page === 'MAIN_DISPLAY'
        ? 480
        : (data.canvasProfile?.height || data.layout?.canvas?.height || 480);
    lcd.style.width = lcdCanvasWidth + 'px';
    lcd.style.height = lcdCanvasHeight + 'px';
    if (data.page === 'MAIN_DISPLAY') {
        lcd.style.overflow = 'hidden';
        lcd.style.transform = 'none';
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
            const defaultWidth = alignKey === 'labelAlign' ? (data.layout?.labelColumn?.width || 120) : (data.layout?.valueColumn?.width || 120);
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
    // Only menu_row widgets are focusable, in JSON order (provisioning: rows shown but focus is on Connect/Back only).
    const menuRowsAll = (data.widgets || []).filter(w => w.type === 'menu_row').sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    const menuRows = data.page === 'PROVISIONING_SETUP' ? [] : menuRowsAll;
    console.log('Menu row order (by lcdRow):', menuRowsAll.map(r => `${r.label} (row ${r.lcdRow})`));
    // Focus is index in sorted menuRows array
    let menuRowsFocusedIndex = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
    if (menuRows.length > 0) {
        menuRowsFocusedIndex = ((menuRowsFocusedIndex % menuRows.length) + menuRows.length) % menuRows.length;
        window._currentScreenFocus = menuRowsFocusedIndex;
        const stateMap = getScreenStateMap();
        const existing = stateMap[jsonPath] || {};
        stateMap[jsonPath] = {
            ...existing,
            focusIndex: menuRowsFocusedIndex,
            ipOctetIndex: typeof window._ipEditOctetIndex === 'number' ? window._ipEditOctetIndex : 0,
            ipEditMode: !!window._ipEditMode,
            wifiRowEditMode: !!window._wifiRowEditMode,
            valueEditMode: !!window._valueEditMode
        };
    } else if (data.page === 'PROVISIONING_SETUP') {
        if (typeof window._provisioningButtonFocus !== 'number') window._provisioningButtonFocus = 0;
        const stateMap = getScreenStateMap();
        const existing = stateMap[jsonPath] || {};
        stateMap[jsonPath] = {
            ...existing,
            provisioningButtonFocus: window._provisioningButtonFocus
        };
    }
    const focusedMenuRowId = menuRows[menuRowsFocusedIndex]?.id || null;
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
            header.dataset.treeNodeId = `w-${idx}`;
            if (window._isVisualEditMode) {
                header.style.cursor = 'pointer';
                header.addEventListener('mousedown', (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    selectLayoutNode(`w-${idx}`);
                });
            }

            if (window._isVisualEditMode) {
                header.style.outline = '1px dashed lightgrey';
                header.style.cursor = 'grab';
                enableInlineTextEdit(header, () => widget.text || '', (txt) => { widget.text = txt; renderScreen(jsonPath); });
                header.addEventListener('contextmenu', (e) => {
                    selectLayoutNode(`w-${idx}`);
                    showAlignmentMenu(e, widget, 'align');
                });
            }
            lcd.appendChild(header);
        } else if (widget.type === 'label') {
            const label = document.createElement('div');
            if (widget.id) label.id = widget.id;
            label.dataset.treeNodeId = `w-${idx}`;
            if (window._isVisualEditMode) {
                label.style.cursor = 'pointer';
                label.addEventListener('mousedown', (evt) => {
                    evt.preventDefault();
                    evt.stopPropagation();
                    if (widget.id === 'main_icons_group') {
                        const part = evt.target?.closest?.('[data-icon-key]');
                        if (part?.dataset?.iconKey) {
                            selectLayoutNode(`w-${idx}-icon-${part.dataset.iconKey}`);
                            return;
                        }
                    }
                    selectLayoutNode(`w-${idx}`);
                });
            }
            label.style.position = 'absolute';
            const xPos = widget.x || 0;
            let yPos = widget.y || 0;
            if (data.page === 'MAIN_DISPLAY' && widget.id === 'main_icons_group') {
                // Keep icon strip inside LCD bounds in all modes.
                const iconRowHeight = 64;
                const maxY = Math.max(0, canvasHeightPx - iconRowHeight);
                const clampedY = Math.max(0, Math.min(maxY, Number(yPos || 0)));
                if (clampedY !== Number(widget.y || 0)) widget.y = clampedY;
                yPos = clampedY;
            }
            label.style.left = xPos + 'px';
            label.style.top = yPos + 'px';
            if (widget.id === 'prov_rssi_icon') label.style.zIndex = '12';
            if (widget.width != null) label.style.width = widget.width + 'px';
            if (widget.align === 'center') {
                label.style.transform = 'translateX(-50%)';
            } else if (widget.align === 'right') {
                label.style.transform = 'translateX(-100%)';
            }
            label.style.textAlign = widget.align || 'left';
            label.style.font = widget.font || (data.styles?.fontSize || '22px') + ' ' + (data.styles?.fontFamily || 'monospace');
            if (widget.fontSize) label.style.fontSize = `${widget.fontSize}px`;
            label.style.color = widget.color || '#fff';
            label.style.whiteSpace = widget.wrap ? 'normal' : 'nowrap';
            if (widget.id === 'main_icons_group') {
                label.innerHTML = renderMainIconsGroupText(widget);
            } else if (widget.id === 'prov_rssi_icon' && data.page === 'PROVISIONING_SETUP') {
                const st = data.widgets?.find((w) => w && w.id === 'ui_item_prov_status');
                const { icon } = getProvisioningRssiPresentation(st?.value);
                label.innerHTML =
                    `<span class="prov-rssi-icon-chip" aria-hidden="true">` +
                    `<img src="./Icons/${icon}.svg" width="26" height="26" alt="" draggable="false" style="display:block;image-rendering:pixelated;image-rendering:crisp-edges" />` +
                    `</span>`;
            } else if (typeof widget.text === 'string' && widget.text.includes('id="temp_val"')) {
                const tempPoint = widget.t3ValueBinding || 'IN9';
                const liveTemp = getT3000PointValue(tempPoint);
                const rendered = Number.isFinite(Number(liveTemp)) ? Number(liveTemp).toFixed(1) : String(liveTemp ?? '');
                label.innerHTML = widget.text.replace(/>[^<]*<\/span><span style="font-size:26px;font-weight:600;vertical-align:super;margin-left:2px">°C<\/span>/, `>${rendered}</span><span style="font-size:26px;font-weight:600;vertical-align:super;margin-left:2px">°C</span>`);
            } else if (isSvgLibraryIconLabel(widget) && typeof widget.text === 'string') {
                label.style.lineHeight = '0';
                label.style.display = 'inline-block';
                label.innerHTML = `<span class="tstat-icon-svg-wrap">${widget.text}</span>`;
            } else {
                label.innerHTML = widget.text.replace(/\n/g, '<br>');
            }
            if (widget.id === 'main_ticker_line') {
                const tickerInner = label.querySelector('div');
                if (tickerInner && widget.width != null) {
                    tickerInner.style.width = `${Number(widget.width)}px`;
                    tickerInner.style.boxSizing = 'border-box';
                }
            }
            if (widget.id === 'main_icons_group' && window._layoutSelectedNodeId === `w-${idx}`) {
                label.classList.add('layout-group-selected');
            }
            if (window._isVisualEditMode) {
                label.style.outline = '1px dashed lightgrey';
                label.style.cursor = 'move';
                label.addEventListener('wheel', (e) => {
                    if (!e.shiftKey) return;
                    e.preventDefault();
                    const current = Number(widget.fontSize || parseInt(data.styles?.fontSize || '22', 10) || 22);
                    widget.fontSize = Math.max(10, current + (e.deltaY < 0 ? 1 : -1));
                    renderScreen(jsonPath);
                }, { passive: false });
                label.addEventListener('mousedown', (e) => {
                    // Ignore width-handle drags; those are handled separately.
                    if (e.target && e.target.classList && (e.target.classList.contains('tstat-width-handle') || e.target.classList.contains('tstat-width-handle-left'))) return;
                    if (window._layoutSelectedNodeId !== `w-${idx}`) {
                        selectLayoutNode(`w-${idx}`);
                        return;
                    }
                    e.preventDefault();
                    e.stopPropagation();
                    const lcdRect = lcd.getBoundingClientRect();
                    const zoom = Number(window._tstatZoom || 1);
                    const startMouseX = (e.clientX - lcdRect.left) / zoom;
                    const startMouseY = (e.clientY - lcdRect.top) / zoom;
                    const startX = Number(widget.x || 0);
                    const startY = Number(widget.y || 0);
                    let moved = false;
                    const DRAG_THRESHOLD = 2;
                    document.body.style.userSelect = 'none';
                    if (widget.id === 'main_ticker_line') {
                        label.classList.add('layout-drag-active');
                    }

                    const onMove = (mv) => {
                        const curMouseX = (mv.clientX - lcdRect.left) / zoom;
                        const curMouseY = (mv.clientY - lcdRect.top) / zoom;
                        const dx = snapToGrid(curMouseX - startMouseX, quarterCharStep);
                        const dy = snapToGrid(curMouseY - startMouseY, quarterCharStep);
                        if (!moved && (Math.abs(dx) >= DRAG_THRESHOLD || Math.abs(dy) >= DRAG_THRESHOLD)) moved = true;
                        if (!moved) return;
                        const previewX = Math.max(0, Math.min(canvasWidthPx, startX + dx));
                        const previewY = Math.max(0, Math.min(canvasHeightPx, startY + dy));
                        label.style.left = `${previewX}px`;
                        label.style.top = `${previewY}px`;
                    };
                    const onUp = (up) => {
                        const curMouseX = (up.clientX - lcdRect.left) / zoom;
                        const curMouseY = (up.clientY - lcdRect.top) / zoom;
                        const dx = snapToGrid(curMouseX - startMouseX, quarterCharStep);
                        const dy = snapToGrid(curMouseY - startMouseY, quarterCharStep);
                        if (moved) {
                            widget.x = Math.max(0, Math.min(canvasWidthPx, startX + dx));
                            widget.y = Math.max(0, Math.min(canvasHeightPx, startY + dy));
                            const wid = widget.id;
                            const list = window._currentScreenData?.widgets;
                            if (wid && Array.isArray(list)) {
                                const ddx = widget.x - startX;
                                const ddy = widget.y - startY;
                                if (ddx !== 0 || ddy !== 0) {
                                    list.forEach((c) => {
                                        if (c && c.parentId === wid) {
                                            c.x = Math.max(0, Math.min(canvasWidthPx, Number(c.x || 0) + ddx));
                                            c.y = Math.max(0, Math.min(canvasHeightPx, Number(c.y || 0) + ddy));
                                        }
                                    });
                                }
                            }
                        } else if (typeof label._startInlineEdit === 'function' && typeof widget.text === 'string' && !widget.text.includes('<svg')) {
                            const now = Date.now();
                            const prev = Number(label._lastSelectTs || 0);
                            if (now - prev < 450) {
                                label._startInlineEdit();
                            }
                            label._lastSelectTs = now;
                        }
                        document.body.style.userSelect = '';
                        label.classList.remove('layout-drag-active');
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        if (moved) renderScreen(jsonPath);
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
                const fallbackWidth = Math.max(40, Number(widget.width || label.offsetWidth || 80));
                attachWidthDragResize(label, widget, 'width', fallbackWidth, {
                    xKey: 'x',
                    alignKey: 'align',
                    defaultAlign: 'left',
                    nodeId: `w-${idx}`,
                    selectedOnly: true
                });
                if (typeof widget.text === 'string' && !widget.text.includes('<svg')) {
                    enableInlineTextEdit(label, () => widget.text || '', (txt) => {
                        widget.text = String(txt || '');
                        renderScreen(jsonPath);
                    });
                }
            }
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
            row.dataset.treeNodeId = `w-${idx}`;
            if (widget.id) row.dataset.menuRowId = widget.id;
            row.style.position = 'absolute';
            row.style.left = (data.layout?.rowLeftPadding || 0) + 'px';
            const lcdRow = normalizeLcdRowSlot(widget.lcdRow);
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
                // Pointer row-reorder: works over overlays/labels and uses scaled LCD coordinates (unlike HTML5 DnD).
                row.style.cursor = 'grab';
                row.addEventListener('mousedown', (evt) => {
                    if (evt.button !== 0) return;
                    const nodeId = `w-${idx}`;
                    if (window._layoutSelectedNodeId !== nodeId) {
                        evt.preventDefault();
                        evt.stopPropagation();
                        selectLayoutNode(nodeId);
                        return;
                    }
                    evt.preventDefault();
                    evt.stopPropagation();
                    const startY = evt.clientY;
                    const dragThresholdPx = 6;
                    let dragging = false;
                    let guide = null;
                    const h = menuRowPixelHeight;
                    const maxSlots = Math.max(1, Math.floor(Number(lcdCanvasHeight) / h));
                    const pathForRerender = () => (window._currentJsonPath || jsonPath);
                    const onMove = (mv) => {
                        if (!dragging && Math.abs(mv.clientY - startY) < dragThresholdPx) return;
                        if (!dragging) {
                            dragging = true;
                            document.body.style.userSelect = 'none';
                            row.style.opacity = '0.55';
                            guide = document.createElement('div');
                            guide.className = 'lcd-row-reorder-guide';
                            guide.style.cssText = 'position:absolute;left:0;width:100%;height:2px;background:#00e676;pointer-events:none;z-index:100001;box-shadow:0 0 6px rgba(0,230,118,.45)';
                            lcd.appendChild(guide);
                        }
                        const yLocal = lcdClientYToLocalY(mv.clientY, lcd);
                        const targetRow = Math.max(1, Math.min(maxSlots, Math.floor(yLocal / h) + 1));
                        guide.style.top = `${(targetRow - 1) * h - 1}px`;
                    };
                    const onUp = (up) => {
                        document.removeEventListener('mousemove', onMove);
                        document.removeEventListener('mouseup', onUp);
                        document.body.style.userSelect = '';
                        row.style.opacity = '';
                        if (guide?.parentNode) guide.remove();
                        if (dragging) {
                            const yLocal = lcdClientYToLocalY(up.clientY, lcd);
                            const widgets = window._currentScreenData?.widgets;
                            if (applyRowSlotReorderAtLocalY(widget, yLocal, widgets, h, lcdCanvasHeight)) {
                                renderScreen(pathForRerender());
                            }
                        }
                    };
                    document.addEventListener('mousemove', onMove);
                    document.addEventListener('mouseup', onUp);
                });
            }

            if (widget.type === 'menu_row') {
                                // Value
                                let liveWidget = (window._currentScreenData?.widgets || []).find(w => w.type === 'menu_row' && w.id === widget.id) || widget;
                                const valueSpan = document.createElement('span');
                                valueSpan.classList.add('tstat-value-box');
                                if (widget.valueId) valueSpan.id = widget.valueId;
                                const isMainHome = data.page === 'MAIN_DISPLAY';
                                const boundValue = liveWidget.t3ValueBinding ? getT3000PointValue(liveWidget.t3ValueBinding) : null;
                                let rawVal;
                                const storedVal = (liveWidget.value ?? '').toString();
                                const useStoredInLayoutEdit =
                                    window._isVisualEditMode && storedVal.trim().length > 0;
                                if (useStoredInLayoutEdit) {
                                    rawVal = storedVal;
                                } else if (data.page === 'PROVISIONING_SETUP' && widget.id === 'ui_item_prov_rssi') {
                                    const st = (window._currentScreenData?.widgets || []).find((w) => w && w.id === 'ui_item_prov_status');
                                    rawVal = getProvisioningRssiPresentation(st?.value).text;
                                } else if (data.page === 'PROVISIONING_SETUP' && widget.id === 'ui_item_prov_rssi_quality') {
                                    const st = (window._currentScreenData?.widgets || []).find((w) => w && w.id === 'ui_item_prov_status');
                                    rawVal = getProvisioningRssiPresentation(st?.value).quality;
                                } else {
                                    rawVal = (boundValue ?? liveWidget.value ?? liveWidget.options?.[0] ?? '').toString();
                                }
                                const ipv4RowIds = ['ui_item_ip', 'ui_item_mask', 'ui_item_gw'];
                                const activeOctetIndex = (
                                    data.page === 'WIFI_SETTINGS' &&
                                    isIpv4RowId(widget.id) &&
                                    window._ipEditMode &&
                                    widget.id === focusedMenuRowId
                                )
                                    ? Number(window._ipEditOctetIndex || 0)
                                    : null;
                                const ipv4Html = !isMainHome && ipv4RowIds.includes(widget.id)
                                    ? formatIPv4AlignedHtml(rawVal, activeOctetIndex)
                                    : null;
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
                                valueSpan.style.width = (widget.valueWidth || data.layout?.valueColumn?.width || 120) + 'px';
                                valueSpan.style.marginLeft = 'auto';
                                valueSpan.style.textAlign = 'left';
                                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                                valueSpan.style.paddingRight = 0;
                                valueSpan.style.whiteSpace = 'nowrap';
                                valueSpan.style.overflow = 'hidden';
                                valueSpan.style.textOverflow = 'ellipsis';
                                const isSettingsPage = data.page !== 'MAIN_DISPLAY' && data.page !== 'SETUP_MENU';
                                const editActive = isSettingsPage && widget.id === focusedMenuRowId &&
                                    (data.page === 'WIFI_SETTINGS' ? !!window._wifiRowEditMode : !!window._valueEditMode);
                                if (editActive) valueSpan.classList.add('tstat-edit-active');
                // Render highlight background for every row, only visible for focused row
                const highlight = document.createElement('div');
                highlight.style.position = 'absolute';
                // Make the highlight one char narrower, with a char of space on each side
                const charWidth = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
                const defaultInsetX = charWidth / 2;
                const insetX = Number(widget.highlightInsetX ?? defaultInsetX);
                const insetY = Number(widget.highlightInsetY ?? 0);
                const widthAdjust = Number(widget.highlightWidthAdjust ?? 0);
                const heightAdjust = Number(widget.highlightHeightAdjust ?? 0);
                const highlightWidth = `calc(100% - ${(insetX * 2) - widthAdjust}px)`;
                const highlightHeight = Math.max(1, menuRowPixelHeight + heightAdjust);
                highlight.style.left = insetX + 'px';
                highlight.style.top = insetY + 'px';
                highlight.style.width = highlightWidth;
                highlight.style.height = highlightHeight + 'px';
                highlight.style.background = data.styles?.highlight || '#008080';
                highlight.style.borderRadius = `${Number(widget.highlightRadius ?? 8)}px`;
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
                const selectedNodeId = window._layoutSelectedNodeId || '';
                const thisRowNodeId = `w-${idx}`;
                if (window._isVisualEditMode && (widget.id === focusedMenuRowId || layoutTreeSelectionMatchesNode(selectedNodeId, thisRowNodeId))) {
                    highlight.style.pointerEvents = 'auto';
                    const moveHandle = document.createElement('span');
                    moveHandle.style.position = 'absolute';
                    moveHandle.style.left = '-3px';
                    moveHandle.style.top = '-3px';
                    moveHandle.style.width = '8px';
                    moveHandle.style.height = '8px';
                    moveHandle.style.borderRadius = '50%';
                    moveHandle.style.background = 'rgba(14,165,233,0.95)';
                    moveHandle.style.cursor = 'move';
                    moveHandle.style.zIndex = '6';
                    highlight.appendChild(moveHandle);

                    const resizeHandle = document.createElement('span');
                    resizeHandle.style.position = 'absolute';
                    resizeHandle.style.right = '-4px';
                    resizeHandle.style.top = '50%';
                    resizeHandle.style.transform = 'translateY(-50%)';
                    resizeHandle.style.width = '8px';
                    resizeHandle.style.height = '16px';
                    resizeHandle.style.borderRadius = '4px';
                    resizeHandle.style.background = 'rgba(245,158,11,0.95)';
                    resizeHandle.style.cursor = 'ew-resize';
                    resizeHandle.style.zIndex = '6';
                    highlight.appendChild(resizeHandle);

                    // Full-height drag lines on left/right edges for direct resize interaction.
                    const leftLineHandle = document.createElement('span');
                    leftLineHandle.style.position = 'absolute';
                    leftLineHandle.style.left = '-2px';
                    leftLineHandle.style.top = '0';
                    leftLineHandle.style.width = '4px';
                    leftLineHandle.style.height = '100%';
                    leftLineHandle.style.background = 'rgba(56, 189, 248, 0.7)';
                    leftLineHandle.style.cursor = 'ew-resize';
                    leftLineHandle.style.zIndex = '6';
                    highlight.appendChild(leftLineHandle);

                    const rightLineHandle = document.createElement('span');
                    rightLineHandle.style.position = 'absolute';
                    rightLineHandle.style.right = '-2px';
                    rightLineHandle.style.top = '0';
                    rightLineHandle.style.width = '4px';
                    rightLineHandle.style.height = '100%';
                    rightLineHandle.style.background = 'rgba(56, 189, 248, 0.7)';
                    rightLineHandle.style.cursor = 'ew-resize';
                    rightLineHandle.style.zIndex = '6';
                    highlight.appendChild(rightLineHandle);

                    const bindMove = () => {
                        let drag = false, sx = 0, sy = 0, bx = 0, by = 0;
                        moveHandle.addEventListener('mousedown', (evt) => {
                            evt.preventDefault(); evt.stopPropagation();
                            drag = true;
                            sx = evt.clientX; sy = evt.clientY;
                            bx = Number(widget.highlightInsetX ?? (charWidth / 2));
                            by = Number(widget.highlightInsetY ?? 0);
                            const onMove = (mv) => {
                                if (!drag) return;
                                const dx = snapToGrid(mv.clientX - sx, quarterCharStep);
                                const dy = snapToGrid(mv.clientY - sy, quarterCharStep);
                                highlight.style.left = `${bx + dx}px`;
                                highlight.style.top = `${by + dy}px`;
                            };
                            const onUp = (up) => {
                                if (!drag) return;
                                drag = false;
                                const dx = snapToGrid(up.clientX - sx, quarterCharStep);
                                const dy = snapToGrid(up.clientY - sy, quarterCharStep);
                                widget.highlightInsetX = bx + dx;
                                widget.highlightInsetY = by + dy;
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                                renderScreen(jsonPath);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    };
                    const bindResize = () => {
                        let drag = false, sx = 0, bw = 0;
                        resizeHandle.addEventListener('mousedown', (evt) => {
                            evt.preventDefault(); evt.stopPropagation();
                            drag = true;
                            sx = evt.clientX;
                            bw = Number(widget.highlightWidthAdjust ?? 0);
                            const onMove = (mv) => {
                                if (!drag) return;
                                const dx = snapToGrid(mv.clientX - sx, quarterCharStep);
                                const insetXNow = Number(widget.highlightInsetX ?? (charWidth / 2));
                                highlight.style.width = `calc(100% - ${(insetXNow * 2) - (bw + dx)}px)`;
                            };
                            const onUp = (up) => {
                                if (!drag) return;
                                drag = false;
                                const dx = snapToGrid(up.clientX - sx, quarterCharStep);
                                widget.highlightWidthAdjust = bw + dx;
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                                renderScreen(jsonPath);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    };
                    const bindEdgeResize = (edgeEl, direction) => {
                        let drag = false, sx = 0, baseInset = 0, baseWidthAdj = 0;
                        edgeEl.addEventListener('mousedown', (evt) => {
                            evt.preventDefault(); evt.stopPropagation();
                            drag = true;
                            sx = evt.clientX;
                            baseInset = Number(widget.highlightInsetX ?? (charWidth / 2));
                            baseWidthAdj = Number(widget.highlightWidthAdjust ?? 0);
                            const onMove = (mv) => {
                                if (!drag) return;
                                const dx = snapToGrid(mv.clientX - sx, quarterCharStep);
                                if (direction === 'left') {
                                    const inset = baseInset + dx;
                                    const widthAdj = baseWidthAdj - (dx * 2);
                                    highlight.style.left = `${inset}px`;
                                    highlight.style.width = `calc(100% - ${(inset * 2) - widthAdj}px)`;
                                } else {
                                    const widthAdj = baseWidthAdj + dx;
                                    const inset = Number(widget.highlightInsetX ?? (charWidth / 2));
                                    highlight.style.width = `calc(100% - ${(inset * 2) - widthAdj}px)`;
                                }
                            };
                            const onUp = (up) => {
                                if (!drag) return;
                                drag = false;
                                const dx = snapToGrid(up.clientX - sx, quarterCharStep);
                                if (direction === 'left') {
                                    widget.highlightInsetX = baseInset + dx;
                                    widget.highlightWidthAdjust = baseWidthAdj - (dx * 2);
                                } else {
                                    widget.highlightWidthAdjust = baseWidthAdj + dx;
                                }
                                document.removeEventListener('mousemove', onMove);
                                document.removeEventListener('mouseup', onUp);
                                renderScreen(jsonPath);
                            };
                            document.addEventListener('mousemove', onMove);
                            document.addEventListener('mouseup', onUp);
                        });
                    };
                    bindMove();
                    bindResize();
                    bindEdgeResize(leftLineHandle, 'left');
                    bindEdgeResize(rightLineHandle, 'right');
                }
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
                } else if (!focusedMenuRow || widget.id !== focusedMenuRow.id) {
                    // Provisioning uses empty menuRows for keypad focus (Connect/Back only); no focused row → show all rows.
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
                labelSpanFixed.dataset.treeNodeId = `w-${idx}-label`;
                if (window._isVisualEditMode) {
                    labelSpanFixed.addEventListener('mousedown', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        selectLayoutNode(`w-${idx}-label`);
                    });
                }
                const needsLeadingSpacer = data.page !== 'MAIN_DISPLAY' && data.page !== 'WIFI_SETTINGS';
                const renderedLabel = resolveMenuRowLabel(widget);
                labelSpanFixed.textContent = (needsLeadingSpacer ? '\u00A0' : '') + renderedLabel;
                // Removed left padding, use non-breaking space for shift
                labelSpanFixed.style.display = 'inline-block';
                labelSpanFixed.style.width = (widget.labelWidth || data.layout?.labelColumn?.width || 120) + 'px';
                labelSpanFixed.style.textAlign = widget.labelAlign || data.layout?.labelColumnLayout?.align || 'left';
                labelSpanFixed.style.fontWeight = 'bold';
                labelSpanFixed.style.color = '#fff';
                labelSpanFixed.style.padding = '0';
                if (data.page === 'WIFI_SETTINGS') {
                    const lpad = data.layout?.labelBoxLeftPadding ?? 0;
                    const rpad = data.layout?.labelBoxRightPadding ?? 0;
                    labelSpanFixed.style.paddingLeft = lpad + 'px';
                    labelSpanFixed.style.paddingRight = rpad + 'px';
                    labelSpanFixed.style.boxSizing = 'border-box';
                }
                labelSpanFixed.style.margin = '0';
                const labelOffsetX = Number(widget.labelOffsetX || 0);
                const labelOffsetY = Number(widget.labelOffsetY || 0);
                if (labelOffsetX || labelOffsetY) {
                    labelSpanFixed.style.transform = `translate(${labelOffsetX}px, ${labelOffsetY}px)`;
                }
                labelSpanFixed.style.overflow = 'hidden';
                labelSpanFixed.style.textOverflow = 'ellipsis';
                labelSpanFixed.style.whiteSpace = 'nowrap';

                if (window._isVisualEditMode) {
                    labelSpanFixed.style.outline = '1px dashed lightgrey';
                    labelSpanFixed.style.cursor = 'grab';
                    enableInlineTextEdit(
                        labelSpanFixed,
                        () => ((needsLeadingSpacer ? '\u00A0' : '') + (resolveMenuRowLabel(widget) || '')),
                        (txt) => {
                            const clean = String(txt || '').replace('\u00A0', '').trim();
                            if (String(widget.labelDisplayMode || '').toLowerCase() === 'custom') {
                                widget.labelCustom = clean;
                            } else {
                                widget.label = clean;
                            }
                            renderScreen(jsonPath);
                        }
                    );
                    labelSpanFixed.addEventListener('contextmenu', (e) => {
                        selectLayoutNode(`w-${idx}-label`);
                        showAlignmentMenu(e, widget, 'labelAlign');
                    });
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
                    const defaultWidth = data.layout?.labelColumn?.width || 120;
                    attachWidthDragResize(labelSpanFixed, widget, 'labelWidth', defaultWidth, {
                        offsetKey: 'labelOffsetX',
                        nodeId: `w-${idx}-label`,
                        selectedOnly: true
                    });
                    attachOffsetDrag(labelSpanFixed, widget, 'labelOffsetX', 'labelOffsetY');
                }
                row.appendChild(labelSpanFixed);
                // (removed duplicate labelSpan code)
                valueSpan.style.textAlign = widget.valueAlign || data.layout?.valueBoxTextAlign || 'right';
                valueSpan.dataset.treeNodeId = `w-${idx}-value`;
                if (window._isVisualEditMode) {
                    valueSpan.addEventListener('mousedown', (evt) => {
                        evt.preventDefault();
                        evt.stopPropagation();
                        selectLayoutNode(`w-${idx}-value`);
                    });
                }
                valueSpan.style.paddingLeft = (data.layout?.valueBoxLeftPadding || 0) + 'px';
                valueSpan.style.marginRight = (data.layout?.valueBoxRightPadding || 0) + 'px';
                valueSpan.style.paddingRight = 0;
                const valueOffsetX = Number(widget.valueOffsetX || 0);
                const valueOffsetY = Number(widget.valueOffsetY || 0);
                if (valueOffsetX || valueOffsetY) {
                    valueSpan.style.transform = `translate(${valueOffsetX}px, ${valueOffsetY}px)`;
                }
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
                    valueSpan.style.overflowX = 'hidden';
                    valueSpan.style.overflowY = 'hidden';
                    valueSpan.style.textOverflow = 'clip';
                    valueSpan.title = 'Use keypad arrows to edit values';
                    // Keep full IPv4 values visible within the fixed LCD row width.
                    valueSpan.style.fontSize = '24px';
                    valueSpan.style.letterSpacing = '0';
                }

                if (window._isVisualEditMode) {
                    valueSpan.style.outline = '1px dashed lightgrey';
                    valueSpan.style.cursor = 'grab';
                    valueSpan.addEventListener('contextmenu', (e) => {
                        selectLayoutNode(`w-${idx}-value`);
                        showAlignmentMenu(e, widget, 'valueAlign');
                    });
                    // Fast resize using mouse wheel
                    valueSpan.addEventListener('wheel', (e) => {
                        e.preventDefault();
                        const charWidth = (data.layout?.lcdCanvas?.width || 320) / (data.layout?.lcdTextColumns || 16);
                        const defaultWidth = data.layout?.valueColumn?.width || 120;
                        let currentWidth = widget.valueWidth || defaultWidth;
                        if (e.deltaY < 0) widget.valueWidth = currentWidth + charWidth; // scroll up grows
                        else widget.valueWidth = Math.max(charWidth, currentWidth - charWidth); // scroll down shrinks
                        renderScreen(jsonPath);
                    });
                    const defaultWidth = data.layout?.valueColumn?.width || 120;
                    attachWidthDragResize(valueSpan, widget, 'valueWidth', defaultWidth, {
                        offsetKey: 'valueOffsetX',
                        edgeBehavior: 'flexAutoRight',
                        nodeId: `w-${idx}-value`,
                        selectedOnly: true
                    });
                    attachOffsetDrag(valueSpan, widget, 'valueOffsetX', 'valueOffsetY');
                    const canEditMenuValueText = !liveWidget.t3ValueBinding && !ipv4Html;
                    if (canEditMenuValueText) {
                        enableInlineTextEdit(valueSpan, () => String(rawVal ?? ''), (txt) => {
                            widget.value = String(txt || '').trim();
                            renderScreen(jsonPath);
                        });
                    }
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
        const widgetIdx = (data.widgets || []).indexOf(widget);
        btn.dataset.treeNodeId = widgetIdx >= 0 ? `w-${widgetIdx}` : `w-btn-${idx}`;
        if (window._isVisualEditMode) {
            btn.style.cursor = 'grab';
            btn.addEventListener('click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                if (widgetIdx >= 0) selectLayoutNode(`w-${widgetIdx}`);
            });
        }
        const labelSpan = document.createElement('span');
        labelSpan.className = 'tstat-lcd-btn__label';
        labelSpan.textContent = widget.label ?? '';
        btn.appendChild(labelSpan);
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
        btn.style.userSelect = window._isVisualEditMode ? 'text' : 'none';
        btn.style.border = '2px solid #fff';
        if (widget.font) {
            btn.style.font = widget.font;
        } else {
            btn.style.fontSize = data.styles?.fontSize || '22px';
        }

        // Add navigation click handlers (disabled in layout edit — use Play to preview)
        if (!window._isVisualEditMode) {
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
                    if (data.page === 'WIFI_SETTINGS') {
                        const focusedRow = menuRows[focusIdx];
                        if (focusedRow) {
                            if (!window._wifiRowEditMode) {
                                window._wifiRowEditMode = true;
                                window._ipEditMode = isIpv4RowId(focusedRow.id);
                                window._valueEditMode = true;
                                if (window._ipEditMode) window._ipEditOctetIndex = 0;
                            } else if (window._ipEditMode && isIpv4RowId(focusedRow.id)) {
                                window._ipEditOctetIndex = (Number(window._ipEditOctetIndex || 0) + 1) % 4;
                            }
                            renderScreen(window._currentJsonPath);
                        }
                        return;
                    }
                    if (data.page === 'MAIN_DISPLAY') {
                        // Home screen NEXT behavior: cycle focused parameter row.
                        focusIdx = (focusIdx + 1) % menuRows.length;
                        window._currentScreenFocus = focusIdx;
                        window._valueEditMode = false;
                        renderScreen(window._currentJsonPath);
                        return;
                    }
                    focusIdx = advanceFocusByRight(data, menuRows, focusIdx);
                    window._currentScreenFocus = focusIdx;
                    renderScreen(window._currentJsonPath);
                });
            } else if (widget.id === 'btn_connect_phone') {
                btn.style.cursor = 'pointer';
                btn.addEventListener('click', () => {
                    if (data.page !== 'PROVISIONING_SETUP') return;
                    window._provisioningButtonFocus = 0;
                    const sm = getScreenStateMap();
                    sm[jsonPath] = { ...sm[jsonPath], provisioningButtonFocus: 0 };
                    startProvisioningConnectFlow(jsonPath);
                });
            }
        }

        if (window._isVisualEditMode) {
            btn.style.outline = '1px dashed lightgrey';
            labelSpan.style.userSelect = 'text';
            labelSpan.style.cursor = 'text';
            labelSpan.style.minWidth = '0';
            labelSpan.style.maxWidth = '100%';
            labelSpan.style.overflow = 'hidden';
            labelSpan.style.textOverflow = 'ellipsis';
            enableInlineTextEdit(labelSpan, () => String(widget.label ?? ''), (txt) => {
                widget.label = String(txt || '').trim();
                renderScreen(jsonPath);
            });
            btn.addEventListener('dblclick', (evt) => {
                if (evt.target !== btn) return;
                evt.preventDefault();
                evt.stopPropagation();
                if (typeof labelSpan._startInlineEdit === 'function') labelSpan._startInlineEdit();
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
        if (data.page === 'PROVISIONING_SETUP' && (widget.id === 'btn_connect_phone' || widget.id === 'btn_back')) {
            const bf = typeof window._provisioningButtonFocus === 'number' ? window._provisioningButtonFocus : 0;
            const isConnect = widget.id === 'btn_connect_phone';
            const focused = (isConnect && bf === 0) || (!isConnect && bf === 1);
            btn.classList.add('tstat-lcd-btn--prov-nav');
            if (focused) {
                btn.style.border = '3px solid #00e676';
                btn.style.boxShadow = '0 0 0 2px rgba(0,230,118,0.45), 0 4px 14px rgba(0,0,0,0.2)';
            } else {
                btn.style.border = '2px solid rgba(255,255,255,0.5)';
                btn.style.boxShadow = '0 2px 6px rgba(0,0,0,0.12)';
            }
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
        // Keep a small visual gap above the arrow/button row so text doesn't crowd it.
        const previewGapPx = 8;
        const previewTopPx = Math.max(0, buttonTopPx - menuRowPixelHeight - previewGapPx);

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
        preview.style.fontSize = '20px';
        preview.style.fontWeight = 'bold';
        preview.style.color = '#fff';
        preview.style.background = 'rgba(0,0,0,0.32)';
        preview.style.borderTop = '1px solid rgba(255,255,255,0.22)';
        preview.style.borderBottom = '1px solid rgba(255,255,255,0.12)';
        preview.style.zIndex = '12';
        preview.style.overflowX = 'hidden';
        preview.style.overflowY = 'hidden';
        preview.style.whiteSpace = 'nowrap';
        preview.style.pointerEvents = 'none';

        if (focused) {
            const live = (data.widgets || []).find(w => w.type === 'menu_row' && w.id === focused.id) || focused;
            const raw = (live.value ?? live.options?.[0] ?? '').toString();
            if (isIpv4RowId(live.id) && window._ipEditMode) {
                const octetIndex = Number(window._ipEditOctetIndex || 0);
                const ipHtml = formatIPv4AlignedHtml(raw, Number.isNaN(octetIndex) ? 0 : octetIndex);
                preview.innerHTML = ipHtml ? `${escapeHtml(live.label)}: ${ipHtml}` : `${escapeHtml(live.label)}: ${escapeHtml(raw)}`;
            } else {
                preview.textContent = `${live.label}: ${raw}`;
            }
        }
        lcd.appendChild(preview);
    }
    setupMainTickerSimulation(data);
    ensurePhoneSendCredsButtonBound();
    syncPhoneSendCredsButtonVisibility();
    applySelectionOutline();
    } finally {
        window._tstatRenderScreenInFlight = false;
        const q = window._tstatRenderScreenQueuedPath;
        window._tstatRenderScreenQueuedPath = null;
        if (typeof q === 'string' && q.length) {
            queueMicrotask(() => renderScreen(q));
        }
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
        const prev = v;
        if (isUp) v = Math.min(max, Math.round((v + step) * 100) / 100);
        else v = Math.max(min, Math.round((v - step) * 100) / 100);
        if (v === prev && ((isUp && prev >= max) || (!isUp && prev <= min))) {
            triggerEndpointFlash(origRow.id);
        }
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
            else triggerEndpointFlash(origRow.id);
            origRow.value = String(origRow.options[currentIdx]);
        } else {
            if (currentIdx > 0) currentIdx--;
            else triggerEndpointFlash(origRow.id);
            origRow.value = String(origRow.options[currentIdx]);
        }
        const payload = {};
        if (origRow.id === 'main_row_fan') payload.fan = origRow.value;
        if (origRow.id === 'main_row_sys') payload.sys = origRow.value;
        if (typeof window.updateUI === 'function' && Object.keys(payload).length) window.updateUI(payload);
    }
}

function getMenuRows(data) {
    const rows = (data.widgets || [])
        .filter(w => w.type === 'menu_row')
        .sort((a, b) => (a.lcdRow || 1) - (b.lcdRow || 1));
    if (data.page === 'PROVISIONING_SETUP') return [];
    return rows;
}

function buildLinearFocusMap(menuRows) {
    const map = {};
    for (let i = 0; i < menuRows.length; i++) {
        map[i] = {
            up: (i - 1 + menuRows.length) % menuRows.length,
            down: (i + 1) % menuRows.length
        };
    }
    return map;
}

function getScreenFocusProfile(data, menuRows) {
    const page = data.page;
    const focusMap = buildLinearFocusMap(menuRows);
    // SquareLine-style profile: navigation graph + directional intent per mode/screen.
    if (page === 'SETUP_MENU') {
        return {
            focusMap,
            upDownMovesFocus: true,
            rightBehavior: 'enter-focused',
            leftBehavior: 'navigate-main'
        };
    }
    if (page === 'MAIN_DISPLAY') {
        return {
            focusMap,
            upDownMovesFocus: false,
            rightBehavior: 'advance-focus',
            leftBehavior: 'navigate-setup'
        };
    }
    if (page === 'WIFI_SETTINGS') {
        return {
            focusMap,
            upDownMovesFocus: !window._wifiRowEditMode,
            rightBehavior: 'wifi-edit-or-octet',
            leftBehavior: window._wifiRowEditMode ? 'wifi-exit-edit' : 'navigate-setup'
        };
    }
    return {
        focusMap,
        upDownMovesFocus: false,
        rightBehavior: 'advance-focus',
        leftBehavior: 'navigate-setup'
    };
}

function moveFocusByDirection(focusProfile, focusedIndex, direction) {
    const node = focusProfile.focusMap[focusedIndex];
    if (!node) return focusedIndex;
    return direction === 'up' ? node.up : node.down;
}

function openSetupFocusedRow(menuRows, focusedIndex) {
    const focusedRow = menuRows[focusedIndex];
    if (!focusedRow) return;
    if (focusedRow.id === 'ui_item_rs485') window.navigateTo('settings');
    else if (focusedRow.id === 'ui_item_ethernet') window.navigateTo('ethernet');
    else if (focusedRow.id === 'ui_item_provisioning') window.navigateTo('provisioning');
    else if (focusedRow.id === 'ui_item_clock') window.navigateTo('clock');
    else if (focusedRow.id === 'ui_item_oat') window.navigateTo('oat');
    else if (focusedRow.id === 'ui_item_tbd') window.navigateTo('tbd');
}

function advanceFocusByRight(data, menuRows, focusedIndex) {
    if (!menuRows.length) return focusedIndex;
    const focusedRow = menuRows[focusedIndex];
    if (data.page === 'WIFI_SETTINGS' && focusedRow) {
        if (!window._wifiRowEditMode) {
            window._wifiRowEditMode = true;
            window._ipEditMode = isIpv4RowId(focusedRow.id);
            window._valueEditMode = true;
            if (window._ipEditMode) window._ipEditOctetIndex = 0;
            return focusedIndex;
        }
    }
    // WIFI IPv4 edit mode: Right starts octet edit; then advances octet.
    if (data.page === 'WIFI_SETTINGS' && focusedRow && isIpv4RowId(focusedRow.id)) {
        if (!window._ipEditMode) {
            window._ipEditMode = true;
            window._valueEditMode = true;
            window._ipEditOctetIndex = 0;
            return focusedIndex;
        }
        const currentOctet = Number(window._ipEditOctetIndex || 0);
        window._ipEditOctetIndex = (currentOctet + 1) % 4;
        return focusedIndex;
    }
    if (data.page === 'WIFI_SETTINGS') {
        return focusedIndex;
    }
    window._ipEditMode = false;
    window._ipEditOctetIndex = 0;
    window._valueEditMode = false;
    return (focusedIndex + 1) % menuRows.length;
}

// Combined arrow key handler: handles both menu and redbox movement
function handleArrowKey(e) {
    if (window._isVisualEditMode && e.ctrlKey && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        if (ungroupMainIcons()) renderScreen(window._currentJsonPath);
        return;
    }
    if (window._isVisualEditMode && e.ctrlKey && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        if (regroupMainIcons()) renderScreen(window._currentJsonPath);
        return;
    }

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

    // Setup entry from keyboard is intentionally guarded by Left+Right long press.

    // Immediately update debug panel after key event
    if (typeof updateDebugPanel === 'function') {
        updateDebugPanel(window._currentScreenData);
    }
    const data = window._currentScreenData;
    if (window._isVisualEditMode) {
        const tag = String(e.target?.tagName || '').toLowerCase();
        const isTyping = tag === 'input' || tag === 'textarea' || e.target?.isContentEditable;
        if (!isTyping && (e.key === 'Delete' || e.key === 'Backspace')) {
            e.preventDefault();
            if (typeof window._deleteSelectedLayoutNode === 'function') window._deleteSelectedLayoutNode();
            return;
        }
        if (!isTyping && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
            e.preventDefault();
            if (typeof window._undoLayoutChange === 'function') window._undoLayoutChange();
            return;
        }
    }
    if (!data) return;

    if (data.page === 'PROVISIONING_SETUP') {
        if (handleProvisioningArrowKey(e)) return;
    }

    // Only handle menu navigation on screens with menu rows
    const menuRows = getMenuRows(data);
    if (menuRows.length === 0) {
        return;
    }
    let focusedIndex = typeof window._currentScreenFocus === 'number' ? window._currentScreenFocus : 0;
    focusedIndex = ((focusedIndex % menuRows.length) + menuRows.length) % menuRows.length;
    window._currentScreenFocus = focusedIndex;
    const focusProfile = getScreenFocusProfile(data, menuRows);

    if (data.page === 'SETUP_MENU') {
        // Setup Menu logic: Up/Down moves focus, Right selects, Left goes back
        if (e.key === 'ArrowUp') {
            focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'up');
            window._currentScreenFocus = focusedIndex;
            window._ipEditOctetIndex = 0;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowDown') {
            focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'down');
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
            window._ipEditMode = false;
            window._valueEditMode = false;
            window.navigateTo('main');
            return;
        }
    } else {
        // Home (MAIN_DISPLAY): Right cycles focus SET → FAN → SYS; Left opens setup menu; Up/Down reserved
        if (data.page === 'MAIN_DISPLAY') {
            if (e.key === 'ArrowRight') {
                focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'down');
                window._currentScreenFocus = focusedIndex;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (e.key === 'ArrowLeft') {
                /* Home: Left alone does not open Setup — hold Left+Right ~3s (keypad or keyboard) to enter the top-level menu only. */
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
            if (data.page === 'WIFI_SETTINGS') {
                const focusedRow = menuRows[focusedIndex];
                if (focusedRow) {
                    if (!window._wifiRowEditMode) {
                        window._wifiRowEditMode = true;
                        window._ipEditMode = isIpv4RowId(focusedRow.id);
                        window._valueEditMode = true;
                        if (window._ipEditMode) window._ipEditOctetIndex = 0;
                    } else if (window._ipEditMode && isIpv4RowId(focusedRow.id)) {
                        window._ipEditOctetIndex = (Number(window._ipEditOctetIndex || 0) + 1) % 4;
                    }
                    renderScreen(window._currentJsonPath);
                }
                return;
            }
            focusedIndex = advanceFocusByRight(data, menuRows, focusedIndex);
            window._currentScreenFocus = focusedIndex;
            window._valueEditMode = false;
            renderScreen(window._currentJsonPath);
            return;
        } else if (e.key === 'ArrowLeft') {
            if (data.page === 'WIFI_SETTINGS' && window._wifiRowEditMode) {
                window._wifiRowEditMode = false;
                window._ipEditMode = false;
                window._valueEditMode = false;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (data.page !== 'WIFI_SETTINGS' && window._valueEditMode) {
                window._valueEditMode = false;
                renderScreen(window._currentJsonPath);
                return;
            }
            window._ipEditMode = false;
            window._valueEditMode = false;
            window.navigateTo('setup');
            return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            if (data.page === 'WIFI_SETTINGS' && !window._wifiRowEditMode) {
                if (e.key === 'ArrowUp') {
                    focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'up');
                } else {
                    focusedIndex = moveFocusByDirection(focusProfile, focusedIndex, 'down');
                }
                window._currentScreenFocus = focusedIndex;
                window._ipEditMode = false;
                window._ipEditOctetIndex = 0;
                window._valueEditMode = false;
                renderScreen(window._currentJsonPath);
                return;
            }
            if (data.page !== 'WIFI_SETTINGS') {
                window._valueEditMode = true;
            } else if (window._wifiRowEditMode) {
                window._valueEditMode = true;
            }
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
                    else triggerEndpointFlash(origRow.id);
                    origRow.value = String(origRow.options[currentIdx]);
                } else if (origRow.options.length > 2 && e.key === 'ArrowDown') {
                    if (currentIdx > 0) currentIdx--;
                    else triggerEndpointFlash(origRow.id);
                    origRow.value = String(origRow.options[currentIdx]);
                }
            } else if (origRow.id === 'ui_item_addr') {
                let v = Number(origRow.value) || 1;
                const maxValue = origRow.maxValue || 247;
                const minValue = 1;
                if (e.key === 'ArrowUp') {
                    if (v >= maxValue) triggerEndpointFlash(origRow.id);
                    v = v >= maxValue ? maxValue : v + 1;
                } else if (e.key === 'ArrowDown') {
                    if (v <= minValue) triggerEndpointFlash(origRow.id);
                    v = v <= minValue ? minValue : v - 1;
                }
                origRow.value = v;
            } else if (isIpv4RowId(origRow.id)) {
                if (!window._ipEditMode) {
                    renderScreen(window._currentJsonPath);
                    return;
                }
                let parts = String(origRow.value).split('.').map(Number);
                if (parts.length === 4) {
                    let octetIndex = Number(window._ipEditOctetIndex || 0);
                    if (Number.isNaN(octetIndex) || octetIndex < 0 || octetIndex > 3) octetIndex = 0;
                    const prev = Number(parts[octetIndex]) || 0;
                    let next = prev;
                    if (e.key === 'ArrowUp') {
                        next = Math.min(255, prev + 1);
                        if (prev >= 255) triggerEndpointFlash(origRow.id);
                    } else {
                        next = Math.max(0, prev - 1);
                        if (prev <= 0) triggerEndpointFlash(origRow.id);
                    }
                    parts[octetIndex] = next;
                    origRow.value = parts.join('.');
                }
            }
            renderScreen(window._currentJsonPath);
            return;
        }
    }
    // No action for other keys
}

function handleArrowKeyUp(e) {
    if (e.key === 'ArrowLeft') {
        _leftArrowDown = false;
        clearLeftRightLongPressTimer();
    } else if (e.key === 'ArrowRight') {
        _rightArrowDown = false;
        clearLeftRightLongPressTimer();
    }
}

function bindKeyboardHandlersOnce() {
    if (window._tstatKeyboardHandlersBound) return;
    window._tstatKeyboardHandlersBound = true;
    window.addEventListener('keydown', handleArrowKey);
    window.addEventListener('keyup', handleArrowKeyUp);
    window.addEventListener('tstat-lr-menu-longpress', () => performMainDisplayEnterSetupMenu());
    window.addEventListener('blur', () => {
        _leftArrowDown = false;
        _rightArrowDown = false;
        clearLeftRightLongPressTimer();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        // Restore last edited/visited screen on refresh.
        const startupPath = loadLastScreenPath() || './main_display.json';
        window._currentScreenData = null;
        window._lastLoadedJsonPath = null;
        window._currentJsonPath = startupPath;
        window._currentScreenFocus = 0;
        renderScreen(startupPath);
        bindKeyboardHandlersOnce();
    });
} else {
    const startupPath = loadLastScreenPath() || './main_display.json';
    window._currentScreenData = null;
    window._lastLoadedJsonPath = null;
    window._currentJsonPath = startupPath;
    window._currentScreenFocus = 0;
    renderScreen(startupPath);
    bindKeyboardHandlersOnce();
}
