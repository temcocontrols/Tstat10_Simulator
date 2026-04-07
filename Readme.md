\# Tstat10 UI Prototype



## Upcoming Features

We will be adding new features to our HVAC drawing tools, including utilities to configure the LCD (display) and menu system for both Tstat10 and Tstat11. These tools will let users configure their own custom menu systems on the thermostats at runtime, and the stock menu system is also configurable with these tools. The resulting menu structures and behaviors are stored directly on the device and in program files, allowing for flexible, user-defined interfaces and logic.

Stay tuned for updates as these tools are integrated into the project!

## LCD Editor Prototype (New)

The simulator now includes an initial LCD editor panel in the debug UI:

- Set canvas width/height
- Set orientation (`vertical` or `horizontal`)
- Set color mode (`indexed` or `reduced_rgb`)
- Apply settings to the active screen JSON in memory
- Run phase-1 validation checks for Tstat10-safe constraints

\## Quick Start

1\. Open `Tstat10.code-workspace` in VS Code.

2\. Use the \*\*Live Server\*\* extension (or any static HTTP server) to open **`Tstat10.html`** from this folder. ES modules require `http://` (not `file://`).

**Alternative (no VS Code extension):** from PowerShell in `Tstat10_Simulator`:

```powershell
cd C:\Xdrive\Tstat10_Simulator
python -m http.server 8080
```

Then open `http://localhost:8080/Tstat10.html`.

**Optional — save edited JSON back to disk:** the UI can POST to port 5001. In another terminal:

```powershell
cd C:\Xdrive\Tstat10_Simulator
node save-server.js
```

If the save server is not running, edits fall back to `localStorage` (see browser console).

3. Press **'D'** in the browser to simulate live temperature drift.

4. Click the **IP Address** at the bottom to flip to the Settings screen.

5. Use the debug panel (left of LCD) to toggle overlays: Grid, Coords, Redbox, and Auto Tester. The panel also shows live event, focus, value, and redbox coordinates.

6. The redbox overlay highlights a specific LCD cell for alignment/debugging. Auto tester can now be toggled at runtime.

## Project Structure

* `Tstat10.html`: The HTML5 structure (The "Shell").

* `style.css`: Pixel-perfect 320x480 CSS (The "Look").

* `mock_bridge.js`: Simulation logic for T3000 testing (The "Brain").

* `Architecture.md`: Integration guide for T3000/Webview.

