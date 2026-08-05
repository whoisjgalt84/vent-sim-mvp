/**
 * Static file server for local development and the test harnesses.
 *
 *   node tools/serve.mjs [port]        # default 8899
 *   npm run serve
 *
 * Replaces `python3 -m http.server 8899`, which is not portable: on Windows
 * `python3` is usually not a real command, and Windows ships a `python3.exe`
 * App Execution Alias that opens the Microsoft Store instead of running
 * anything — so the Playwright webServer would hang rather than fail cleanly.
 * Node is already required to run the tests, so this has no new dependency.
 *
 * Deliberately minimal: no caching headers, no compression, no directory
 * listing. It exists to serve this repo's static files to a browser on
 * localhost and nothing else. Do not grow it into a framework.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8899);
const HOST = process.env.HOST ?? '127.0.0.1';

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.mjs':  'text/javascript; charset=utf-8',
    '.cjs':  'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.md':   'text/markdown; charset=utf-8',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.ico':  'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
    // Strip the query string BEFORE resolving the path. Every local asset in
    // this repo is requested with a `?v=` cache-bust (CLAUDE.md §4.7), so a
    // server that forgets this 404s the entire app.
    const url = new URL(req.url, `http://${req.headers.host ?? HOST}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname.endsWith('/')) pathname += 'index.html';

    // Contain the resolved path inside ROOT — no `..` escapes.
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT.endsWith(sep) ? ROOT : ROOT + sep)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        return res.end('403 Forbidden');
    }

    try {
        const info = await stat(filePath);
        if (info.isDirectory()) {
            res.writeHead(301, { Location: `${pathname.replace(/\/$/, '')}/` });
            return res.end();
        }
        res.writeHead(200, {
            'Content-Type': TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
            'Content-Length': info.size,
            // Never cache: the whole point of the ?v= discipline is that a
            // stale asset is a silent failure. Local dev should never see one.
            'Cache-Control': 'no-store',
        });
        createReadStream(filePath).pipe(res);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 Not Found');
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Serving ${ROOT} at http://${HOST}:${PORT}/`);
});

// Playwright's webServer sends SIGTERM; exit promptly so the run doesn't hang.
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => server.close(() => process.exit(0)));
}
