import { Hono } from 'hono';
import type { Env } from './env';
import { requireBearer } from './auth';
import { rateLimit } from './ratelimit';
import { ok, fail } from './response';

const OWNER = 'me';

type ImageRow = {
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

const shape = (row: ImageRow, c: { env: Env; req: { url: string } }) => ({
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
  deletehash: row.deletehash,
});

export const accountApp = new Hono<{ Bindings: Env }>();

// GET /3/account/me/images?page=&perPage=
accountApp.get('/3/account/me/images', requireBearer, rateLimit('read'), async (c) => {
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
accountApp.get('/3/account/me/images/count', requireBearer, async (c) => {
  const row = await c.env.IMG_DB.prepare(
    'SELECT COUNT(*) AS n FROM images WHERE owner = ? AND deleted_at IS NULL',
  ).bind(OWNER).first<{ n: number }>();
  return ok(c, row?.n ?? 0);
});

// GET /3/account/me/image/:id
accountApp.get('/3/account/me/image/:id', requireBearer, async (c) => {
  const row = await c.env.IMG_DB.prepare(
    'SELECT * FROM images WHERE id = ? AND owner = ? AND deleted_at IS NULL',
  ).bind(c.req.param('id'), OWNER).first<ImageRow>();
  if (!row) return fail(c, 404, 'not found');
  return ok(c, shape(row, c));
});
