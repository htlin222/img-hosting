import { Hono } from 'hono';
import type { Env } from './env';
import { rateLimit } from './ratelimit';
import { parseResizeQuery, resizeViaCf } from './resize';

type ImageRow = {
  id: string;
  ext: string;
  mime: string;
  deleted_at: number | null;
};

const cacheHeaders = (etag: string): Record<string, string> => ({
  'Cache-Control': 'public, max-age=31536000, immutable',
  ETag: etag,
});

export const serveApp = new Hono<{ Bindings: Env }>();

// GET /i/:filename  (e.g. /i/abc1234.jpg)
serveApp.get('/i/:filename', rateLimit('serve'), async (c) => {
  const filename = c.req.param('filename') ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot < 1) return c.text('not found', 404);
  const id = filename.slice(0, dot);
  const requestedExt = filename.slice(dot + 1).toLowerCase();

  const row = await c.env.IMG_DB.prepare(
    'SELECT id, ext, mime, deleted_at FROM images WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<ImageRow>();
  if (!row) return c.text('not found', 404);
  if (row.ext !== requestedExt) return c.text('not found', 404);

  const opts = parseResizeQuery(c);
  if (opts) {
    // Delegate to Cloudflare image transformations. If the zone has them
    // enabled the response will be resized; otherwise CF returns the raw
    // bytes from /raw/<id>.<ext>.
    const url = new URL(c.req.url);
    const origin = c.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || url.origin;
    return resizeViaCf(origin, `/raw/${id}.${row.ext}`, opts);
  }

  const obj = await c.env.IMG_BUCKET.get(`img/${id}.${row.ext}`);
  if (!obj) return c.text('not found', 404);

  const etag = obj.httpEtag;
  const ifNoneMatch = c.req.header('if-none-match');
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders(etag) });
  }

  return new Response(obj.body, {
    status: 200,
    headers: {
      ...cacheHeaders(etag),
      'Content-Type': row.mime,
      'Content-Length': String(obj.size),
    },
  });
});

// GET /raw/:filename - internal endpoint for cf.image resizing to fetch from.
// Identical bytes to /i/ but bypasses the resize branch to avoid loops.
// It is publicly reachable, so it must carry the same rate limit as /i/ —
// otherwise it is a free, unmetered bypass of the /i/ serve limit.
serveApp.get('/raw/:filename', rateLimit('serve'), async (c) => {
  const filename = c.req.param('filename') ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot < 1) return c.text('not found', 404);
  const id = filename.slice(0, dot);
  const requestedExt = filename.slice(dot + 1).toLowerCase();

  const row = await c.env.IMG_DB.prepare(
    'SELECT id, ext, mime, deleted_at FROM images WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<ImageRow>();
  if (!row || row.ext !== requestedExt) return c.text('not found', 404);

  const obj = await c.env.IMG_BUCKET.get(`img/${id}.${row.ext}`);
  if (!obj) return c.text('not found', 404);

  return new Response(obj.body, {
    status: 200,
    headers: {
      ...cacheHeaders(obj.httpEtag),
      'Content-Type': row.mime,
      'Content-Length': String(obj.size),
    },
  });
});
