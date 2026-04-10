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

function toggleRef(base64Data) {
    const img = document.getElementById('ref-photo');
    img.src = base64Data;
    img.style.display = 'block';
}

function hideRefPhoto() {
    document.getElementById('ref-photo').style.display = 'none';
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

        const applyTstatViewTransform = () => {
            zoom = clampZoom(zoom);
            const px = Number(window._tstatPanX || 0);
            const py = Number(window._tstatPanY || 0);
            deviceBezel.style.transformOrigin = 'top center';
            deviceBezel.style.transform = `translate(${px}px, ${py}px) scale(${zoom})`;
            window._tstatZoom = zoom;
            const zr = document.getElementById('sls-zoom-readout');
            if (zr) zr.textContent = `${Math.round(zoom * 100)}%`;
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

        window._fitTstatViewport = () => {
            zoom = 1;
            window._tstatPanX = 0;
            window._tstatPanY = 0;
            applyTstatViewTransform();
        };
        window._tstatZoomIn = zoomIn;
        window._tstatZoomOut = zoomOut;

        zoom = clampZoom(zoom);
        applyTstatViewTransform();

        const fitBtn = document.getElementById('sls-fit-view');
        if (fitBtn) {
            fitBtn.addEventListener('click', () => window._fitTstatViewport());
        }
        document.getElementById('sls-zoom-in')?.addEventListener('click', zoomIn);
        document.getElementById('sls-zoom-out')?.addEventListener('click', zoomOut);
        document.getElementById('sls-zoom-readout')?.addEventListener('click', zoomReset100);

        tstatContainer.addEventListener('wheel', (e) => {
            e.preventDefault();
            zoomByWheelDelta(e.deltaY);
        }, { passive: false });

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
    }
});
