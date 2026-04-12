# Tstat10 Network Settings

This Markdown document serves as the Technical Specification for the Network Settings page. It bridges the gap between the visual layout of the Tstat10 and the underlying Modbus/BACnet data structures found in your C headers.

## UI Specification: Network & Communication Settings

### 1. Overview
This page provides the interface for configuring the physical and logical communication parameters of the Tstat10. It utilizes a Text-to-UI Protocol where each element is mapped to a specific memory register in the firmware.

### 2. Visual Layout (240×320 Canvas)
Simulator and stock `network_settings.json` target the **ILI9341** framebuffer (**240×320** portrait). Coordinates below are representative of the current JSON/renderer (scaled from older 320×480 references):

**Simulator (layout editor):** The Screen inspector can switch **LCD & driver** presets or width/height so the on-screen LCD resizes immediately. Use **Apply layout** to rescale stored widget coordinates to the new canvas; anything still off-screen is adjusted manually. See [`AGENTS.md`](AGENTS.md) item **14** and [`lcd-editor-core.js`](lcd-editor-core.js) `applyLayoutRemapToMatchCanvas`.

| Element              | Type      | Coordinates (X, Y) | Font Reference   |
|----------------------|-----------|-------------------|-----------------|
| Title (centered)     | header    | (120, 26)         | FONT_18_BOLD    |
| Menu rows            | menu_row  | row grid, 32px pitch (`menuRowPixelHeight`) | monospace stack |
| Footer band          | layout    | (0, 272), width 240, height 48 | footer buttons |

### 3. Data Mapping & Logic
The following table defines the link between the UI "Text Description" and the C Header registers (registers.h).

| UI Label    | JSON ID        | Modbus Register   | Data Type   | Default Value   |
|-------------|----------------|------------------|-------------|-----------------|
| Modbus ID   | ui_item_addr   | MODBUS_ADDRESS   | uint8_t     | 1               |
| Baudrate    | ui_item_baud   | MODBUS_BAUDRATE  | uint32_t    | 115200          |
| Protocol    | ui_item_prot   | PROTOCOL_TYPE    | enum        | 0 (Modbus RTU)  |
| IP Address  | ui_item_ip     | IP_ADDR_0        | ipv4        | 192.168.0.1     |


### 4. Text-Based UI Description (JSON)
This is the payload that the Phase 1 Simulator will ingest to render the page.

See the file network_settings.json for the JSON payload used to render the Network Settings page.

### 4a. Text Truncation Rule
If the label or value text is too long for the available space, it will be truncated with an ellipsis (`...`). Word wrap is never used; all text is forced to a single line.

### 5. Interaction Model
- **Focus State:** The "Focused" item (defined in JSON) must render with the menu highlight color (**#39757b**, firmware highlight ≈ RGB565 `0x3cef` in `LcdTheme.h`) to match the hardware selection cursor. Older docs referred to #008080; simulator JSON uses the theme-aligned value above.
- **Navigation:**
  - UP/DOWN: Cycle the is_focused property through the widget array.
  - LEFT/RIGHT: Increment/Decrement the value of the focused register.
- **Phase 2 Sync:** Every value change in the simulator will eventually trigger a Modbus PRESET_SINGLE_REGISTER command to the hardware.
