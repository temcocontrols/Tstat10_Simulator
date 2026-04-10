# Tstat11 Provisioning (SoftAP + Captive Portal)

This note captures the recommended non-BLE provisioning flow for ESP32-based thermostats and related Android app requirements.

## Why SoftAP Provisioning

ESP-IDF WiFi Provisioning supports both BLE and SoftAP. For the current architecture, SoftAP is a strong fit.

- No Bluetooth stack required (reduced RAM/flash pressure)
- Works with any WiFi-capable client (phone/laptop)
- Aligns with existing web-based graphics/server approach on ESP32

Tradeoff:

- User typically needs to connect phone to Tstat hotspot first

## Provisioning Modes

## 1) SoftAP Provisioning (non-BLE)

Device starts a temporary AP, user/app connects, provisioning occurs over HTTP.

Implementation direction:

- Bring up AP (for example `Tstat11-Setup`)
- Host provisioning UI (`/provisioning.html`) and API endpoints
- Accept and validate SSID/password payload
- Store credentials securely and reboot/join target WLAN

## 2) Captive Portal UX (recommended with SoftAP)

Goal: when phone joins Tstat AP, Android shows "Sign in to network" and launches provisioning page automatically.

Required building blocks:

- DNS interception: resolve most/all hostnames to ESP32 SoftAP IP (for example `192.168.4.1`)
- HTTP redirect: for unknown paths/hosts, return `302 Found` to `/provisioning.html`

This gives near-app-like onboarding without BLE.

## ESP-IDF Pointers

Search in firmware repos for:

- `esp_http_server.h`
- `wifi_prov_mgr_start_provisioning()`

If provisioning already exists and uses BLE scheme, evaluate switching to SoftAP scheme where appropriate.

## Android App Checklist

If app should automate connection instead of manual WiFi settings:

- Android 10+: use `NetworkSpecifier` / modern WiFi request APIs
- Bind HTTP/socket traffic to the connected provisioning network interface
- Ensure requests do not leak to cellular/default internet route while provisioning

## Tstat11 Settings to Add

To support complete onboarding, provisioning UI should include at least:

- WiFi SSID
- WiFi password
- Security mode (if needed)
- DHCP/static toggle (optional advanced)
- Static IP fields (optional advanced)

## Suggested Menu Integration (Tstat UI)

Add a dedicated setup item and keep user flow keypad-first:

- Setup Menu -> `Provisioning`
- Inside `Provisioning`, include rows:
  - `Mode`: `ONE TAP` / `ASSISTED` / `MANUAL`
  - `Transfer`: `APP LINK` / `QR HANDOFF` / `TYPE`
  - `Password`: `FROM PHONE` / `FROM CLOUD` / `USER ENTER`
  - `Step`: progress state machine (`OPEN APP`, `AUTO CONNECT`, `SEND CREDS`, `CONNECTING`, `DONE`)
  - `Status`: transport result (`IDLE`, `WAITING`, `RECEIVED`, `SUCCESS`, `FAILED`)

Frictionless default profile:

- `Mode = ONE TAP`
- `Transfer = APP LINK`
- `Password = FROM PHONE` (or best available non-typing source)

User steps (phone-link preferred):

1. User opens app and selects thermostat provisioning.
2. App joins/suggests Tstat SoftAP network.
3. App reads currently selected phone SSID and password (when available via app-managed flow) and sends credentials to Tstat over local channel.
4. Tstat stores credentials, attempts station join, and updates `Status`.
5. On success, Tstat exits provisioning mode and returns to normal WiFi operation.

Important constraint:

- Mobile OSes do not generally allow arbitrary apps to read saved WiFi passwords directly from system settings.
- "No typing" UX is usually achieved by app-owned credential entry, prior app-known credentials, account backend retrieval, QR transport, or platform-specific enterprise APIs.

Fallback order for minimal friction:

1. `APP LINK + FROM PHONE` (best UX when app already has network credential)
2. `APP LINK + FROM CLOUD` (account-managed network profile)
3. `QR HANDOFF` (quick transfer without typing on thermostat)
4. `TYPE` (last resort)

## Suggested Deliverables

- `provisioning.html` page and styling
- `/api/provision` endpoint (POST credentials)
- DNS + captive redirect module
- Connection status endpoint for progress feedback
- Error states for auth failure, timeout, and retry
