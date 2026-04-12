# ADR 0002: Mobile phone client for simulator + provisioning handoff

## Status

**Draft / proposed** (2026-04) — options captured; **no stack chosen** yet. Execution plan and checkboxes live in **[`Todo.md`](../../Todo.md)** under **“Mobile Phone App (new)”**.

## Context

- We want a **phone** to run or target the **Tstat10 simulator**, join a **thermostat local AP** (or equivalent), and **submit Wi‑Fi credentials** in a flow aligned with real provisioning.
- The existing simulator is **browser + ESM** ([ADR 0001](0001-defer-frontend-bundler.md)); phones already can open the sim on **LAN** when the dev server binds to `0.0.0.0` / `::` (see **GETTING_STARTED**).
- Open product/security questions: **PWA vs native wrapper**, **TLS** on device AP, **where credentials are validated** (phone only vs relay vs cloud), and **logging policy** (no passwords in `logs/browser-console.*`).

## Repository (placement)

**Default: same repository as the Tstat10 simulator** (this repo).

- **PWA / mobile Safari/Chrome**, **`?role=phone`**, QR/deep links, **`docs/provisioning-phone-handoff.md`**, and **Playwright** mobile-viewport tests all stay **here** so screen JSON, schema, and UI change in **one PR**.
- **Revisit a separate repo only if** we commit to an **app-store native** shell (signing, platform-specific CI, secrets) that is painful to colocate—or a different team owns releases. Even then, keep **JSON contract + fixtures** canonical **here** and consume them as a package or submodule from the native repo.

## Options (to decide later)

| Option | Summary | Fits ADR 0001? |
|--------|---------|----------------|
| **A. PWA / mobile browser only** | Same `Tstat10.html` + optional `?role=…`; minimal extra assets (`manifest` if needed). | Yes — no bundler required. |
| **B. Capacitor / WebView shell** | Thin native wrapper loads same origin URL; may add bridge APIs. | Yes if shell loads static/ESM build without introducing a bundler policy change. |
| **C. Separate native app** | Only if PWA/WebView cannot meet store, BLE, or OS Wi‑Fi APIs. | Revisit ADR 0001 for any packaged web layer. |

## Decision (placeholder)

- **Repository:** **Same repo** by default (see **Repository** above). Documented 2026-04 per product direction.
- **Client stack:** **None chosen yet** (PWA vs wrapper vs native). Complete **Phase A–C** in **`Todo.md`** (phone-usable sim, mock handoff, **`docs/provisioning-phone-handoff.md`** contract) before locking **A / B / C** in the options table.
- When the stack is chosen, update this ADR to **Accepted** (or split ADR if a native repo is introduced) and record **consequences** (CI, signing, release).

## Links

- **Plan & steps:** [`Todo.md`](../../Todo.md) → section **“Mobile Phone App (new)”**.
- **Future contract doc (to add in Phase C):** `docs/provisioning-phone-handoff.md`.
