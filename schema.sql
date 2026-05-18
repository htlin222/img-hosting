-- img-hosting D1 schema
-- Apply locally:  pnpm db:local
-- Apply remotely: pnpm db:remote

CREATE TABLE IF NOT EXISTS images (
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
);

CREATE INDEX IF NOT EXISTS idx_images_owner_created
  ON images(owner, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_images_sha
  ON images(sha256);
