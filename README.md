# img-hosting

A private, self-hosted image host that runs on **Cloudflare Workers** with an
**Imgur-shaped REST API**. Bring your own API key in `.dev.vars` /
`wrangler secret`; nothing in this repo contains account-specific IDs.

- **R2** stores the image bytes.
- **D1** stores metadata (id, deletehash, title, mime, dimensions, …).
- **Hono** routes the API.
- **Rate limiting** via Cloudflare's `ratelimit` binding (per IP / per key).
- **Image resizing** via Cloudflare's image transformations (`?w=`, `?h=`,
  `?fit=`, `?q=`) — requires "Transform images" enabled on your zone.

## API

All endpoints return Imgur's response envelope:

```json
{ "data": { ... }, "success": true, "status": 200 }
```

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/3/image` | Bearer | multipart (`image` file), raw bytes, urlencoded base64, or JSON `{image, type:"base64"}` |
| `GET` | `/3/image/:id` | public | metadata only |
| `POST` | `/3/image/:deletehash` | Bearer | update `title` / `description` |
| `DELETE` | `/3/image/:deletehash` | Bearer | soft-delete + R2 delete |
| `GET` | `/3/account/me/images` | Bearer | `?page=0&perPage=50` |
| `GET` | `/3/account/me/images/count` | Bearer | |
| `GET` | `/3/account/me/image/:id` | Bearer | includes `deletehash` |
| `GET` | `/i/:id.:ext` | public | serves the image bytes; `?w=`, `?h=`, `?fit=`, `?q=` resize |
| `GET` | `/healthz` | public | |

### Upload examples

```bash
# raw
curl -X POST -H "Authorization: Bearer $API_KEY" \
     --data-binary @cat.jpg https://i.example.com/3/image

# multipart
curl -X POST -H "Authorization: Bearer $API_KEY" \
     -F image=@cat.jpg -F title="my cat" \
     https://i.example.com/3/image

# JSON + base64
curl -X POST -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"image\":\"$(base64 -i cat.jpg)\",\"type\":\"base64\"}" \
     https://i.example.com/3/image
```

## Setup

> The repo is operator-agnostic: D1 database IDs, R2 bucket names, and your
> custom domain are filled in **locally** during setup. Nothing committed
> here is specific to any account.

### 1. Install

```bash
pnpm install
```

### 2. Cloudflare resources

```bash
# Auth (one time per machine)
pnpm wrangler login

# Create the R2 bucket. Default name in wrangler.toml is "img-hosting";
# rename in wrangler.toml first if you want a different name.
pnpm wrangler r2 bucket create img-hosting

# Create the D1 database. Copy the printed `database_id` into wrangler.toml
# (the empty `database_id = ""` placeholder).
pnpm wrangler d1 create img-hosting
```

Apply the schema to the remote D1:

```bash
pnpm db:remote
```

### 3. Secrets

```bash
# Local dev (creates .dev.vars from the example, then edit it)
cp .dev.vars.example .dev.vars
# put a strong random value:
openssl rand -hex 32

# Production
pnpm wrangler secret put API_KEY
```

### 4. Run

```bash
# local dev
pnpm dev          # http://127.0.0.1:8787
pnpm db:local     # apply schema to the local D1 once

# tests
pnpm test

# deploy
pnpm deploy
```

### 5. Public URL

By default `link` in API responses uses the request origin (your
`*.workers.dev` URL). To use a custom domain:

1. Add a route in the Cloudflare dashboard, e.g. `i.example.com/*` → this Worker.
2. Set `PUBLIC_BASE_URL = "https://i.example.com"` in `wrangler.toml`.
3. Re-deploy.

## Resizing notes

`?w=200&h=200&fit=cover&q=80` on `/i/...` is forwarded to Cloudflare's
**image transformations**. You must enable it on the zone (free tier
includes a monthly quota). On `*.workers.dev` URLs transformations don't
apply and the original bytes are returned.

## Project layout

```
src/
  index.ts          Hono router
  env.ts            Bindings type
  auth.ts           Bearer auth middleware
  ids.ts            base62 id + sha256
  sniff.ts          PNG/JPEG/GIF/WebP magic-bytes + dims
  response.ts       Imgur envelope helpers
  ratelimit.ts      RL binding wrapper
  resize.ts         cf.image fetch options
  images.ts         POST/GET/DELETE/UPDATE /3/image
  account.ts        /3/account/me/*
  serve.ts          /i/:filename and /raw/:filename
test/               Vitest + @cloudflare/vitest-pool-workers
schema.sql          D1 schema (canonical)
migrations/         Wrangler-managed D1 migrations (mirror of schema.sql)
wrangler.toml       Worker config (no real IDs committed)
```

## License

MIT.
