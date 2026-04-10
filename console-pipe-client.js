/**
 * Browser → disk pipe (on by default for this project). Requires node tools/console-pipe-server.mjs.
 *
 * Disable: ?consolePipe=0  or  localStorage.setItem('TSTAT_CONSOLE_PIPE','0')
 * Endpoint: same-origin /log (npm start). Override: localStorage CONSOLE_PIPE_URL base.
 */
(function () {
    try {
        var off = false;
        try {
            var q = new URLSearchParams(window.location.search || '');
            if (q.get('consolePipe') === '0') off = true;
        } catch (e) {}
        try {
            if (window.localStorage.getItem('TSTAT_CONSOLE_PIPE') === '0') off = true;
        } catch (e) {}
        if (off) return;

        var customBase = window.localStorage.getItem('CONSOLE_PIPE_URL');
        var endpoint;
        if (customBase) {
            endpoint = customBase.replace(/\/$/, '') + '/log';
        } else if (location.protocol === 'file:') {
            endpoint = 'http://127.0.0.1:8787/log';
        } else {
            endpoint = '/log';
        }

        function serialize(arg) {
            if (arg instanceof Error) return arg.stack || arg.message;
            if (typeof arg === 'object' && arg !== null) {
                try {
                    return JSON.stringify(arg);
                } catch (e) {
                    return String(arg);
                }
            }
            return String(arg);
        }

        function send(level, args) {
            var text = Array.prototype.map.call(args, serialize).join(' ');
            var body = JSON.stringify({ level: level, text: text, t: Date.now() });
            if (typeof fetch === 'function') {
                fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body,
                    mode: 'cors',
                    keepalive: true
                }).catch(function () {});
            }
        }

        ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
            var orig = console[m];
            if (typeof orig !== 'function') return;
            console[m] = function () {
                send(m, arguments);
                return orig.apply(console, arguments);
            };
        });

        window.addEventListener('error', function (e) {
            send('error', [
                e.message,
                e.filename + ':' + e.lineno + ':' + e.colno
            ]);
        });
        window.addEventListener('unhandledrejection', function (e) {
            send('error', ['unhandledrejection', serialize(e.reason)]);
        });
    } catch (e) {
        /* ignore */
    }
})();
