# Getting started (new contributors & casual users)

You do **not** need to memorize lint commands or CI. Follow this page once; after that, most quality checks run **automatically**.

## 1. One-time setup (per computer)

From the **`Tstat10_Simulator`** folder (the same folder that contains `package.json`):

```bash
npm install
npm run setup
```

| Step | What it does for you |
|------|----------------------|
| **`npm install`** | Installs tools (ESLint, Playwright, Husky). Installs **git hooks** so commits are auto-checked. |
| **`npm run setup`** | Checks Node version, downloads **Chromium** for tests (large, one-time). |

**Requirement:** [Node.js](https://nodejs.org/) **v20 or newer** (LTS is fine).

## 2. Run the simulator (daily use)

```bash
npm start
```

Open the URL shown in the terminal (usually **http://127.0.0.1:8787/Tstat10.html** on the PC).

**Phone or tablet:** use **`http://<your-PC-LAN-IP>:8787/Tstat10.html`** on the same Wi‑Fi (example: `http://10.12.227.234:8787/Tstat10.html`). **Do not use `127.0.0.1` on the phone** — that address means “this device,” so the browser shows **connection error ~-102**. The dev server listens on all interfaces by default (`HOST=0.0.0.0`); set **`HOST=127.0.0.1`** only if you want local-only binding.

**Why not “Open HTML in browser” or Live Server?** This project uses **ES modules** and optional **console logging** to disk. The built-in dev server (`npm start`) is the supported way—see **`agents.md`** §13.

## 3. What happens automatically

| When | What runs |
|------|-----------|
| **`git commit`** | **Lint-staged** runs **ESLint --fix** on the `.js` / `.mjs` files you are committing. If ESLint finds an **error**, the commit is blocked until you fix it. |
| **`git push`** (GitHub) | **CI** runs lint, quick checks, and a **short browser test** so broken changes are caught early. |
| **Save a file** in **VS Code / Cursor** | If you installed the **ESLint** extension (the editor may prompt you), fixes that ESLint can apply may run **on save**—see `.vscode/settings.json`. |

You can still run **`npm run lint`** anytime to check the whole project.

## 4. Optional checks before a push

```bash
npm run test:e2e
```

Starts a temporary server on **port 8799**, loads the UI, and checks for obvious errors. (Your **`npm start`** can stay on **8787** at the same time.)

## 5. Editor: one-click tasks (VS Code / Cursor)

**Terminal → Run Task…** (or Command Palette → “Tasks: Run Task”):

- **Simulator: Start dev server** — same as `npm start`
- **Simulator: First-time setup** — same as `npm run setup`
- **Simulator: Run E2E smoke tests** — same as `npm run test:e2e`
- **Simulator: Save server (disk writes)** — same as `npm run save-server`
- **Simulator: Doctor + HTTP probe** — `npm run doctor -- --probe`

## 6. If something fails

| Problem | Try |
|---------|-----|
| **“Node version” / doctor fails** | Install Node **20+** from [nodejs.org](https://nodejs.org/) |
| **Port already in use** | Stop the other terminal using that port, or change `PORT` (e.g. `set PORT=8888` then `npm start` on Windows) |
| **Playwright / Chromium errors** | Run `npm run setup` again |
| **Commit blocked by ESLint** | Read the message in the terminal; often `npm run lint:fix` fixes style issues across the whole repo |
| **“Is my dev server running?”** | `npm run doctor -- --probe` (checks **8787** and **8799**) |
| **Phone: error -102 / connection failed** | Use the PC’s **LAN IP**, not `127.0.0.1`. Ensure **`npm start`** is running on the PC. E2E uses **8799** only while tests run; daily use is usually **8787** (or your `PORT`). |
| **Save JSON edits to disk** | Second terminal: `npm run save-server` (port **5001**; allowlist matches **`screen-paths.js`**) |

## 7. Deeper docs

- **Authoring rules & dev habits:** [`agents.md`](agents.md)  
- **Product / LCD editor notes:** [`Readme.md`](Readme.md)  
- **Roadmap / backlog:** [`Todo.md`](Todo.md)
