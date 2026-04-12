import {
    TSTAT10_LCD_WIDTH,
    TSTAT10_LCD_HEIGHT,
    TSTAT10_FW_BG_CSS,
    TSTAT10_FW_HIGHLIGHT_CSS,
    TSTAT10_MENU_ROW_PX_DEFAULT
} from './tstat10-firmware-display.js';

export function ensureCanonicalSchema(data) {
    if (!data || typeof data !== 'object') return data;

    data.schemaVersion = data.schemaVersion || '1.0.0';
    data.canvasProfile = data.canvasProfile || {};
    data.colorProfile = data.colorProfile || {};
    data.compatibility = data.compatibility || {};

    const legacyCanvas =
        data.layout?.canvas ||
        data.layout?.lcdCanvas ||
        {};

    const width = Number(data.canvasProfile.width || legacyCanvas.width || TSTAT10_LCD_WIDTH);
    const height = Number(data.canvasProfile.height || legacyCanvas.height || TSTAT10_LCD_HEIGHT);
    let orientation = data.canvasProfile.orientation;
    if (orientation !== 'vertical' && orientation !== 'horizontal') {
        orientation = height >= width ? 'vertical' : 'horizontal';
    }

    data.canvasProfile.width = width;
    data.canvasProfile.height = height;
    data.canvasProfile.orientation = orientation;

    data.canvasProfile.previewOffsetX = Number(data.canvasProfile.previewOffsetX) || 0;
    data.canvasProfile.previewOffsetY = Number(data.canvasProfile.previewOffsetY) || 0;

    /** Target LCD preset id from Screen inspector (lcd-platform-presets.js); optional. */
    if (typeof data.canvasProfile.lcdPresetId === 'string' && data.canvasProfile.lcdPresetId.trim()) {
        data.canvasProfile.lcdPresetId = data.canvasProfile.lcdPresetId.trim();
    }

    data.colorProfile.mode = data.colorProfile.mode || 'indexed';
    data.colorProfile.themeTokens = data.colorProfile.themeTokens || {
        bg: data.styles?.bg || TSTAT10_FW_BG_CSS,
        text: '#ffffff',
        accent: data.styles?.highlight || TSTAT10_FW_HIGHLIGHT_CSS
    };

    data.layout = data.layout || {};
    data.layout.canvas = { width, height };
    data.layout.lcdCanvas = { width, height };
    data.layout.orientation = orientation;

    /** Last dimensions used when widget coordinates were scaled (simulator Apply layout). */
    if (data.canvasProfile.remapBaselineWidth == null || data.canvasProfile.remapBaselineHeight == null) {
        data.canvasProfile.remapBaselineWidth = width;
        data.canvasProfile.remapBaselineHeight = height;
    }

    data.compatibility.targets = Array.isArray(data.compatibility.targets)
        ? data.compatibility.targets
        : ['tstat10'];

    if (typeof data.compatibility.lcdDriver === 'string') {
        data.compatibility.lcdDriver = data.compatibility.lcdDriver.trim();
    }

    return data;
}

/**
 * Scale widget geometry from remap baseline canvas to current canvasProfile (uniform sx/sy).
 * Call after changing LCD preset / size so coordinates match the new hardware. Updates baseline when done.
 */
export function applyLayoutRemapToMatchCanvas(data) {
    if (!data?.canvasProfile) return { ok: false, message: 'No canvas profile.' };
    const w0 = Number(data.canvasProfile.remapBaselineWidth);
    const h0 = Number(data.canvasProfile.remapBaselineHeight);
    const w1 = Number(data.canvasProfile.width);
    const h1 = Number(data.canvasProfile.height);
    if (!Number.isFinite(w0) || !Number.isFinite(h0) || w0 < 8 || h0 < 8) {
        return { ok: false, message: 'Invalid remap baseline; reload screen or set width/height.' };
    }
    if (!Number.isFinite(w1) || !Number.isFinite(h1) || w1 < 8 || h1 < 8) {
        return { ok: false, message: 'Invalid target canvas size.' };
    }
    const sx = w1 / w0;
    const sy = h1 / h0;
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return { ok: false, message: 'Invalid scale.' };

    const scaleNum = (v, s, minVal = 0) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return v;
        return Math.max(minVal, Math.round(n * s));
    };

    const scaleBox = (box) => {
        if (!box || typeof box !== 'object') return;
        for (const k of ['x', 'width']) {
            if (typeof box[k] === 'number') box[k] = scaleNum(box[k], sx, k === 'width' ? 1 : 0);
        }
        for (const k of ['y', 'height']) {
            if (typeof box[k] === 'number') box[k] = scaleNum(box[k], sy, k === 'height' ? 1 : 0);
        }
    };

    const scaleInlinePxInHtml = (html) => {
        if (typeof html !== 'string' || !html.includes('px')) return html;
        const s = Math.min(sx, sy);
        return html.replace(/(\d+(\.\d+)?)px/gi, (_, n) => `${Math.max(4, Math.round(parseFloat(n) * s))}px`);
    };

    const layout = data.layout || (data.layout = {});
    const rowDefault = Number(layout.menuRowPixelHeight) || TSTAT10_MENU_ROW_PX_DEFAULT;

    if (layout.labelColumn && typeof layout.labelColumn.width === 'number') {
        layout.labelColumn.width = scaleNum(layout.labelColumn.width, sx, 1);
    }
    if (layout.valueColumn && typeof layout.valueColumn.width === 'number') {
        layout.valueColumn.width = scaleNum(layout.valueColumn.width, sx, 1);
    }
    if (typeof layout.rowLeftPadding === 'number') layout.rowLeftPadding = scaleNum(layout.rowLeftPadding, sx, 0);
    if (typeof layout.valueBoxLeftPadding === 'number') {
        layout.valueBoxLeftPadding = scaleNum(layout.valueBoxLeftPadding, sx, 0);
    }
    if (typeof layout.valueBoxRightPadding === 'number') {
        layout.valueBoxRightPadding = scaleNum(layout.valueBoxRightPadding, sx, 0);
    }
    for (const k of [
        'menuRowLeftPadding',
        'labelBoxLeftPadding',
        'labelBoxRightPadding',
        'footerTopPadding',
        'footerBottomPadding',
        'buttonGap'
    ]) {
        if (typeof layout[k] === 'number') layout[k] = scaleNum(layout[k], sx, 0);
    }
    if (typeof layout.menuRowVerticalGap === 'number') {
        layout.menuRowVerticalGap = scaleNum(layout.menuRowVerticalGap, sy, 0);
    }

    scaleBox(layout.footerLayout);
    scaleBox(layout.headerLayout);
    scaleBox(layout.labelColumnLayout);
    scaleBox(layout.valueColumnLayout);

    layout.menuRowPixelHeight = scaleNum(rowDefault, sy, 8);
    if (typeof layout.menuRowGap === 'number') layout.menuRowGap = scaleNum(layout.menuRowGap, sy, 0);

    const widgets = data.widgets;
    if (Array.isArray(widgets)) {
        for (const w of widgets) {
            if (!w || typeof w !== 'object') continue;
            if (typeof w.x === 'number') w.x = scaleNum(w.x, sx, 0);
            if (typeof w.y === 'number') w.y = scaleNum(w.y, sy, 0);
            if (typeof w.width === 'number') w.width = scaleNum(w.width, sx, 1);
            if (typeof w.height === 'number') w.height = scaleNum(w.height, sy, 1);
            if (typeof w.labelWidth === 'number') w.labelWidth = scaleNum(w.labelWidth, sx, 1);
            if (typeof w.valueWidth === 'number') w.valueWidth = scaleNum(w.valueWidth, sx, 1);
            if (typeof w.valueX === 'number') w.valueX = scaleNum(w.valueX, sx, 0);
            if (typeof w.fontSize === 'number') w.fontSize = scaleNum(w.fontSize, Math.min(sx, sy), 6);
            if (typeof w.font === 'string' && /\d+(\.\d+)?px/.test(w.font)) {
                w.font = w.font.replace(/(\d+(\.\d+)?)px/g, (_, n) => {
                    const px = Math.max(8, Math.round(parseFloat(n) * Math.min(sx, sy)));
                    return `${px}px`;
                });
            }
            if (w.type === 'label' && typeof w.text === 'string' && w.text.includes('px')) {
                w.text = scaleInlinePxInHtml(w.text);
            }
        }
    }

    data.canvasProfile.remapBaselineWidth = w1;
    data.canvasProfile.remapBaselineHeight = h1;
    ensureCanonicalSchema(data);
    return {
        ok: true,
        message: `Layout remapped ${Math.round(w0)}×${Math.round(h0)} → ${Math.round(w1)}×${Math.round(h1)}. Check for off-screen widgets.`
    };
}

export function validateLayoutData(data) {
    const errors = [];
    const warnings = [];

    const width = Number(data?.canvasProfile?.width || 0);
    const height = Number(data?.canvasProfile?.height || 0);
    const orientation = data?.canvasProfile?.orientation;
    const mode = data?.colorProfile?.mode;
    const widgets = Array.isArray(data?.widgets) ? data.widgets : [];

    if (!Number.isInteger(width) || width <= 0) errors.push('Canvas width must be a positive integer.');
    if (!Number.isInteger(height) || height <= 0) errors.push('Canvas height must be a positive integer.');
    if (orientation !== 'vertical' && orientation !== 'horizontal') {
        errors.push('Orientation must be vertical or horizontal.');
    }

    if (!['indexed', 'reduced_rgb'].includes(mode)) {
        errors.push('Color mode must be indexed or reduced_rgb.');
    }

    if (width * height > 250000) {
        warnings.push('Canvas area is large for Tstat10 and may not be deploy-safe.');
    }

    if (widgets.length > 80) {
        warnings.push('Widget count exceeds recommended Tstat10 phase-1 budget.');
    }

    return {
        valid: errors.length === 0,
        target: 'tstat10',
        errors,
        warnings,
        infos: []
    };
}

export function writeStatus(message, isError = false) {
    const line = document.getElementById('tstat-status-line');
    if (!line) return;
    line.textContent = message;
    line.style.background = isError ? '#6a1b1b' : '#222';
}

const FLOATING_PANEL_POS_PREFIX = 'tstat_floating_panel_pos:';

function restoreFloatingPanelPosition(panel) {
    if (!panel || !panel.id) return;
    try {
        const raw = localStorage.getItem(FLOATING_PANEL_POS_PREFIX + panel.id);
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p.left === 'string' && p.left) panel.style.left = p.left;
        if (typeof p.top === 'string' && p.top) panel.style.top = p.top;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';
    } catch {
        /* ignore */
    }
}

function persistFloatingPanelPosition(panel) {
    if (!panel || !panel.id) return;
    try {
        localStorage.setItem(
            FLOATING_PANEL_POS_PREFIX + panel.id,
            JSON.stringify({ left: panel.style.left || '', top: panel.style.top || '' })
        );
    } catch {
        /* ignore */
    }
}

/**
 * Drag a position:fixed panel by its header/handle (SquareLine-style floating panels).
 */
export function attachFloatingPanelDrag(panel, handle, options = {}) {
    if (!panel || !handle || handle._floatingDragBound) return;
    handle._floatingDragBound = true;
    handle.style.cursor = 'grab';
    const minTop = typeof options.minTop === 'number' ? options.minTop : 0;
    restoreFloatingPanelPosition(panel);

    const onPointerDown = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        const cs = getComputedStyle(panel);
        if (cs.position !== 'fixed') return;
        const rect = panel.getBoundingClientRect();
        const startX = e.touches ? e.touches[0].clientX : e.clientX;
        const startY = e.touches ? e.touches[0].clientY : e.clientY;
        const startLeft = rect.left;
        const startTop = rect.top;
        e.preventDefault();
        handle.style.cursor = 'grabbing';
        let movedPx = 0;

        const onMove = (clientX, clientY) => {
            const dx = clientX - startX;
            const dy = clientY - startY;
            movedPx = Math.max(movedPx, Math.abs(dx), Math.abs(dy));
            let left = startLeft + dx;
            let top = startTop + dy;
            top = Math.max(minTop, top);
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
        };
        const onUp = () => {
            handle.style.cursor = 'grab';
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onTouchMove);
            document.removeEventListener('touchend', onUp);
            if (movedPx >= 2) persistFloatingPanelPosition(panel);
        };
        const onMouseMove = (ev) => onMove(ev.clientX, ev.clientY);
        const onTouchMove = (ev) => {
            if (ev.touches.length !== 1) return;
            ev.preventDefault();
            onMove(ev.touches[0].clientX, ev.touches[0].clientY);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onUp);
        document.addEventListener('touchmove', onTouchMove, { passive: false });
        document.addEventListener('touchend', onUp);
    };

    handle.addEventListener('mousedown', onPointerDown);
    handle.addEventListener('touchstart', onPointerDown, { passive: false });
}

/** Widget types/ids that may have child widgets linked via parentId. */
export function widgetAcceptsChildren(w) {
    if (!w) return false;
    const id = w.id;
    if (typeof id !== 'string' || id.length === 0) return false;
    if (id === 'main_icons_group') return true;
    if (w.type === 'box' || w.type === 'panel') return true;
    return false;
}

/**
 * True if the widget at descendantIdx is under ancestorIdx in the parentId tree.
 */
export function isWidgetDescendantOf(widgets, descendantIdx, ancestorIdx) {
    if (!Array.isArray(widgets) || descendantIdx < 0 || ancestorIdx < 0) return false;
    if (descendantIdx === ancestorIdx) return false;
    const byId = new Map();
    widgets.forEach((w, i) => {
        if (w && w.id) byId.set(w.id, i);
    });
    let cur = widgets[descendantIdx];
    const seen = new Set();
    let guard = 0;
    while (cur && guard++ < 256) {
        const pid = cur.parentId;
        if (pid == null || pid === '') return false;
        const pi = byId.get(pid);
        if (pi === undefined) return false;
        if (pi === ancestorIdx) return true;
        if (seen.has(pi)) return false;
        seen.add(pi);
        cur = widgets[pi];
    }
    return false;
}

/**
 * Reorder widgets so parents appear before children (stable for parentId export).
 */
export function normalizeWidgetTreeOrder(widgets) {
    if (!Array.isArray(widgets) || widgets.length < 2) return;
    const indexById = new Map();
    widgets.forEach((w, i) => {
        if (w && w.id) indexById.set(w.id, i);
    });
    const depthAt = (i) => {
        let d = 0;
        let cur = widgets[i];
        const seen = new Set();
        while (cur && d < 256) {
            const pid = cur.parentId;
            if (pid == null || pid === '') break;
            const pi = indexById.get(pid);
            if (pi === undefined || seen.has(pi)) break;
            seen.add(pi);
            d++;
            cur = widgets[pi];
        }
        return d;
    };
    const indices = widgets.map((_, i) => i);
    indices.sort((a, b) => depthAt(a) - depthAt(b) || a - b);
    const copy = indices.map((i) => widgets[i]);
    widgets.splice(0, widgets.length, ...copy);
}
