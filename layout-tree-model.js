/**
 * Hierarchy tree model: widget display names, row typing, shell nodes, and flat page node list.
 * Split from network-settings-renderer.js.
 */

export function resolveMenuRowLabel(widget) {
    const base = String(widget?.label || '');
    const custom = String(widget?.labelCustom ?? base);
    const mode = String(widget?.labelDisplayMode || '').toLowerCase();
    if (mode === 'none') return '';
    if (mode === '8char') return custom.slice(0, 8);
    if (mode === '20char') return custom.slice(0, 20);
    if (mode === 'custom') return custom;
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
        ui_item_prov_ap: 'AP',
        ui_item_prov_pwd: 'Provisioning Password',
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

export function getWidgetTreeName(widget) {
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

/** Menu/blank rows share lcdRow vertical slots; label/header use canvas x/y (not row slots). */
export function isRowSlotWidget(w) {
    return !!w && (w.type === 'menu_row' || w.type === 'blank');
}

export function isLabelLikeLayoutWidget(w) {
    return !!w && (w.type === 'label' || w.type === 'header');
}

/** CSS modifier classes for SquareLine-style hierarchy row / icon chip appearance. */
export function getLayoutTreeNodeLayoutClasses(n) {
    const parts = [];
    const w = n.widget;
    if (n.childKind === 'widget' && w && typeof w.type === 'string') {
        const t = w.type.replace(/[^a-z0-9_-]/gi, '');
        if (t) parts.push(`layout-tree-node--wtype-${t}`);
    }
    if (n.childKind === 'label') parts.push('layout-tree-node--part-label');
    else if (n.childKind === 'value') parts.push('layout-tree-node--part-value');
    else if (n.childKind === 'group_icon') parts.push('layout-tree-node--part-icon');
    else if (n.childKind === 'lcd_outline') parts.push('layout-tree-node--lcd-outline');
    else if (n.childKind === 'shell_hw_group') parts.push('layout-tree-node--shell-hw-group');
    else if (n.childKind === 'shell_hw_button') parts.push('layout-tree-node--shell-hw-btn');
    else if (n.childKind === 'shell_ref_photo') parts.push('layout-tree-node--shell-ref-photo');
    else if (n.childKind === 'tstat_body_folder') parts.push('layout-tree-node--tstat-body-folder');
    else if (n.childKind === 'shell_bezel') parts.push('layout-tree-node--shell-bezel');
    else if (n.childKind === 'shell_compass_logo') parts.push('layout-tree-node--shell-compass');
    else if (n.childKind === 'shell_lock_control') parts.push('layout-tree-node--shell-lock');
    return parts.join(' ');
}

/**
 * Reorder drops (tree or LCD): only swap/move among peers — rows↔rows, labels/headers↔labels/headers,
 * otherwise same widget type only (no dropping a row onto a label or mixing unrelated types).
 */
export function layoutDropTargetsSameHierarchy(fromW, toW) {
    if (!fromW || !toW || fromW === toW) return false;
    if (isRowSlotWidget(fromW) && isRowSlotWidget(toW)) return true;
    if (isLabelLikeLayoutWidget(fromW) && isLabelLikeLayoutWidget(toW)) return true;
    if (isRowSlotWidget(fromW) || isLabelLikeLayoutWidget(fromW)) return false;
    if (isRowSlotWidget(toW) || isLabelLikeLayoutWidget(toW)) return false;
    return fromW.type === toW.type;
}

export function normalizeLcdRowSlot(n) {
    const r = Math.round(Number(n));
    return Number.isFinite(r) && r > 0 ? r : 1;
}

/**
 * True when the LCD/hierarchy selection refers to the same widget index as `nodeId`.
 * Lets row `w-3`, `w-3-label`, and `w-3-value` all act as one selection for resize/drag handles.
 * Does not match `w-3-icon-*` to value/label (different subtree).
 */
export function layoutTreeSelectionMatchesNode(selectedId, nodeId) {
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

/** Widget array index for any hierarchy row id: `w-3`, `w-3-label`, `w-3-value`, `w-3-icon-day_night`, … */
export function parseWidgetIndexFromLayoutTreeNodeId(id) {
    const m = String(id || '').match(/^w-(\d+)/);
    return m ? Number(m[1]) : -1;
}

/** Fixed shell DOM in `Tstat10.html`; tree ids match `data-tree-node-id` (not screen JSON widgets). */
const SHELL_REFERENCE_PHOTO_TREE_ID = 'shell-ref-photo';
const SHELL_HARDWARE_GROUP_TREE_ID = 'shell-hardware-buttons';
const TSTAT_BODY_FOLDER_ID = 'tstat-body';
const SHELL_HARDWARE_BUTTON_ROWS = [
    { treeId: 'shell-hw-left', role: 'left', label: '◀ Left', mapsTo: 'ArrowLeft' },
    { treeId: 'shell-hw-down', role: 'down', label: '▼ Down', mapsTo: 'ArrowDown' },
    { treeId: 'shell-hw-up', role: 'up', label: '▲ Up', mapsTo: 'ArrowUp' },
    { treeId: 'shell-hw-right', role: 'right', label: '▶ Right', mapsTo: 'ArrowRight' }
];

/** Device chrome only — shown once under **Tstatbody** in the hierarchy (not duplicated per screen JSON). */
export function buildTstatShellTreeNodes() {
    const nodes = [];
    nodes.push({
        id: TSTAT_BODY_FOLDER_ID,
        text: 'Tstatbody',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 6h6M5 9h4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 0,
        childKind: 'tstat_body_folder'
    });
    nodes.push({
        id: 'shell-device-bezel',
        text: 'Device bezel',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="2.5" width="12" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/><rect x="4.5" y="5" width="7" height="6" rx="0.8" fill="currentColor" opacity=".2"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_bezel'
    });
    nodes.push({
        id: 'lcd-outline',
        text: 'LCD outline (viewport)',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="3" width="11" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M5 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'lcd_outline'
    });
    nodes.push({
        id: 'shell-compass-logo',
        text: 'Compass / logo artwork',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 3v2M8 11v2M3 8h2M11 8h2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_compass_logo'
    });
    nodes.push({
        id: SHELL_HARDWARE_GROUP_TREE_ID,
        text: 'Hardware buttons (simulated)',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="6" width="3.2" height="5" rx="0.5" fill="currentColor" opacity=".45"/><rect x="6.4" y="6" width="3.2" height="5" rx="0.5" fill="currentColor" opacity=".45"/><rect x="11.3" y="6" width="3.2" height="5" rx="0.5" fill="currentColor" opacity=".45"/><path d="M8 2.5v2.5M8 11v2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_hw_group'
    });
    SHELL_HARDWARE_BUTTON_ROWS.forEach((row) => {
        nodes.push({
            id: row.treeId,
            text: `Key :: ${row.label} → ${row.mapsTo}`,
            icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M8 6v4M6 8h4" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>',
            status: 'ok',
            widget: null,
            indent: 2,
            childKind: 'shell_hw_button',
            shellHwRole: row.role
        });
    });
    nodes.push({
        id: SHELL_REFERENCE_PHOTO_TREE_ID,
        text: 'Thermostat reference image',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="12" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="5.5" cy="6.5" r="1.2" fill="currentColor" opacity=".35"/><path d="M9 9l4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_ref_photo'
    });
    nodes.push({
        id: 'shell-lock-control',
        text: 'Layout lock (bezel)',
        icon: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="7" width="8" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M6 7V5a2 2 0 0 1 4 0v2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
        status: 'ok',
        widget: null,
        indent: 1,
        childKind: 'shell_lock_control'
    });
    return nodes;
}

/** Screen JSON widgets only (LCD content). Shell chrome lives in `buildTstatShellTreeNodes`. */
export function buildPageNodes(data) {
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

export function findLayoutTreeNodeById(id, data) {
    if (!id) return null;
    const shellHit = buildTstatShellTreeNodes().find((n) => n.id === id);
    if (shellHit) return shellHit;
    return buildPageNodes(data).find((n) => n.id === id);
}
