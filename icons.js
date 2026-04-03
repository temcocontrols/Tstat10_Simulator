// icons.js
// Auto-generated from DisSymbol.c arrays for use in the Tstat10 Simulator
// Contains: leftup, leftdown, rightup, rightdown, cmnct_send, cmnct_rcv, wifi_4, wifi_3, wifi_2, wifi_1, wifi_0, wifi_none, athome, offhome
// Color mapping (example):
// DIS_BG: '#e0e0e0', DIS_CH: '#0077cc', DIS_IN: '#cccccc', DIS_FD: '#f8f8f8', DIS_HL: '#ffcc00', DIS_RD: '#ff3333', DIS_TG: '#00cc66', DIS_TB: '#ffffff', DIS_SN: '#ffff00'
// You can adjust these colors to match your UI theme.

const ICON_COLORS = {
  DIS_BG: '#e0e0e0',
  DIS_CH: '#0077cc',
  DIS_IN: '#cccccc',
  DIS_FD: '#f8f8f8',
  DIS_HL: '#ffcc00',
  DIS_RD: '#ff3333',
  DIS_TG: '#00cc66',
  DIS_TB: '#ffffff',
  DIS_SN: '#ffff00',
  // Add more as needed
};

// Example icon data (replace with full arrays as needed)
const leftup = [
  'DIS_BG','DIS_BG','DIS_BG','DIS_TG','DIS_TG','DIS_TG','DIS_IN','DIS_IN',
  'DIS_BG','DIS_BG','DIS_TG','DIS_TG','DIS_TG','DIS_TG','DIS_IN','DIS_IN',
  'DIS_BG','DIS_TG','DIS_TG','DIS_TG','DIS_TG','DIS_TG','DIS_IN','DIS_IN',
  'DIS_TG','DIS_TG','DIS_TG','DIS_TG','DIS_IN','DIS_IN','DIS_IN','DIS_IN',
  'DIS_TG','DIS_TG','DIS_TG','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN',
  'DIS_TG','DIS_TG','DIS_TG','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN',
  'DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN',
  'DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN','DIS_IN',
];
// ...repeat for all icons (leftdown, rightup, rightdown, cmnct_send, etc.)

function drawIcon(ctx, iconArray, width, height, dx, dy, scale = 1) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const colorKey = iconArray[y * width + x];
      ctx.fillStyle = ICON_COLORS[colorKey] || '#000000';
      ctx.fillRect(dx + x * scale, dy + y * scale, scale, scale);
    }
  }
}

// Export icons and draw function
export { leftup, drawIcon, ICON_COLORS };
// Add more exports as you add more icons
