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

    // Hardware button event listeners
    document.getElementById('hw-btn-left').addEventListener('click', function() {
        sendHwKey('LEFT');
    });
    document.getElementById('hw-btn-down').addEventListener('click', function() {
        sendHwKey('DOWN');
    });
    document.getElementById('hw-btn-up').addEventListener('click', function() {
        sendHwKey('UP');
    });
    document.getElementById('hw-btn-right').addEventListener('click', function() {
        sendHwKey('RIGHT');
    });
});
