# Tstat10 Network Settings

This Markdown document serves as the Technical Specification for the Network Settings page. It bridges the gap between the visual layout of the Tstat10 and the underlying Modbus/BACnet data structures found in your C headers.

## UI Specification: Network & Communication Settings

### 1. Overview
This page provides the interface for configuring the physical and logical communication parameters of the Tstat10. It utilizes a Text-to-UI Protocol where each element is mapped to a specific memory register in the firmware.

### 2. Visual Layout (320x480 Canvas)
Based on Tstat10_2.jpg and DisHomeScreen.c coordinates:

| Element              | Type      | Coordinates (X, Y) | Font Reference   |
|----------------------|-----------|-------------------|-----------------|
| Title Line 1         | lv_label  | (160, 40)         | FONT_18_BOLD    |
| Title Line 2         | lv_label  | (160, 80)         | FONT_18_BOLD    |
| Menu List Container  | lv_list   | (20, 140)         | N/A             |
| Footer Navigation    | lv_obj    | (0, 420)          | DisSymbol.c     |

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

### 5. Interaction Model
- **Focus State:** The "Focused" item (defined in JSON) must render with the Teal background color (#008080) to match the hardware's selection cursor.
- **Navigation:**
  - UP/DOWN: Cycle the is_focused property through the widget array.
  - LEFT/RIGHT: Increment/Decrement the value of the focused register.
- **Phase 2 Sync:** Every value change in the simulator will eventually trigger a Modbus PRESET_SINGLE_REGISTER command to the hardware.
