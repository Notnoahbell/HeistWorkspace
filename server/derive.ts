// What we work out from an uploaded video with ffprobe / ffmpeg: its real
// frame rate, length and size, a poster frame, a filmstrip (for hover-scrub on
// cards), and, when the original won't play well in a browser (ProRes, HEVC,
// bigger than 1080p, very high bitrate), a 720p H.264 proxy to play instead.
//
//   GET /api/derive?src=/uploads/<file>
//     → { status: 'ready' | 'working' | 'unavailable', fps, duration, width, height, poster, strip, proxy }
//
// Results sit next to the upload (<id>.derived.json, .poster.jpg, .strip.jpg,
// .proxy.mp4), so each file is done once. The proxy can take a while: until
// it's made, `status` is 'working' and `proxy` is 'pending'; ask again. Without
// ffmpeg on the machine (or FFMPEG_PATH / FFPROBE_PATH), status is 'unavailable'.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';
/** Frames in a filmstrip, and how wide each one is. */
const STRIP_FRAMES = 24;
const STRIP_WIDTH = 160;
/** ffmpeg jobs at once (the rest wait their turn). */
const MAX_JOBS = 2;
/** Codecs every browser we care about plays. */
const PLAYABLE = new Set(['h264', 'vp8', 'vp9', 'av1']);

export interface Derived {
  status: 'ready' | 'working' | 'unavailable';
  fps?: number;
  duration?: number;
  width?: number;
  height?: number;
  poster?: string;
  strip?: { url: string; frames: number; w: number; h: number };
  /** A browser-friendly copy to play instead; 'pending' while it's being made; null when the original is fine. */
  proxy?: string | 'pending' | null;
  error?: string;
}

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

/** Run a program; resolves with stdout/stderr, rejects if it can't start or exits non-zero. */
function run(cmd: string, args: string[]): Promise<{ out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; if (err.length > 200_000) err = err.slice(-100_000); });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

/** "30000/1001" → 29.97 (2 decimals); snaps to the usual rates. */
function parseRate(r: string | undefined): number | undefined {
  if (!r) return undefined;
  const [a, b] = r.split('/').map(Number);
  const v = b ? a / b : a;
  if (!Number.isFinite(v) || v <= 0 || v > 240) return undefined;
  for (const std of [23.976, 24, 25, 29.97, 30, 47.952, 48, 50, 59.94, 60, 120]) if (Math.abs(v - std) < 0.02) return std;
  return Math.round(v * 100) / 100;
}

// A small queue so a burst of uploads doesn't start ten encoders at once.
let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_JOBS) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await job(); } finally { running--; waiting.shift()?.(); }
}

export function createDerive(dir: string) {
  /** In progress, by file id. */
  const jobs = new Map<string, Derived>();
  let missing = false; // ffmpeg isn't there

  const paths = (id: string) => ({
    file: (ext: string) => join(dir, `${id}.${ext}`),
    record: join(dir, `${id}.derived.json`),
    poster: join(dir, `${id}.poster.jpg`),
    strip: join(dir, `${id}.strip.jpg`),
    proxy: join(dir, `${id}.proxy.mp4`),
  });

  async function work(id: string, ext: string) {
    const p = paths(id);
    const src = p.file(ext);
    const state: Derived = { status: 'working' };
    jobs.set(id, state);
    try {
      // What it is.
      const probe = JSON.parse((await run(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', src])).out);
      const v = (probe.streams ?? []).find((s: { codec_type: string }) => s.codec_type === 'video');
      if (!v) throw new Error('no video stream');
      let duration = Number(probe.format?.duration ?? v.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        // Some files (e.g. recorded WebM) don't say; read through to find out.
        const { err } = await run(FFMPEG, ['-v', 'info', '-i', src, '-map', '0:v:0', '-c', 'copy', '-f', 'null', '-']);
        const times = [...err.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
        const last = times[times.length - 1];
        duration = last ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3]) : 0;
      }
      Object.assign(state, {
        fps: parseRate(v.r_frame_rate) ?? parseRate(v.avg_frame_rate),
        duration: duration || undefined,
        width: v.width, height: v.height,
      });
      const bitrate = Number(probe.format?.bit_rate ?? 0);
      const needsProxy = !PLAYABLE.has(String(v.codec_name)) || (v.height ?? 0) > 1080 || bitrate > 12_000_000;
      state.proxy = needsProxy ? 'pending' : null;

      // Poster (a little way in, past any fade from black) and filmstrip.
      await slot(async () => {
        const at = duration ? Math.min(duration * 0.1, 2) : 0;
        await run(FFMPEG, ['-v', 'error', '-y', '-ss', String(at), '-i', src, '-frames:v', '1', '-vf', 'scale=min(1280\\,iw):-2', '-q:v', '3', p.poster]);
        state.poster = `/uploads/${id}.poster.jpg`;
        const every = duration ? duration / STRIP_FRAMES : 1;
        await run(FFMPEG, ['-v', 'error', '-y', '-i', src, '-vf', `fps=1/${every.toFixed(4)},scale=${STRIP_WIDTH}:-2,tile=${STRIP_FRAMES}x1`, '-frames:v', '1', '-q:v', '4', p.strip]);
        const h = v.width && v.height ? Math.round((STRIP_WIDTH * v.height) / v.width / 2) * 2 : 90;
        state.strip = { url: `/uploads/${id}.strip.jpg`, frames: STRIP_FRAMES, w: STRIP_WIDTH, h };
      });
      if (!needsProxy) { state.status = 'ready'; return; }

      await slot(() => run(FFMPEG, [
        '-v', 'error', '-y', '-i', src,
        '-vf', 'scale=-2:min(720\\,ih)', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', p.proxy,
      ]));
      state.proxy = `/uploads/${id}.proxy.mp4`;
      state.status = 'ready';
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') { missing = true; state.status = 'unavailable'; state.error = 'ffmpeg not found'; }
      else { state.status = 'ready'; state.error = String(err.message ?? err).slice(0, 300); if (state.proxy === 'pending') state.proxy = null; }
    } finally {
      if (state.status !== 'unavailable') writeFileSync(p.record, JSON.stringify(state));
      jobs.delete(id);
    }
  }

  function handle(req: IncomingMessage, res: ServerResponse) {
    const src = new URL(req.url ?? '/', 'http://local').searchParams.get('src') ?? '';
    const m = /^\/uploads\/([a-f0-9]{24})\.(mp4|webm|mov)$/.exec(src);
    if (!m) return json(res, 400, { error: 'src must be an uploaded video' });
    const [, id, ext] = m;
    if (!existsSync(paths(id).file(ext))) return json(res, 404, { error: 'no such upload' });
    if (missing) return json(res, 200, { status: 'unavailable' } satisfies Derived);
    const done = paths(id).record;
    if (existsSync(done)) {
      try { return json(res, 200, JSON.parse(readFileSync(done, 'utf8'))); } catch { /* redo below */ }
    }
    const job = jobs.get(id);
    if (job) return json(res, 200, job);
    void work(id, ext);
    return json(res, 200, jobs.get(id) ?? { status: 'working' });
  }

  return { handle };
}
