// Standalone server: the built app (dist/), link previews (/api/unfurl),
// media uploads (/api/upload, /uploads/…, /api/derive) and real-time sync (/sync) on one port. For hosting on a machine on the LAN:
//
//   npm run build && npm run serve      → http://<this machine's IP>:8080
//
// Also what runs on Render (see render.yaml); it honours PORT and DATA_DIR.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { handleUnfurl } from './unfurl.ts';
import { createSyncServer } from './sync.ts';
import { createUploads } from './uploads.ts';
import { createDerive } from './derive.ts';

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
// Where boards are saved. On hosts with a throwaway disk (e.g. Render's free
// tier) this resets on restart; browsers re-upload their own boards on connect.
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'data');
const sync = createSyncServer({ dataFile: join(DATA_DIR, 'server-db.json') });
const uploads = createUploads(join(DATA_DIR, 'uploads'));
const derive = createDerive(join(DATA_DIR, 'uploads'));

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://local');
  if (url.pathname === '/api/unfurl') return void handleUnfurl(req, res);
  if (url.pathname === '/api/upload') return uploads.upload(req, res);
  if (url.pathname.startsWith('/uploads/')) return uploads.serve(req, res);
  if (url.pathname === '/api/derive') return derive.handle(req, res);

  // Static files from dist/, falling back to index.html (the app routes itself).
  const path = normalize(join(DIST, decodeURIComponent(url.pathname)));
  const file = path.startsWith(DIST) && existsSync(path) && statSync(path).isFile() ? path : join(DIST, 'index.html');
  if (!existsSync(file)) {
    res.statusCode = 503;
    res.end('Build the app first: npm run build');
    return;
  }
  res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
  if (file.includes(`${join('dist', 'assets')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  createReadStream(file).pipe(res);
});

server.on('upgrade', (req, socket, head) => {
  if (!sync.handleUpgrade(req, socket, head)) socket.destroy();
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i!.address}:${PORT}`);
  console.log(`Heist Workspace on http://localhost:${PORT}`);
  for (const u of lan) console.log(`  on the network: ${u}`);
});
