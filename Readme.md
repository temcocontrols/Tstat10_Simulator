\# Tstat10 UI Prototype



\## Quick Start

1\. Open `Tstat10.code-workspace` in VS Code.

2\. Use the \*\*Live Server\*\* extension to launch `index.html`.

3. Press **'D'** in the browser to simulate live temperature drift.

4. Click the **IP Address** at the bottom to flip to the Settings screen.

5. Use the debug panel (left of LCD) to toggle overlays: Grid, Coords, Redbox, and Auto Tester. The panel also shows live event, focus, value, and redbox coordinates.

6. The redbox overlay highlights a specific LCD cell for alignment/debugging. Auto tester can now be toggled at runtime.

## Project Structure

* `index.html`: The HTML5 structure (The "Shell").

* `style.css`: Pixel-perfect 320x480 CSS (The "Look").

* `mock_bridge.js`: Simulation logic for T3000 testing (The "Brain").

* `Architecture.md`: Integration guide for T3000/Webview.

