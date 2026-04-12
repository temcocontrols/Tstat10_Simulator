# Browser console pipe (dev server)

When you use **`npm start`** (`tools/dev-server.mjs`), the page loads **`console-pipe-client.js`**, which mirrors **`console.log` / `warn` / `error` / …** to the dev server over **`POST /log`**.

## Log files (under `logs/`)

| File | Format | Purpose |
|------|--------|---------|
| **`browser-console.log`** | Plain text | Human-readable tail (`Get-Content … -Wait` on Windows). |
| **`browser-console.jsonl`** | **NDJSON** (one JSON object per line) | Filtering with **`jq`**, spreadsheets, or other tools. |

Each event includes at least:

- **`ts`** — ISO timestamp (UTC).
- **`level`** — `log`, `info`, `warn`, `error`, or `debug`.
- **`text`** — Serialized message (objects passed to `console.log` become JSON text when possible).
- **`pathname`** — Browser `location.pathname` when the line was emitted (empty if unavailable).
- **`title`** — `document.title` (truncated server-side if ever abused).
- **`sessionId`** — Stable random id for the tab for this **sessionStorage** lifetime (helps correlate bursts of lines).
- **`userAgent`** — Request `User-Agent` from the dev server (truncated).

## Examples

**Tail the human log (PowerShell):**

```powershell
Get-Content .\logs\browser-console.log -Wait
```

**Filter JSON lines (requires [jq](https://jqlang.org/)):**

```bash
grep '"level":"error"' logs/browser-console.jsonl | jq .
```

**Errors only:**

```bash
jq 'select(.level=="error")' logs/browser-console.jsonl
```

## Disable or override

- **Query:** `?consolePipe=0` turns the pipe off for that load.
- **localStorage:** `TSTAT_CONSOLE_PIPE` = `0` (off) or `1` (force on even without probe).
- **Custom base URL** (e.g. file pages): set **`CONSOLE_PIPE_URL`** to `http://127.0.0.1:8787` (no trailing slash required).

See the header comment in **`console-pipe-client.js`** for full behavior.
