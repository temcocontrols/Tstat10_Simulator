#!/usr/bin/env node
/**
 * One process: static files + POST /log (console pipe) + optional browser open.
 *
 *   npm start
 *   node tools/dev-server.mjs
 *
 * Env: PORT (default 8787), OPEN_BROWSER=0 to skip opening a tab
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { appendBrowserLogFromBody, LOG_FILE, ROOT } from './log-sink.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);

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

    if (req.method === 'POST' && pathname === '/log') {
        let body = '';
        req.on('data', (c) => {
            body += c;
            if (body.length > 2_000_000) req.destroy();
        });
        req.on('end', () => {
            try {
                const line = appendBrowserLogFromBody(body);
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

server.listen(PORT, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${PORT}`;
    const entry = `${base}/Tstat10.html`;
    console.error(
        `listening on ${base}\n` +
            `  → open ${entry}\n` +
            `  → console log ${path.relative(ROOT, LOG_FILE)}\n` +
            `Tail (PowerShell): Get-Content ${path.relative(ROOT, LOG_FILE)} -Wait`
    );
    openBrowser(entry);
});
