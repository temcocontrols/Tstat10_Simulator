// Handles physical button bridging and reference photo toggling
function sendHwKey(key) {
    console.log("Physical Button Pressed:", key);
    // Dispatch corresponding Arrow key event for menu navigation
    let arrowKey = null;
    if (key === 'UP') arrowKey = 'ArrowUp';
    if (key === 'DOWN') arrowKey = 'ArrowDown';
    if (key === 'LEFT') arrowKey = 'ArrowLeft';
    if (key === 'RIGHT') arrowKey = 'ArrowRight';
    if (arrowKey) {
        const codeMap = { ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
        const event = new KeyboardEvent('keydown', {
            key: arrowKey,
            code: codeMap[arrowKey] || arrowKey,
            bubbles: true,
            cancelable: true
        });
        window.dispatchEvent(event);
    }
}

// Paste your Base64 image data below (as data URIs)
const Tstat10_5_BASE64 = '';
const Tstat10_2_BASE64 = '';

const SHELL_REF_PHOTO_LS = 'tstat10_shell_ref_photo_v1';

function persistShellRefPhoto() {
    const img = document.getElementById('ref-photo');
    if (!img) return;
    try {
        localStorage.setItem(
            SHELL_REF_PHOTO_LS,
            JSON.stringify({
                visible: img.style.display !== 'none',
                opacity: parseFloat(img.style.opacity),
                src: img.src || ''
            })
        );
    } catch (_) {}
}

function restoreShellRefPhoto() {
    try {
        const raw = localStorage.getItem(SHELL_REF_PHOTO_LS);
        if (!raw) return;
        const o = JSON.parse(raw);
        const img = document.getElementById('ref-photo');
        if (!img || !o) return;
        if (typeof o.opacity === 'number' && !Number.isNaN(o.opacity)) {
            img.style.opacity = String(Math.min(1, Math.max(0, o.opacity)));
        }
        if (typeof o.src === 'string' && o.src.length) img.src = o.src;
        if (o.visible) {
            img.style.display = 'block';
            img.classList.add('ref-photo--visible');
        }
    } catch (_) {}
}

function toggleRef(base64Data) {
    const img = document.getElementById('ref-photo');
    if (!img) return;
    img.src = base64Data;
    img.style.display = 'block';
    img.classList.add('ref-photo--visible');
    persistShellRefPhoto();
}

function hideRefPhoto() {
    const img = document.getElementById('ref-photo');
    if (!img) return;
    img.style.display = 'none';
    img.classList.remove('ref-photo--visible');
    persistShellRefPhoto();
}

document.addEventListener('DOMContentLoaded', function() {
    const showMainPhotoBtn = document.getElementById('show-main-photo');
    const showSettingsPhotoBtn = document.getElementById('show-settings-photo');
    const hidePhotoBtn = document.getElementById('hide-photo');

    if (showMainPhotoBtn) {
        showMainPhotoBtn.addEventListener('click', function() {
            toggleRef(Tstat10_5_BASE64);
        });
    }
    if (showSettingsPhotoBtn) {
        showSettingsPhotoBtn.addEventListener('click', function() {
            toggleRef(Tstat10_2_BASE64);
        });
    }
    if (hidePhotoBtn) {
        hidePhotoBtn.addEventListener('click', hideRefPhoto);
    }

    restoreShellRefPhoto();
    window._persistShellRefPhoto = persistShellRefPhoto;
    window._hideShellRefPhoto = hideRefPhoto;

    // Hardware button event listeners with Left+Right Long Press detection
    let leftDown = false;
    let rightDown = false;
    let longPressTimer = null;
    let skipNextClick = false;
    let upDownRepeatTimer = null;
    let upDownRepeatCount = 0;
    let skipUpClick = false;
    let skipDownClick = false;

    function clearUpDownRepeat() {
        if (upDownRepeatTimer) {
            clearTimeout(upDownRepeatTimer);
            upDownRepeatTimer = null;
        }
        upDownRepeatCount = 0;
    }

    function getRepeatDelayMs(step) {
        // Starts slow, ramps to fast while held.
        if (step < 3) return 380;
        if (step < 7) return 240;
        if (step < 12) return 150;
        return 90;
    }

    function startUpDownRepeat(keyName) {
        clearUpDownRepeat();
        if (keyName === 'UP') skipUpClick = true;
        if (keyName === 'DOWN') skipDownClick = true;
        sendHwKey(keyName); // first step immediately
        const tick = () => {
            upDownRepeatCount += 1;
            sendHwKey(keyName);
            upDownRepeatTimer = setTimeout(tick, getRepeatDelayMs(upDownRepeatCount));
        };
        upDownRepeatTimer = setTimeout(tick, getRepeatDelayMs(0));
    }

    const LR_MENU_HOLD_MS = 3000;

    function checkLongPress() {
        if (leftDown && rightDown) {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
            longPressTimer = setTimeout(() => {
                longPressTimer = null;
                console.log('Simultaneous Left+Right long press: open Setup menu (home only)');
                skipNextClick = true;
                window.dispatchEvent(new CustomEvent('tstat-lr-menu-longpress', { bubbles: true }));
            }, LR_MENU_HOLD_MS);
        } else {
            if (longPressTimer) {
                clearTimeout(longPressTimer);
                longPressTimer = null;
            }
        }
    }

    const btnLeft = document.getElementById('hw-btn-left');
    const btnRight = document.getElementById('hw-btn-right');

    ['mousedown', 'touchstart'].forEach(evt => {
        btnLeft.addEventListener(evt, () => { leftDown = true; skipNextClick = false; checkLongPress(); });
        btnRight.addEventListener(evt, () => { rightDown = true; skipNextClick = false; checkLongPress(); });
    });
    ['mouseup', 'mouseleave', 'touchend'].forEach(evt => {
        btnLeft.addEventListener(evt, () => { leftDown = false; checkLongPress(); });
        btnRight.addEventListener(evt, () => { rightDown = false; checkLongPress(); });
    });

    btnLeft.addEventListener('click', function() {
        if (!skipNextClick) sendHwKey('LEFT');
    });
    btnRight.addEventListener('click', function() {
        if (!skipNextClick) sendHwKey('RIGHT');
    });

    const btnDown = document.getElementById('hw-btn-down');
    const btnUp = document.getElementById('hw-btn-up');
    if (btnDown) {
        ['mousedown', 'touchstart'].forEach(evt => {
            btnDown.addEventListener(evt, () => startUpDownRepeat('DOWN'));
        });
        ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => {
            btnDown.addEventListener(evt, () => {
                clearUpDownRepeat();
                setTimeout(() => { skipDownClick = false; }, 0);
            });
        });
        btnDown.addEventListener('click', function() {
            if (!skipDownClick) sendHwKey('DOWN');
        });
    }
    if (btnUp) {
        ['mousedown', 'touchstart'].forEach(evt => {
            btnUp.addEventListener(evt, () => startUpDownRepeat('UP'));
        });
        ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(evt => {
            btnUp.addEventListener(evt, () => {
                clearUpDownRepeat();
                setTimeout(() => { skipUpClick = false; }, 0);
            });
        });
        btnUp.addEventListener('click', function() {
            if (!skipUpClick) sendHwKey('UP');
        });
    }

    // SquareLine-style editable view: zoom (+/−, wheel, Ctrl+Plus/Minus/0), pan, fit.
    const tstatContainer = document.getElementById('tstat-container');
    const deviceBezel = document.querySelector('#tstat-container .device-bezel');
    if (tstatContainer && deviceBezel) {
        const ZOOM_MIN = 0.25;
        const ZOOM_MAX = 4;
        const WHEEL_STEP = 0.05;
        const BTN_FACTOR = 1.12;

        let zoom = Number(window._tstatZoom || 1);
        if (typeof window._tstatPanX !== 'number') window._tstatPanX = 0;
        if (typeof window._tstatPanY !== 'number') window._tstatPanY = 0;

        const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));

        const PANEL_ZOOM_IDS = ['layout-widgets-panel', 'layout-tree-panel', 'layout-props-panel'];

        const applyTstatViewTransform = () => {
            zoom = clampZoom(zoom);
            const px = Number(window._tstatPanX || 0);
            const py = Number(window._tstatPanY || 0);
            const tf = `translate(${px}px, ${py}px) scale(${zoom})`;
            window._tstatZoom = zoom;
            const inEditShell = document.body.classList.contains('visual-edit-shell');
            const applyTf = (el) => {
                if (!el) return;
                el.style.transformOrigin = 'top center';
                el.style.transform = tf;
            };
            applyTf(deviceBezel);
            PANEL_ZOOM_IDS.forEach((id) => {
                const el = document.getElementById(id);
                if (!el) return;
                if (!inEditShell) {
                    el.style.removeProperty('transform');
                    el.style.removeProperty('transform-origin');
                    return;
                }
                applyTf(el);
            });
            const zr = document.getElementById('sls-zoom-readout');
            if (zr) zr.textContent = `${Math.round(zoom * 100)}%`;
            if (typeof window._syncTstatLcdEdgeDragLayer === 'function') window._syncTstatLcdEdgeDragLayer();
        };
        window._applyTstatViewTransform = applyTstatViewTransform;

        const zoomByWheelDelta = (deltaY) => {
            zoom += deltaY < 0 ? WHEEL_STEP : -WHEEL_STEP;
            applyTstatViewTransform();
        };
        const zoomIn = () => {
            zoom = clampZoom(zoom * BTN_FACTOR);
            applyTstatViewTransform();
        };
        const zoomOut = () => {
            zoom = clampZoom(zoom / BTN_FACTOR);
            applyTstatViewTransform();
        };
        const zoomReset100 = () => {
            zoom = 1;
            applyTstatViewTransform();
        };

        const LCD_NUDGE_LS = 'tstat10_lcd_bezel_nudge_px';
        const persistLcdNudge = () => {
            try {
                localStorage.setItem(
                    LCD_NUDGE_LS,
                    JSON.stringify({
                        x: Math.round(Number(window._tstatLcdNudgeX) || 0),
                        y: Math.round(Number(window._tstatLcdNudgeY) || 0)
                    })
                );
            } catch (_) {}
        };
        const loadLcdNudge = () => {
            try {
                const raw = localStorage.getItem(LCD_NUDGE_LS);
                if (!raw) return;
                const o = JSON.parse(raw);
                window._tstatLcdNudgeX = Number(o.x) || 0;
                window._tstatLcdNudgeY = Number(o.y) || 0;
            } catch (_) {
                window._tstatLcdNudgeX = 0;
                window._tstatLcdNudgeY = 0;
            }
        };
        window._applyTstatLcdNudgeTransform = () => {
            const lcd = document.getElementById('tstat-lcd-container');
            if (!lcd) return;
            const nx = Math.round(Number(window._tstatLcdNudgeX) || 0);
            const ny = Math.round(Number(window._tstatLcdNudgeY) || 0);
            window._tstatLcdNudgeX = nx;
            window._tstatLcdNudgeY = ny;
            if (nx === 0 && ny === 0) lcd.style.removeProperty('transform');
            else lcd.style.transform = `translate(${nx}px, ${ny}px)`;
            if (typeof window._syncTstatLcdEdgeDragLayer === 'function') window._syncTstatLcdEdgeDragLayer();
        };
        window._persistTstatLcdNudge = persistLcdNudge;

        window._fitTstatViewport = () => {
            zoom = 1;
            window._tstatPanX = 0;
            window._tstatPanY = 0;
            window._tstatLcdNudgeX = 0;
            window._tstatLcdNudgeY = 0;
            persistLcdNudge();
            applyTstatViewTransform();
            window._applyTstatLcdNudgeTransform();
        };
        window._tstatZoomIn = zoomIn;
        window._tstatZoomOut = zoomOut;

        zoom = clampZoom(zoom);
        applyTstatViewTransform();

        loadLcdNudge();
        window._applyTstatLcdNudgeTransform();

        document.addEventListener(
            'keydown',
            (e) => {
                if (!document.body.classList.contains('visual-edit-shell')) return;
                if (!e.altKey || e.ctrlKey || e.metaKey) return;
                const el = e.target;
                if (
                    el &&
                    ((el.closest && el.closest('input, textarea, select')) || el.isContentEditable)
                ) {
                    return;
                }
                const k = e.key;
                if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) return;
                e.preventDefault();
                e.stopPropagation();
                const step = e.shiftKey ? 8 : 1;
                let dx = 0;
                let dy = 0;
                if (k === 'ArrowLeft') dx = -step;
                else if (k === 'ArrowRight') dx = step;
                else if (k === 'ArrowUp') dy = -step;
                else if (k === 'ArrowDown') dy = step;
                window._tstatLcdNudgeX = (Number(window._tstatLcdNudgeX) || 0) + dx;
                window._tstatLcdNudgeY = (Number(window._tstatLcdNudgeY) || 0) + dy;
                persistLcdNudge();
                window._applyTstatLcdNudgeTransform();
            },
            true
        );

        const fitBtn = document.getElementById('sls-fit-view');
        if (fitBtn) {
            fitBtn.addEventListener('click', () => window._fitTstatViewport());
        }
        document.getElementById('sls-zoom-in')?.addEventListener('click', zoomIn);
        document.getElementById('sls-zoom-out')?.addEventListener('click', zoomOut);
        document.getElementById('sls-zoom-readout')?.addEventListener('click', zoomReset100);

        const wheelZoomOn = (e) => {
            e.preventDefault();
            zoomByWheelDelta(e.deltaY);
        };

        tstatContainer.addEventListener('wheel', wheelZoomOn, { passive: false });

        /** Let wheel scroll overflow areas; otherwise zoom (same as device) so panels shrink/grow with the LCD. */
        const canScrollVertically = (el) => {
            if (!el || el.nodeType !== 1) return false;
            const st = window.getComputedStyle(el);
            const oy = st.overflowY;
            if (oy !== 'auto' && oy !== 'scroll' && oy !== 'overlay') return false;
            return el.scrollHeight > el.clientHeight + 2;
        };
        const wheelInsideScrollable = (target, root) => {
            let el = target;
            while (el && root.contains(el)) {
                if (canScrollVertically(el)) return true;
                el = el.parentElement;
            }
            return false;
        };
        const bindPanelWheelZoom = (panel) => {
            if (!panel || panel._tstatPanelWheelZoomBound) return;
            panel._tstatPanelWheelZoomBound = true;
            panel.addEventListener(
                'wheel',
                (e) => {
                    if (wheelInsideScrollable(e.target, panel)) return;
                    wheelZoomOn(e);
                },
                { passive: false }
            );
        };
        PANEL_ZOOM_IDS.forEach((id) => bindPanelWheelZoom(document.getElementById(id)));

        document.addEventListener(
            'keydown',
            (e) => {
                if (!document.body.classList.contains('visual-edit-shell')) return;
                const el = e.target;
                if (
                    el &&
                    ((el.closest && el.closest('input, textarea, select')) || el.isContentEditable)
                ) {
                    return;
                }
                if (!e.ctrlKey && !e.metaKey) return;
                if (e.key === '=' || e.key === '+') {
                    e.preventDefault();
                    zoomIn();
                } else if (e.key === '-' || e.key === '_') {
                    e.preventDefault();
                    zoomOut();
                } else if (e.key === '0') {
                    e.preventDefault();
                    window._fitTstatViewport();
                }
            },
            true
        );

        let panning = false;
        let panMouseButton = 1;
        let startClientX = 0;
        let startClientY = 0;
        let startPanX = 0;
        let startPanY = 0;

        tstatContainer.addEventListener('mousedown', (e) => {
            const lcd = document.getElementById('tstat-lcd-container');
            // SquareLine-style: pan from empty canvas only while editing; leave simulation clicks untouched.
            if (e.button === 0 && window._isVisualEditMode && lcd && lcd.contains(e.target) && !e.target.closest('[data-tree-node-id]') && !e.target.closest('.debug-grid')) {
                e.preventDefault();
                panning = true;
                panMouseButton = 0;
                startClientX = e.clientX;
                startClientY = e.clientY;
                startPanX = Number(window._tstatPanX || 0);
                startPanY = Number(window._tstatPanY || 0);
                tstatContainer.classList.add('tstat-container--panning-left');
                if (typeof e.pointerId === 'number') {
                    try {
                        tstatContainer.setPointerCapture(e.pointerId);
                    } catch (_) {}
                }
                return;
            }
            if (e.button !== 1) return;
            e.preventDefault();
            panning = true;
            panMouseButton = 1;
            startClientX = e.clientX;
            startClientY = e.clientY;
            startPanX = Number(window._tstatPanX || 0);
            startPanY = Number(window._tstatPanY || 0);
            tstatContainer.classList.add('tstat-container--panning');
            if (typeof e.pointerId === 'number') {
                try {
                    tstatContainer.setPointerCapture(e.pointerId);
                } catch (_) {}
            }
        });

        const onPanMove = (e) => {
            if (!panning) return;
            window._tstatPanX = startPanX + (e.clientX - startClientX);
            window._tstatPanY = startPanY + (e.clientY - startClientY);
            applyTstatViewTransform();
        };
        const endPan = (e) => {
            if (!panning) return;
            if (e && e.type === 'mouseup' && e.button !== panMouseButton) return;
            panning = false;
            tstatContainer.classList.remove('tstat-container--panning', 'tstat-container--panning-left');
            if (typeof e.pointerId === 'number') {
                try {
                    tstatContainer.releasePointerCapture(e.pointerId);
                } catch (_) {}
            }
        };

        document.addEventListener('mousemove', onPanMove);
        document.addEventListener('mouseup', endPan);

        tstatContainer.addEventListener('dblclick', (e) => {
            if (e.button !== 0) return;
            if (!e.altKey) return;
            window._fitTstatViewport();
        });

        const ensureLcdEdgeDragLayer = () => {
            const lcd = document.getElementById('tstat-lcd-container');
            if (!lcd || !deviceBezel) return null;
            let layer = document.getElementById('tstat-lcd-edge-layer');
            if (!layer) {
                layer = document.createElement('div');
                layer.id = 'tstat-lcd-edge-layer';
                layer.className = 'tstat-lcd-edge-layer';
                layer.setAttribute('data-tree-node-id', 'lcd-outline');
                layer.setAttribute('aria-hidden', 'true');
                ['n', 's', 'e', 'w'].forEach((edge) => {
                    const strip = document.createElement('div');
                    strip.className = `tstat-lcd-edge-strip tstat-lcd-edge-strip--${edge}`;
                    strip.dataset.lcdEdge = edge;
                    layer.appendChild(strip);
                });
                deviceBezel.insertBefore(layer, lcd.nextSibling);
                layer.addEventListener('pointerdown', (e) => {
                    const strip = e.target.closest?.('[data-lcd-edge]');
                    if (!strip || !layer.contains(strip)) return;
                    if (!window._isVisualEditMode || !document.body.classList.contains('visual-edit-shell')) return;
                    if (e.button !== 0) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof window._selectLayoutNode === 'function') window._selectLayoutNode('lcd-outline');
                    else window._layoutSelectedNodeId = 'lcd-outline';
                    lcdOutlineDrag = {
                        pointerId: e.pointerId,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        startNx: Number(window._tstatLcdNudgeX) || 0,
                        startNy: Number(window._tstatLcdNudgeY) || 0
                    };
                    try {
                        layer.setPointerCapture(e.pointerId);
                    } catch (_) {}
                });
            }
            return layer;
        };

        let lcdOutlineDrag = null;

        const syncTstatLcdEdgeDragLayer = () => {
            const layer = ensureLcdEdgeDragLayer();
            const lcd = document.getElementById('tstat-lcd-container');
            if (!layer || !lcd) return;
            const edit = document.body.classList.contains('visual-edit-shell') && window._isVisualEditMode;
            if (!edit) {
                layer.style.display = 'none';
                return;
            }
            layer.style.display = 'block';
            const z = Number(window._tstatZoom || 1) || 1;
            const br = deviceBezel.getBoundingClientRect();
            const lr = lcd.getBoundingClientRect();
            layer.style.position = 'absolute';
            layer.style.left = `${(lr.left - br.left) / z + deviceBezel.scrollLeft}px`;
            layer.style.top = `${(lr.top - br.top) / z + deviceBezel.scrollTop}px`;
            layer.style.width = `${lr.width / z}px`;
            layer.style.height = `${lr.height / z}px`;
        };
        window._syncTstatLcdEdgeDragLayer = syncTstatLcdEdgeDragLayer;

        const onLcdOutlinePointerMove = (e) => {
            if (!lcdOutlineDrag || e.pointerId !== lcdOutlineDrag.pointerId) return;
            const z = Number(window._tstatZoom || 1) || 1;
            const dx = (e.clientX - lcdOutlineDrag.startClientX) / z;
            const dy = (e.clientY - lcdOutlineDrag.startClientY) / z;
            window._tstatLcdNudgeX = Math.round(lcdOutlineDrag.startNx + dx);
            window._tstatLcdNudgeY = Math.round(lcdOutlineDrag.startNy + dy);
            window._applyTstatLcdNudgeTransform();
        };
        const onLcdOutlinePointerUp = (e) => {
            if (!lcdOutlineDrag || e.pointerId !== lcdOutlineDrag.pointerId) return;
            try {
                document.getElementById('tstat-lcd-edge-layer')?.releasePointerCapture(e.pointerId);
            } catch (_) {}
            lcdOutlineDrag = null;
            persistLcdNudge();
        };
        document.addEventListener('pointermove', onLcdOutlinePointerMove);
        document.addEventListener('pointerup', onLcdOutlinePointerUp);
        document.addEventListener('pointercancel', onLcdOutlinePointerUp);

        let lcdEdgeResizeDebounce = null;
        window.addEventListener('resize', () => {
            if (lcdEdgeResizeDebounce) clearTimeout(lcdEdgeResizeDebounce);
            lcdEdgeResizeDebounce = setTimeout(() => syncTstatLcdEdgeDragLayer(), 80);
        });

        syncTstatLcdEdgeDragLayer();
    }
});
