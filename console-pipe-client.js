/**
 * Browser → disk console pipe: ON automatically when the page is served by tools/dev-server.mjs (npm start).
 *
 * Detection: GET /__tstat_dev_probe returns 204 only on the Tstat dev server. Plain static servers (Python, Live Server)
 * get 404 and the pipe never installs — no POST /log, no console spam.
 *
 * Override base URL: localStorage CONSOLE_PIPE_URL (e.g. http://127.0.0.1:8787) for file:// pages or custom port.
 *
 * Disable: ?consolePipe=0  or  localStorage.setItem('TSTAT_CONSOLE_PIPE','0')
 * Force on without probe (rare): ?consolePipe=1  or  localStorage.setItem('TSTAT_CONSOLE_PIPE','1')
 *
 * Each POST body includes level, text, timestamp, pathname, document title, and a per-tab session id (`sid`);
 * the server appends **`logs/browser-console.log`** (human) and **`logs/browser-console.jsonl`** (NDJSON). See **`docs/console-pipe.md`**.
 */
(function () {
    try {
        try {
            var qOff = new URLSearchParams(window.location.search || '');
            if (qOff.get('consolePipe') === '0') return;
        } catch {}
        try {
            if (window.localStorage.getItem('TSTAT_CONSOLE_PIPE') === '0') return;
        } catch {}

        var customBase = null;
        try {
            customBase = window.localStorage.getItem('CONSOLE_PIPE_URL');
        } catch {}

        function probeEndpoint() {
            if (customBase) return customBase.replace(/\/$/, '') + '/__tstat_dev_probe';
            if (location.protocol === 'file:') return 'http://127.0.0.1:8787/__tstat_dev_probe';
            return '/__tstat_dev_probe';
        }

        function logEndpoint() {
            if (customBase) return customBase.replace(/\/$/, '') + '/log';
            if (location.protocol === 'file:') return 'http://127.0.0.1:8787/log';
            return '/log';
        }

        var forceOn = false;
        try {
            var q = new URLSearchParams(window.location.search || '');
            if (q.get('consolePipe') === '1') forceOn = true;
        } catch {}
        try {
            if (window.localStorage.getItem('TSTAT_CONSOLE_PIPE') === '1') forceOn = true;
        } catch {}

        function installPipe() {
            var endpoint = logEndpoint();

            function serialize(arg) {
                if (arg instanceof Error) return arg.stack || arg.message;
                if (typeof arg === 'object' && arg !== null) {
                    try {
                        return JSON.stringify(arg);
                    } catch {
                        return String(arg);
                    }
                }
                return String(arg);
            }

            var pipeState = 'unknown';
            var probeInFlight = false;

            function disablePipe(reason) {
                if (pipeState === 'dead') return;
                pipeState = 'dead';
                probeInFlight = false;
                try {
                    window.sessionStorage.setItem('TSTAT_CONSOLE_PIPE_DEAD', '1');
                } catch {}
                if (reason && typeof console._originalLog === 'function') {
                    try {
                        console._originalLog('[console-pipe] disabled: ' + reason);
                    } catch {}
                }
            }

            function postLog(body) {
                return fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: body,
                    mode: 'cors',
                    keepalive: true
                });
            }

            function logSessionId() {
                try {
                    var k = 'TSTAT_LOG_SID';
                    var s = window.sessionStorage.getItem(k);
                    if (!s) {
                        s = 's' + Math.random().toString(36).slice(2, 12);
                        window.sessionStorage.setItem(k, s);
                    }
                    return s;
                } catch {
                    return '';
                }
            }

            function send(level, args) {
                if (pipeState === 'dead') return;
                var text = Array.prototype.map.call(args, serialize).join(' ');
                var pathname = '';
                var title = '';
                try {
                    pathname = window.location.pathname || '';
                } catch {}
                try {
                    title = document.title || '';
                } catch {}
                var body = JSON.stringify({
                    level: level,
                    text: text,
                    t: Date.now(),
                    pathname: pathname,
                    title: title,
                    sid: logSessionId()
                });
                if (typeof fetch !== 'function') return;

                if (pipeState === 'unknown') {
                    if (probeInFlight) return;
                    probeInFlight = true;
                    postLog(body)
                        .then(function (res) {
                            probeInFlight = false;
                            if (res && res.ok) {
                                pipeState = 'ok';
                            } else {
                                disablePipe(
                                    res
                                        ? 'POST /log returned ' + res.status
                                        : 'no response'
                                );
                            }
                        })
                        .catch(function () {
                            probeInFlight = false;
                            disablePipe('network error (log pipe unreachable)');
                        });
                    return;
                }

                if (pipeState !== 'ok') return;
                postLog(body)
                    .then(function (res) {
                        if (!res || !res.ok) {
                            disablePipe(res ? 'POST /log returned ' + res.status : 'no response');
                        }
                    })
                    .catch(function () {
                        disablePipe('network error (log pipe unreachable)');
                    });
            }

            ['log', 'info', 'warn', 'error', 'debug'].forEach(function (m) {
                var orig = console[m];
                if (typeof orig !== 'function') return;
                if (m === 'log' && typeof console._originalLog !== 'function') {
                    console._originalLog = orig;
                }
                console[m] = function () {
                    send(m, arguments);
                    return orig.apply(console, arguments);
                };
            });

            window.addEventListener('error', function (e) {
                send('error', [e.message, e.filename + ':' + e.lineno + ':' + e.colno]);
            });
            window.addEventListener('unhandledrejection', function (e) {
                send('error', ['unhandledrejection', serialize(e.reason)]);
            });
        }

        if (forceOn) {
            try {
                window.sessionStorage.removeItem('TSTAT_CONSOLE_PIPE_DEAD');
            } catch {}
            installPipe();
            return;
        }

        if (typeof fetch !== 'function') return;

        fetch(probeEndpoint(), { method: 'GET', cache: 'no-store', mode: 'cors' })
            .then(function (res) {
                if (!res || !res.ok) return;
                try {
                    window.sessionStorage.removeItem('TSTAT_CONSOLE_PIPE_DEAD');
                } catch {}
                installPipe();
            })
            .catch(function () {});
    } catch {
        /* ignore */
    }
})();
