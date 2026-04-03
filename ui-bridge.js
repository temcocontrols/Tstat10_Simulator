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
        const event = new KeyboardEvent('keydown', { key: arrowKey, bubbles: true });
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
    document.getElementById('show-main-photo').addEventListener('click', function() {
        toggleRef(Tstat10_5_BASE64);
    });
    document.getElementById('show-settings-photo').addEventListener('click', function() {
        toggleRef(Tstat10_2_BASE64);
    });
    document.getElementById('hide-photo').addEventListener('click', hideRefPhoto);

    // Hardware button event listeners with Left+Right Long Press detection
    let leftDown = false;
    let rightDown = false;
    let longPressTimer = null;
    let skipNextClick = false;

    function checkLongPress() {
        if (leftDown && rightDown) {
            longPressTimer = setTimeout(() => {
                console.log("Simultaneous Left+Right long press detected");
                skipNextClick = true;
                const event = new KeyboardEvent('keydown', { key: 's', bubbles: true });
                window.dispatchEvent(event);
            }, 2000);
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

    document.getElementById('hw-btn-down').addEventListener('click', function() {
        sendHwKey('DOWN');
    });
    document.getElementById('hw-btn-up').addEventListener('click', function() {
        sendHwKey('UP');
    });
});
