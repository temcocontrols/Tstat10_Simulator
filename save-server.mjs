/**
 * Optional local POST server so visual JSON edits write to disk (port 5001).
 * Run: npm run save-server   or   node save-server.mjs
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SAVABLE_SCREEN_FILENAMES } from './screen-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 5001;

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    if (req.method === 'POST' && req.url.startsWith('/save_settings')) {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const fileName = requestUrl.searchParams.get('file');

        if (!fileName || !SAVABLE_SCREEN_FILENAMES.includes(fileName)) {
            console.error(`[SAVE ERROR] Attempt to write to an invalid or unspecified file: ${fileName}`);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Bad Request: Invalid or missing file parameter.');
        }

        let body = '';
        req.on('data', (chunk) => {
            body += chunk.toString();
        });
        req.on('end', () => {
            try {
                const filePath = path.join(__dirname, fileName);
                fs.writeFileSync(filePath, body, 'utf8');
                console.log(`[${new Date().toLocaleTimeString()}] Successfully saved to ${fileName}!`);
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('OK');
            } catch (err) {
                console.error('Error writing to file:', err);
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Failed to save file');
            }
        });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`[save-server] http://127.0.0.1:${PORT}  POST /save_settings?file=…`);
    console.log(`[save-server] Allowed files: ${SAVABLE_SCREEN_FILENAMES.join(', ')}`);
});
