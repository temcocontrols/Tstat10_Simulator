# Tstat10 Screen Inventory

This document defines the current screen names used in the simulator so we use one shared vocabulary in discussions, tickets, and commits.

## Naming Convention

- Use **Display Name** for product/demo discussions.
- Use **Screen Key** for navigation and code (`navigateTo('<key>')`).
- Use **Page ID** for JSON-level references (`"page": "..."`).

## Active Screens

| Display Name | Screen Key | Page ID | Source JSON | Notes |
|---|---|---|---|---|
| Home | `main` | `MAIN_DISPLAY` | `main_display.json` | Main thermostat display with SET/FAN/SYS rows |
| Setup Menu | `setup` | `SETUP_MENU` | `setup_menu.json` | Entry hub for setup sub-pages |
| RS485 Settings | `settings` | `RS485_SETTINGS` | `network_settings.json` | Protocol/NetID/Baud setup |
| WiFi Setup | `ethernet` | `WIFI_SETTINGS` | `ethernet_setup.json` | IP/Mask/Gateway/DHCP setup |
| Provisioning | `provisioning` | `PROVISIONING_SETUP` | `provisioning_setup.json` | Phone-link/manual credential onboarding flow |
| Clock Setup | `clock` | `CLOCK_SETTINGS` | `clock_setup.json` | Date/time setup |
| Outside Air Temp | `oat` | `OAT_SETTINGS` | `oat_setup.json` | OAT value and offset |
| To Be Done | `tbd` | `TBD_SETTINGS` | `tbd_setup.json` | Placeholder page for future features |

## Current Navigation Flow

- `Home` (`main`) + **Left** => `Setup Menu` (`setup`)
- `Setup Menu` + **Right/Enter** on focused item => selected sub-screen
- Settings sub-screens (`settings`, `ethernet`, `provisioning`, `clock`, `oat`, `tbd`) + **Left** => `Setup Menu`
- `Setup Menu` + **Left** => `Home`

## Legacy/Reference JSON

- `Menu_NetworkSettings.json` (`page: NETWORK_SETTINGS`) exists as an older prototype definition.
- It is currently not part of the active `navigateTo()` screen map.

## Recommendation

For consistency in new docs and issues, use these exact labels:

- Home
- Setup Menu
- RS485 Settings
- WiFi Setup
- Provisioning
- Clock Setup
- Outside Air Temp
- To Be Done
