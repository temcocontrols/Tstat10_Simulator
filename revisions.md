# Revisions Log

## Rev 1.1.0 (2026-04-03)
- Major refactor of navigation and rendering logic in network-settings-renderer.js: added central navigation, improved focus handling, and visual edit features.
- UI and style updates in simulator.css and Tstat10.html, including lens and bezel adjustments.
- Button coordinate properties removed from network_settings.json for better auto-centering.
- Enhanced event handling and debug panel logic in debug-panel-fixed.js and events.js.
- Improved menu and button navigation, including new shortcuts (e.g., 's' key and Left+Right long press for Setup Menu).
- See network-settings-renderer.js, ui-bridge.js, and related files for details.

## Rev 1.0.0 (2026-03-31)
- Keypad logic finalized and locked: Up/Down changes value (clamped, no wrap), Left/Right moves focus (highlight) between menu rows.
- Numeric and option lists are sorted low to high in the UI.
- All keypad and menu navigation matches product and MD specification.
- See network-settings-renderer.js and ui-bridge.js for implementation details.
