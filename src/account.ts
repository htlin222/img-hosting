import { Hono } from 'hono';
import type { Env } from './env';
import { requireBearer } from './auth';
import { rateLimit } from './ratelimit';
import { ok, fail } from './response';
import { type ImageRow, toImgurShape } from './images';

const OWNER = 'me';

// Account endpoints always include the deletehash (per the API contract).
const shape = (row: ImageRow, c: { env: Env; req: { url: string } }) =>
  toImgurShape(row, c, true);

export const accountApp = new Hono<{ Bindings: Env }>();

// GET /3/account/me/images?page=&perPage=
accountApp.get('/3/account/me/images', rateLimit('read'), requireBearer, async (c) => {
  const page = Math.max(0, parseInt(c.req.query('page') ?? '0', 10) || 0);
  const perPage = Math.max(1, Math.min(100, parseInt(c.req.query('perPage') ?? '50', 10) || 50));
  const offset = page * perPage;

  const { results } = await c.env.IMG_DB.prepare(
    `SELECT * FROM images
     WHERE owner = ? AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
  ).bind(OWNER, perPage, offset).all<ImageRow>();

  return ok(c, (results ?? []).map((r) => shape(r, c)));
});

// GET /3/account/me/images/count
accountApp.get('/3/account/me/images/count', rateLimit('read'), requireBearer, async (c) => {
  const row = await c.env.IMG_DB.prepare(
    'SELECT COUNT(*) AS n FROM images WHERE owner = ? AND deleted_at IS NULL',
  ).bind(OWNER).first<{ n: number }>();
  return ok(c, row?.n ?? 0);
});

// GET /3/account/me/image/:id
accountApp.get('/3/account/me/image/:id', rateLimit('read'), requireBearer, async (c) => {
  const row = await c.env.IMG_DB.prepare(
    'SELECT * FROM images WHERE id = ? AND owner = ? AND deleted_at IS NULL',
  ).bind(c.req.param('id'), OWNER).first<ImageRow>();
  if (!row) return fail(c, 404, 'not found');
  return ok(c, shape(row, c));
});
