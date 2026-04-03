const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5001;

const server = http.createServer((req, res) => {
    // Handle CORS so the browser (running on port 5500) can talk to this server
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Pre-flight request for CORS
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
    }

    // Handle the silent save endpoint
    if (req.method === 'POST' && req.url.startsWith('/save_settings')) {
        const requestUrl = new URL(req.url, `http://${req.headers.host}`);
        const fileName = requestUrl.searchParams.get('file');
        const allowedFiles = ['network_settings.json', 'main_display.json', 'setup_menu.json', 'ethernet_setup.json', 'clock_setup.json', 'oat_setup.json', 'tbd_setup.json'];

        if (!fileName || !allowedFiles.includes(fileName)) {
            console.error(`[SAVE ERROR] Attempt to write to an invalid or unspecified file: ${fileName}`);
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            return res.end('Bad Request: Invalid or missing file parameter.');
        }

        let body = '';
        req.on('data', chunk => {
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
