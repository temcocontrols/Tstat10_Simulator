\# Architecture.md: Tstat10 Portable UI Integration



\## 1. Executive Summary

The Tstat10 Portable UI is a high-fidelity, zero-dependency HTML/JS simulator. It serves as the "Digital Twin" of the physical Tstat10 hardware, allowing for UI development, testing, and remote monitoring without requiring a physical device.



\## 2. Integration Ecosystem

The simulator is designed to plug directly into the following Temco Controls platforms:



\### A. \[T3000 Building Automation System](https://github.com/temcocontrols/T3000\_Building\_Automation\_System)

\* \*\*Role:\*\* Windows-based desktop front-end.

\* \*\*Integration:\*\* T3000 utilizes the `index.html` via a \*\*WebView2 (Chromium)\*\* control.

\* \*\*Data Flow:\*\* T3000 polls the physical Tstat10 over BACnet/Modbus and pushes updates to the UI using `ExecuteScriptAsync()`.



\### B. \[T3000Webview](https://github.com/temcocontrols/T3000Webview)

\* \*\*Role:\*\* Cross-platform web and mobile interface.

\* \*\*Integration:\*\* Acts as a native web component or iframe. It is compatible with the broader T3000Webview dashboard architecture.



\---



\## 3. Technical Design (Minimalist/Portable)



\### I. Fixed-Coordinate Rendering

To maintain 1:1 parity with the ESP32's internal frame buffer (which does NOT use LVGL), the web UI uses absolute positioning:

\* \*\*Resolution:\*\* Locked at 320px x 480px.

\* \*\*Styling:\*\* CSS variables define the "Temco Blue" (#1565C0) and high-contrast white borders.

\* \*\*Assets:\*\* Zero external dependencies (No React, No Bootstrap) for maximum speed on embedded web servers.

\* \*\*Debug Panel & Overlays:\*\* The UI includes a debug panel with toggles for Grid, Coords, Redbox, and Auto Tester overlays. The panel displays live event, focus, value, and redbox coordinates. The auto tester can be toggled at runtime. The redbox overlay highlights a specific LCD cell for alignment/debugging.



\### II. The JavaScript Bridge (Messaging)

The UI remains "passive" and data-agnostic. Interaction is handled via a standardized Messaging API:



\* \*\*Downlink (Host -> UI):\*\* The host injects data by calling global JS functions (e.g., `updateUI(json)`).

\* \*\*Uplink (UI -> Host):\*\* User interactions (clicks/edits) are captured and forwarded to the host:

&#x20;   \* \*\*Desktop:\*\* `window.chrome.webview.postMessage(json)`

&#x20;   \* \*\*Web:\*\* Standard `fetch()` or `WebSocket` events.



\---



\## 4. Prototyping Strategy (Standalone Browser Mode)



Initial development and "mimicking" of the application occur in a standard web browser:

\* \*\*Mock Messaging:\*\* Local JS event listeners simulate the data packets typically sent by the T3000 C++ backend.

\* \*\*Visual Debugging:\*\* Browser DevTools are used to verify pixel-perfect alignment against

