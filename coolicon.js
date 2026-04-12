// JavaScript rendering of the Tstat10 cooling icon from C array
// Color mapping based on firmware definitions
const COOLICON_WIDTH = 55;
const COOLICON_HEIGHT = 28;
// C array from DisSymbol.c, converted to JS (truncated for brevity, full array should be used)
const coolicon = [
  0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,0x7E19,
  // ... (add the rest of the array here, total 1540 values for 55x28)
];

// Map 16-bit color to hex string (RGB565 to #RRGGBB)
function rgb565ToHex(c) {
  let r = ((c >> 11) & 0x1F) * 255 / 31;
  let g = ((c >> 5) & 0x3F) * 255 / 63;
  let b = (c & 0x1F) * 255 / 31;
  return `#${((1 << 24) + (Math.round(r) << 16) + (Math.round(g) << 8) + Math.round(b)).toString(16).slice(1)}`;
}

// Draw the icon on a canvas context at (dx, dy)
function drawCoolIcon(ctx, dx, dy, scale=1) {
  for (let y = 0; y < COOLICON_HEIGHT; ++y) {
    for (let x = 0; x < COOLICON_WIDTH; ++x) {
      const idx = y * COOLICON_WIDTH + x;
      const color = coolicon[idx];
      // Skip background color (0x7E19)
      if (color !== 0x7E19) {
        ctx.fillStyle = rgb565ToHex(color);
        ctx.fillRect(dx + x*scale, dy + y*scale, scale, scale);
      }
    }
  }
}

// Exposed for demos / future wiring (Temco tooling).
if (typeof window !== 'undefined') {
    window.temcoDrawCoolIcon = drawCoolIcon;
}