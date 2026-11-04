// Photo / GIF / video uploads, stored on disk and served back with range
// support (so videos can seek). A stand-in for real object storage later.
//
//   PUT /api/upload?name=<filename>   body: the file   → { url: "/uploads/<id>.<ext>" }
//   GET /uploads/<id>.<ext>
//
// Each upload also gets <id>.meta.json beside it: who uploaded it, when, and
// its original name (for the admin file manager; never served).
//
// Only common image/video types are accepted. SVG is refused: served from our
// own origin it could run script.

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlink, writeFile } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BYTES = 1024 * 1024 * 1024; // 1 GB

const TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};
const BY_EXT = Object.fromEntries(Object.entries(TYPES).map(([mime, ext]) => [ext, mime]));

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

/** Written beside each upload. */
export interface UploadRecord { name: string; by: string | null; at: number; mime: string; size: number }

export function createUploads(dir: string, identify?: (req: IncomingMessage) => string) {
  mkdirSync(dir, { recursive: true });

  function upload(req: IncomingMessage, res: ServerResponse) {
    if (req.method !== 'PUT' && req.method !== 'POST') return json(res, 405, { error: 'use PUT' });
    const mime = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const ext = TYPES[mime];
    if (!ext) return json(res, 415, { error: 'Only PNG, JPEG, GIF, WebP, AVIF, MP4, WebM or MOV files.' });
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > MAX_BYTES) return json(res, 413, { error: 'Files can be up to 1 GB.' });

    const file = `${randomBytes(12).toString('hex')}.${ext}`;
    const path = join(dir, file);
    const out = createWriteStream(path);
    let size = 0;
    let failed = false;
    const fail = (status: number, error: string) => {
      if (failed) return;
      failed = true;
      out.destroy();
      unlink(path, () => {});
      json(res, status, { error });
    };
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BYTES) { fail(413, 'Files can be up to 1 GB.'); req.destroy(); }
    });
    req.on('error', () => fail(400, 'Upload interrupted.'));
    out.on('error', () => fail(500, 'Could not save the file.'));
    out.on('finish', () => {
      if (failed) return;
      const params = new URL(req.url ?? '/', 'http://local').searchParams;
      const record: UploadRecord = {
        name: (params.get('name') ?? '').slice(0, 200) || file,
        by: identify ? identify(req) : null,
        at: Date.now(),
        mime,
        size,
      };
      writeFile(join(dir, `${file.split('.')[0]}.meta.json`), JSON.stringify(record), () => {});
      json(res, 200, { url: `/uploads/${file}`, size });
    });
    req.pipe(out);
  }

  function serve(req: IncomingMessage, res: ServerResponse) {
    const name = basename(decodeURIComponent(new URL(req.url ?? '/', 'http://local').pathname));
    const mime = BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''];
    const path = join(dir, name);
    if (!mime || !existsSync(path)) {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    const total = statSync(path).size;
    res.setHeader('Content-Type', mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Range requests let videos seek without downloading everything first.
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, total - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), total - 1) : total - 1;
      if (start >= total || start > end) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${total}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(total));
    createReadStream(path).pipe(res);
  }

  return { upload, serve };
}
