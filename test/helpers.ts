import { env } from 'cloudflare:test';

// Schema is inlined because the Worker test runtime doesn't expose Node's
// `fs`. Kept in sync with schema.sql (the canonical source) and
// migrations/0001_init.sql.
const SCHEMA_STATEMENTS: ReadonlyArray<string> = [
  `CREATE TABLE IF NOT EXISTS images (
    id           TEXT PRIMARY KEY,
    deletehash   TEXT UNIQUE NOT NULL,
    owner        TEXT NOT NULL,
    filename     TEXT,
    title        TEXT,
    description  TEXT,
    mime         TEXT NOT NULL,
    ext          TEXT NOT NULL,
    size         INTEGER NOT NULL,
    width        INTEGER,
    height       INTEGER,
    sha256       TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    deleted_at   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_images_owner_created
    ON images(owner, created_at DESC)
    WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_images_sha
    ON images(sha256)`,
];

export const applySchema = async () => {
  for (const stmt of SCHEMA_STATEMENTS) {
    await env.IMG_DB.exec(stmt.replace(/\s+/g, ' ').trim());
  }
};

export const resetState = async () => {
  await env.IMG_DB.exec('DELETE FROM images');
  const list = await env.IMG_BUCKET.list();
  if (list.objects.length === 0) return;
  await env.IMG_BUCKET.delete(list.objects.map((o) => o.key));
};

// Minimal valid PNG (1x1 red pixel).
export const tinyPng = (): Uint8Array => {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export const AUTH = { Authorization: 'Bearer test-api-key' };
