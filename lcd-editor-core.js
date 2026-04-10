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

    const width = Number(data.canvasProfile.width || legacyCanvas.width || 320);
    const height = Number(data.canvasProfile.height || legacyCanvas.height || 480);
    const orientation = data.canvasProfile.orientation || (height >= width ? 'vertical' : 'horizontal');

    data.canvasProfile.width = width;
    data.canvasProfile.height = height;
    data.canvasProfile.orientation = orientation;

    data.colorProfile.mode = data.colorProfile.mode || 'indexed';
    data.colorProfile.themeTokens = data.colorProfile.themeTokens || {
        bg: data.styles?.bg || '#2c7cc4',
        text: '#ffffff',
        accent: data.styles?.highlight || '#008080'
    };

    data.layout = data.layout || {};
    data.layout.canvas = { width, height };
    data.layout.lcdCanvas = { width, height };
    data.layout.orientation = orientation;

    data.compatibility.targets = Array.isArray(data.compatibility.targets)
        ? data.compatibility.targets
        : ['tstat10'];

    return data;
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

/**
 * Drag a position:fixed panel by its header/handle (SquareLine-style floating panels).
 */
export function attachFloatingPanelDrag(panel, handle, options = {}) {
    if (!panel || !handle || handle._floatingDragBound) return;
    handle._floatingDragBound = true;
    handle.style.cursor = 'grab';
    const minTop = typeof options.minTop === 'number' ? options.minTop : 0;

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

        const onMove = (clientX, clientY) => {
            const dx = clientX - startX;
            const dy = clientY - startY;
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
