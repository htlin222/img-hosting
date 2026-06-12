import { Buffer } from 'node:buffer';
import { Hono } from 'hono';
import type { Env } from './env';
import { requireBearer } from './auth';
import { rateLimit } from './ratelimit';
import { ok, fail } from './response';
import { newImageId, newDeleteHash, sha256Hex } from './ids';
import { sniffImage } from './sniff';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MiB, matches Imgur free tier-ish cap
// base64 encodes 3 bytes per 4 chars (~33% overhead); plus slack for an
// optional data-URL prefix. Used to reject oversize payloads *before* atob
// allocates the decoded buffer into memory.
export const MAX_B64_CHARS = Math.ceil((MAX_BYTES * 4) / 3) + 256;
const OWNER = 'me';

type BodyError = { error: string; status?: number };

export type ImageRow = {
  id: string;
  deletehash: string;
  owner: string;
  filename: string | null;
  title: string | null;
  description: string | null;
  mime: string;
  ext: string;
  size: number;
  width: number | null;
  height: number | null;
  sha256: string;
  created_at: number;
  deleted_at: number | null;
};

const baseUrl = (c: { env: Env; req: { url: string } }) =>
  c.env.PUBLIC_BASE_URL?.replace(/\/$/, '') || new URL(c.req.url).origin;

export const toImgurShape = (row: ImageRow, c: { env: Env; req: { url: string } }, includeDeleteHash: boolean) => ({
  id: row.id,
  title: row.title,
  description: row.description,
  datetime: row.created_at,
  type: row.mime,
  width: row.width,
  height: row.height,
  size: row.size,
  views: 0,
  link: `${baseUrl(c)}/i/${row.id}.${row.ext}`,
  name: row.filename,
  ...(includeDeleteHash ? { deletehash: row.deletehash } : {}),
});

const readBody = async (req: Request): Promise<{ bytes: Uint8Array; filename: string | null; title: string | null; description: string | null } | BodyError> => {
  const contentType = req.headers.get('content-type') ?? '';
  // multipart
  if (contentType.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const image = form.get('image');
    let bytes: Uint8Array;
    let filename: string | null = null;
    if (image instanceof File) {
      if (image.size > MAX_BYTES) return { error: 'file too large', status: 413 };
      bytes = new Uint8Array(await image.arrayBuffer());
      filename = image.name || null;
    } else if (typeof image === 'string') {
      // base64 in multipart field
      const decoded = decodeBase64(image);
      if ('error' in decoded) return decoded;
      bytes = decoded;
    } else {
      return { error: 'missing `image` field' };
    }
    return {
      bytes,
      filename: (form.get('name') as string | null) ?? filename,
      title: (form.get('title') as string | null) ?? null,
      description: (form.get('description') as string | null) ?? null,
    };
  }
  // application/x-www-form-urlencoded with base64
  if (contentType.startsWith('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const form = new URLSearchParams(text);
    const image = form.get('image');
    if (!image) return { error: 'missing `image` field' };
    const isBase64 = (form.get('type') ?? '').toLowerCase() === 'base64';
    let bytes: Uint8Array;
    if (isBase64) {
      const decoded = decodeBase64(image);
      if ('error' in decoded) return decoded;
      bytes = decoded;
    } else {
      bytes = new TextEncoder().encode(image);
    }
    return {
      bytes,
      filename: form.get('name'),
      title: form.get('title'),
      description: form.get('description'),
    };
  }
  // application/json with base64
  if (contentType.startsWith('application/json')) {
    let body: { image?: string; type?: string; name?: string; title?: string; description?: string };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return { error: 'invalid JSON body' };
    }
    if (!body.image) return { error: 'missing `image` field' };
    let bytes: Uint8Array;
    if ((body.type ?? 'base64').toLowerCase() === 'base64') {
      const decoded = decodeBase64(body.image);
      if ('error' in decoded) return decoded;
      bytes = decoded;
    } else {
      bytes = new TextEncoder().encode(body.image);
    }
    return {
      bytes,
      filename: body.name ?? null,
      title: body.title ?? null,
      description: body.description ?? null,
    };
  }
  // raw bytes
  const buf = await req.arrayBuffer();
  if (buf.byteLength === 0) return { error: 'empty body' };
  if (buf.byteLength > MAX_BYTES) return { error: 'file too large', status: 413 };
  return { bytes: new Uint8Array(buf), filename: null, title: null, description: null };
};

// Standard base64 alphabet with optional `=` padding. We validate explicitly
// because `Buffer.from(.., 'base64')` silently *drops* invalid characters, so
// without this check garbage input would decode to junk bytes instead of a 400.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const decodeBase64 = (s: string): Uint8Array | BodyError => {
  // Strip data URL prefix if present.
  const clean = (s.includes(',') ? s.slice(s.indexOf(',') + 1) : s).replace(/\s+/g, '');
  // Reject before allocating: decoding expands `clean` into a buffer ~3/4 its
  // length, so an oversize string is a memory-pressure vector. Bound the input.
  if (clean.length > MAX_B64_CHARS) return { error: 'file too large', status: 413 };
  if (!BASE64_RE.test(clean)) return { error: 'invalid base64 image' };
  // Buffer.from is a native decode — markedly faster than a JS charCodeAt loop
  // for multi-MB uploads. Copy into a standalone Uint8Array so downstream code
  // isn't handed a view into Node's shared internal buffer pool.
  return new Uint8Array(Buffer.from(clean, 'base64'));
};

export const imagesApp = new Hono<{ Bindings: Env }>();

// ----- POST /3/image -----
imagesApp.post('/3/image', rateLimit('upload'), requireBearer, async (c) => {
  const parsed = await readBody(c.req.raw);
  if ('error' in parsed) return fail(c, parsed.status ?? 400, parsed.error);
  const { bytes, filename, title, description } = parsed;
  if (bytes.byteLength === 0) return fail(c, 400, 'empty image');
  if (bytes.byteLength > MAX_BYTES) return fail(c, 413, 'file too large');

  const sniff = sniffImage(bytes);
  if (!sniff) return fail(c, 415, 'unsupported image type');

  const sha = await sha256Hex(bytes);

  // Dedup on content hash (uses idx_images_sha): if identical bytes are already
  // stored and live, return that object instead of writing a second R2 copy.
  const existing = await c.env.IMG_DB.prepare(
    'SELECT * FROM images WHERE sha256 = ? AND owner = ? AND deleted_at IS NULL LIMIT 1',
  ).bind(sha, OWNER).first<ImageRow>();
  if (existing) return ok(c, toImgurShape(existing, c, true), 200);

  const id = newImageId();
  const deletehash = newDeleteHash();
  const now = Math.floor(Date.now() / 1000);
  const key = `img/${id}.${sniff.ext}`;

  await c.env.IMG_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: sniff.mime },
    customMetadata: { id, sha256: sha },
  });

  try {
    await c.env.IMG_DB.prepare(
      `INSERT INTO images (id, deletehash, owner, filename, title, description, mime, ext, size, width, height, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(id, deletehash, OWNER, filename, title, description, sniff.mime, sniff.ext, bytes.byteLength, sniff.width, sniff.height, sha, now)
      .run();
  } catch (e) {
    // Roll back the R2 write if D1 fails.
    await c.env.IMG_BUCKET.delete(key).catch(() => {});
    throw e;
  }

  const row: ImageRow = {
    id, deletehash, owner: OWNER, filename, title, description,
    mime: sniff.mime, ext: sniff.ext, size: bytes.byteLength,
    width: sniff.width, height: sniff.height, sha256: sha,
    created_at: now, deleted_at: null,
  };
  return ok(c, toImgurShape(row, c, true), 200);
});

// ----- GET /3/image/:id -----
imagesApp.get('/3/image/:id', rateLimit('read'), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.IMG_DB.prepare(
    'SELECT * FROM images WHERE id = ? AND deleted_at IS NULL',
  ).bind(id).first<ImageRow>();
  if (!row) return fail(c, 404, 'not found');
  return ok(c, toImgurShape(row, c, false));
});

// ----- DELETE /3/image/:deletehash -----
imagesApp.delete('/3/image/:deletehash', rateLimit('write'), requireBearer, async (c) => {
  const deletehash = c.req.param('deletehash');
  const row = await c.env.IMG_DB.prepare(
    'SELECT * FROM images WHERE deletehash = ? AND deleted_at IS NULL',
  ).bind(deletehash).first<ImageRow>();
  if (!row) return fail(c, 404, 'not found');

  const now = Math.floor(Date.now() / 1000);
  await c.env.IMG_DB.prepare('UPDATE images SET deleted_at = ? WHERE id = ?')
    .bind(now, row.id).run();
  await c.env.IMG_BUCKET.delete(`img/${row.id}.${row.ext}`).catch(() => {});

  // Best-effort purge of the edge-cached canonical bytes so a delete takes
  // effect promptly. We can only purge URLs we can name: the public base and
  // the request origin, for both /i/ and /raw/. Resized variants (with query
  // strings) are not enumerable here and age out via their immutable TTL —
  // consistent with the existing "immutable, max-age=1y" contract on /i/.
  const origins = new Set(
    [c.env.PUBLIC_BASE_URL?.replace(/\/$/, ''), new URL(c.req.url).origin].filter(
      (o): o is string => Boolean(o),
    ),
  );
  for (const origin of origins) {
    for (const prefix of ['/i/', '/raw/']) {
      c.executionCtx.waitUntil(
        caches.default.delete(`${origin}${prefix}${row.id}.${row.ext}`).catch(() => {}),
      );
    }
  }
  return ok(c, true);
});

// ----- POST /3/image/:deletehash (update title/description) -----
imagesApp.post('/3/image/:deletehash', rateLimit('write'), requireBearer, async (c) => {
  const deletehash = c.req.param('deletehash');
  const row = await c.env.IMG_DB.prepare(
    'SELECT * FROM images WHERE deletehash = ? AND deleted_at IS NULL',
  ).bind(deletehash).first<ImageRow>();
  if (!row) return fail(c, 404, 'not found');

  // Accept either form bodies or JSON. Previously a JSON body silently parsed
  // to nothing, so the request returned success while updating nothing.
  const contentType = c.req.header('content-type') ?? '';
  const fields: Record<string, unknown> = contentType.includes('application/json')
    ? await c.req.json().catch(() => ({}))
    : await c.req.parseBody().catch(() => ({}));
  const title = typeof fields['title'] === 'string' ? fields['title'] : row.title;
  const description = typeof fields['description'] === 'string' ? fields['description'] : row.description;

  await c.env.IMG_DB.prepare(
    'UPDATE images SET title = ?, description = ? WHERE id = ?',
  ).bind(title, description, row.id).run();

  return ok(c, true);
});
