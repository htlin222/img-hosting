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

// Build the response we return AND, best-effort, stash an independent copy in
// the edge cache so repeat hits skip the D1 lookup and the R2 read entirely.
//
// We deliberately do NOT `res.clone()` a live R2/fetch stream: tee'ing a body
// whose two branches drain at different rates leaves dangling stream pumps
// (and stalls the runtime under load). Buffering the bytes once and minting two
// independent Responses from the same ArrayBuffer sidesteps that entirely. The
// caller has already read the object size cap (MAX_BYTES) so this is bounded.
const serveAndCache = (
  c: { executionCtx: ExecutionContext; req: { raw: Request } },
  bytes: ArrayBuffer,
  init: ResponseInit,
): Response => {
  c.executionCtx.waitUntil(
    caches.default.put(c.req.raw, new Response(bytes, init)).catch(() => {}),
  );
  return new Response(bytes, init);
};

export const serveApp = new Hono<{ Bindings: Env }>();

// GET /i/:filename  (e.g. /i/abc1234.jpg)
serveApp.get('/i/:filename', rateLimit('serve'), async (c) => {
  const filename = c.req.param('filename') ?? '';
  const dot = filename.lastIndexOf('.');
  if (dot < 1) return c.text('not found', 404);
  const id = filename.slice(0, dot);
  const requestedExt = filename.slice(dot + 1).toLowerCase();

  // Serve from the edge cache when possible, skipping D1 + R2. Revalidation
  // requests (If-None-Match) bypass the cache so the 304 path below still runs.
  const revalidating = c.req.header('if-none-match');
  if (!revalidating) {
    const hit = await caches.default.match(c.req.raw);
    if (hit) return hit;
  }

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
    const resized = await resizeViaCf(origin, `/raw/${id}.${row.ext}`, opts);
    if (!resized.ok) return resized;
    return serveAndCache(c, await resized.arrayBuffer(), {
      status: 200,
      headers: resized.headers,
    });
  }

  const obj = await c.env.IMG_BUCKET.get(`img/${id}.${row.ext}`);
  if (!obj) return c.text('not found', 404);

  const etag = obj.httpEtag;
  if (revalidating && revalidating === etag) {
    return new Response(null, { status: 304, headers: cacheHeaders(etag) });
  }

  return serveAndCache(c, await obj.arrayBuffer(), {
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

  const hit = await caches.default.match(c.req.raw);
  if (hit) return hit;

  const row = await c.env.IMG_DB.prepare(
    'SELECT id, ext, mime, deleted_at FROM images WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<ImageRow>();
  if (!row || row.ext !== requestedExt) return c.text('not found', 404);

  const obj = await c.env.IMG_BUCKET.get(`img/${id}.${row.ext}`);
  if (!obj) return c.text('not found', 404);

  return serveAndCache(c, await obj.arrayBuffer(), {
    status: 200,
    headers: {
      ...cacheHeaders(obj.httpEtag),
      'Content-Type': row.mime,
      'Content-Length': String(obj.size),
    },
  });
});
