// coords.js: Coordinate, grid, and redbox logic for LCD simulator
// Reusable routines for grid cell calculations, redbox state, and movement

// Redbox state (1-based coordinates)
export let redbox = {
    x: 3, // column (1-based)
    y: 1, // row (1-based, bottom)
    numCols: 17,
    numRows: 10
};

// Zigzag movement: left-to-right, up, right-to-left, up, repeat
export function moveRedboxZigzag() {
    // Move right until end, then up and reverse direction
    if (!redbox._dir) redbox._dir = 1; // 1=right, -1=left
    if (redbox._dir === 1) {
        if (redbox.x < redbox.numCols) {
            redbox.x++;
        } else if (redbox.y < redbox.numRows) {
            redbox.y++;
            redbox._dir = -1;
        } else {
            // At top-right, reset to (1,1)
            redbox.x = 1;
            redbox.y = 1;
            redbox._dir = 1;
        }
    } else {
        if (redbox.x > 1) {
            redbox.x--;
        } else if (redbox.y < redbox.numRows) {
            redbox.y++;
            redbox._dir = 1;
        } else {
            // At top-left, reset to (1,1)
            redbox.x = 1;
            redbox.y = 1;
            redbox._dir = 1;
        }
    }
}

// Get current redbox coordinates
export function getRedboxCoords() {
    return { x: redbox.x, y: redbox.y };
}

// Set redbox coordinates
export function setRedboxCoords(x, y) {
    redbox.x = x;
    redbox.y = y;
}

// Reset redbox to initial state
export function resetRedbox() {
    redbox.x = 3;
    redbox.y = 1;
    redbox._dir = 1;
}