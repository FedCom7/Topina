#!/usr/bin/env node
/**
 * Server statico per lo sviluppo locale — zero dipendenze, zero build.
 *
 * Il sito è una SPA senza bundler (vedi CLAUDE.md): i moduli ES non
 * funzionano da `file://`, serve un server http qualsiasi. Questo esiste solo
 * per non dover ripetere `python3 -m http.server` a mano ogni volta, e per
 * aprire subito `preview.html` — l'hub che sceglie la schermata da vedere
 * (sezione, fase della home, larghezza) senza andare a cercare l'URL giusto.
 *
 * `npm run preview` lo lancia e apre il browser da solo.
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const START_PATH = process.argv[2] || '/preview.html';

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
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.map': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, `http://localhost:${PORT}`);
        // Niente path traversal: normalize() risolve i "..", poi si controlla
        // che il risultato resti dentro ROOT prima di leggerlo da disco.
        let filePath = normalize(join(ROOT, decodeURIComponent(url.pathname)));
        if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
        if (filePath.endsWith('/')) filePath = join(filePath, 'index.html');

        const info = await stat(filePath).catch(() => null);
        if (info?.isDirectory()) filePath = join(filePath, 'index.html');

        const data = await readFile(filePath);
        // Ogni file si rilegge da disco a ogni richiesta (nessuna cache lato
        // server), e no-store dice al browser di non tenersene una copia sua:
        // un salvataggio si vede al refresh successivo, senza mai riavviare
        // questo processo. Va riavviato solo se cambia lo script stesso.
        res.writeHead(200, {
            'Content-Type': MIME[extname(filePath)] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
    }
});

server.listen(PORT, () => {
    const url = `http://localhost:${PORT}${START_PATH}`;
    console.log(`Topina League — dev server su ${url}`);
    const opener = process.platform === 'darwin' ? 'open'
        : process.platform === 'win32' ? 'start ""'
            : 'xdg-open';
    exec(`${opener} ${url}`, () => { /* niente da fare se il browser non parte da solo */ });
});
