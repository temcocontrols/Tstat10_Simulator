#!/usr/bin/env node
/**
 * One process: static files + POST /log (console pipe) + optional browser open.
 *
 *   npm start
 *   node tools/dev-server.mjs
 *
 * Env: PORT (default 8787), HOST (default “all interfaces”: dual-stack :: so localhost + 127.0.0.1 + LAN work;
 *       use 127.0.0.1 to bind IPv4 loopback only),
 *       OPEN_BROWSER=0 to skip opening a tab
 *       TSTAT_LCD_LIB — absolute path to LCD asset library root (default: <project>/lcd-lib).
 *         Serve icons from <root>/icons/*.svg ; see GET /__tstat_lcd_lib/manifest.json
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { appendBrowserLogFromBody, LOG_FILE, ROOT } from './log-sink.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
/**
 * Bind address. Default `0.0.0.0` means “serve everywhere” but we actually listen on `::` with ipv6Only:false
 * so both IPv4 (127.0.0.1, LAN) and IPv6 (::1, `localhost` in some browsers) work. Plain `0.0.0.0` alone breaks
 * `http://localhost:PORT` when the OS resolves localhost to ::1 first.
 */
const HOST = process.env.HOST || '0.0.0.0';
const LCD_LIB_ROOT = path.resolve(process.env.TSTAT_LCD_LIB || path.join(ROOT, 'lcd-lib'));

function lcdLibIconsDir() {
    return path.join(LCD_LIB_ROOT, 'icons');
}

/** @param {string} raw */
function safeSvgBasename(raw) {
    const base = path.basename(String(raw || ''));
    if (!base.toLowerCase().endsWith('.svg')) return null;
    if (base.includes('..')) return null;
    return base;
}

function listLcdLibManifestBody() {
    const dir = lcdLibIconsDir();
    /** @type {{ id: string, name: string, file: string }[]} */
    const icons = [];
    try {
        if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
            for (const file of fs.readdirSync(dir).sort((a, b) => a.localeCompare(b))) {
                if (!file.toLowerCase().endsWith('.svg')) continue;
                const stem = file.replace(/\.svg$/i, '');
                const name = stem
                    .replace(/[_-]+/g, ' ')
                    .replace(/\b\w/g, (c) => c.toUpperCase());
                icons.push({ id: `lib:${stem}`, name, file });
            }
        }
    } catch {
        /* ignore */
    }
    return JSON.stringify({ icons });
}

/**
 * @param {import('http').ServerResponse} res
 * @param {string} method
 * @param {string | null} fileParam
 */
function sendLcdLibSvg(res, method, fileParam) {
    const safe = safeSvgBasename(fileParam || '');
    if (!safe) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('bad file');
        return;
    }
    const baseDir = path.resolve(lcdLibIconsDir());
    const full = path.resolve(baseDir, safe);
    const rel = path.relative(baseDir, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    if (method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
    }
    fs.readFile(full, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end(String(err));
            return;
        }
        res.writeHead(200);
        res.end(data);
    });
}

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.map': 'application/json; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8'
};

function safeResolvedPath(pathname) {
    try {
        if (pathname.includes('..')) return null;
        const decoded = decodeURIComponent(pathname);
        const full = path.normalize(path.join(ROOT, decoded));
        if (!full.startsWith(ROOT)) return null;
        return full;
    } catch {
        return null;
    }
}

function openBrowser(url) {
    if (process.env.OPEN_BROWSER === '0') return;
    try {
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' });
        } else if (process.platform === 'darwin') {
            spawn('open', [url], { detached: true, stdio: 'ignore' });
        } else {
            spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
        }
    } catch {
        /* ignore */
    }
}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname;

    if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('ok');
        return;
    }

    /** Enables console-pipe-client.js to detect npm start / this dev server (no static file server has this). */
    if (req.method === 'GET' && pathname === '/__tstat_dev_probe') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (
        (req.method === 'GET' || req.method === 'HEAD') &&
        pathname === '/__tstat_lcd_lib/manifest.json'
    ) {
        const body = listLcdLibManifestBody();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (req.method === 'HEAD') {
            res.setHeader('Content-Length', Buffer.byteLength(body, 'utf8'));
            res.writeHead(200);
            res.end();
            return;
        }
        res.writeHead(200);
        res.end(body);
        return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && pathname === '/__tstat_lcd_lib/svg') {
        sendLcdLibSvg(res, req.method, url.searchParams.get('file'));
        return;
    }

    if (req.method === 'POST' && pathname === '/log') {
        let body = '';
        req.on('data', (c) => {
            body += c;
            if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
            try {
                const ua = req.headers['user-agent'];
                const line = appendBrowserLogFromBody(body, { userAgent: typeof ua === 'string' ? ua : '' });
                process.stdout.write(line + '\n');
                res.writeHead(204);
                res.end();
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(String(e));
            }
        });
        return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405);
        res.end();
        return;
    }

    let filePath = pathname === '/' ? path.join(ROOT, 'Tstat10.html') : safeResolvedPath(pathname.slice(1));

    if (!filePath) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        const idx = path.join(filePath, 'index.html');
        if (fs.existsSync(idx)) filePath = idx;
        else {
            res.writeHead(404);
            res.end('Not found');
            return;
        }
    }

    if (!fs.existsSync(filePath)) {
        res.writeHead(404);
        res.end('Not found');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const ct = MIME[ext] || 'application/octet-stream';
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', ct);

    if (req.method === 'HEAD') {
        res.writeHead(200);
        res.end();
        return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(500);
            res.end(String(err));
            return;
        }
        res.writeHead(200);
        res.end(data);
    });
});

function startHttpServer() {
    const localBase = `http://127.0.0.1:${PORT}`;
    const entry = `${localBase}/Tstat10.html`;
    const libRel = path.relative(ROOT, LCD_LIB_ROOT);
    const allIfaces = HOST === '0.0.0.0' || HOST === '::' || HOST === '::0';
    const lanHint = allIfaces
        ? `  → phone / tablet (same Wi‑Fi): http://<this-PC-LAN-IP>:${PORT}/Tstat10.html — never use 127.0.0.1 there (that is the phone itself; browser error ~-102)\n`
        : '';
    const onListen = () => {
        const bindNote = allIfaces
            ? `all interfaces (IPv4 + IPv6 — use http://127.0.0.1:${PORT} or http://localhost:${PORT})`
            : `http://${HOST}:${PORT}`;
        console.error(
            `listening on port ${PORT} (${bindNote})\n` +
                `  → this PC: ${entry}\n` +
                lanHint +
                `  → LCD icon library: ${libRel || '.'}${path.sep}icons (override: TSTAT_LCD_LIB)\n` +
                `  → console log ${path.relative(ROOT, LOG_FILE)}\n` +
                `Tail (PowerShell): Get-Content ${path.relative(ROOT, LOG_FILE)} -Wait`
        );
        openBrowser(entry);
    };

    if (allIfaces) {
        const onBindError = (err) => {
            server.off('error', onBindError);
            if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL') {
                server.listen(PORT, '0.0.0.0', onListen);
            } else {
                console.error(err);
                process.exit(1);
            }
        };
        server.once('error', onBindError);
        server.listen({ port: PORT, host: '::', ipv6Only: false }, () => {
            server.off('error', onBindError);
            onListen();
        });
    } else {
        server.listen(PORT, HOST, onListen);
    }
}

startHttpServer();
