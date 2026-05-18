# img-hosting

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002?logo=hono&logoColor=white)](https://hono.dev/)
[![Wrangler](https://img.shields.io/badge/Wrangler-4.x-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/wrangler/)
[![Vitest](https://img.shields.io/badge/Vitest-2.x-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-43853D?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Tests](https://img.shields.io/badge/tests-20%20passing-success)](#tests)
[![API style](https://img.shields.io/badge/API-Imgur--shaped-1BB76E)](https://apidocs.imgur.com/)
[![Edge runtime](https://img.shields.io/badge/runtime-edge-blueviolet)](https://developers.cloudflare.com/workers/)
[![Made with Claude Code](https://img.shields.io/badge/Made%20with-Claude%20Code-D97757?logo=anthropic&logoColor=white)](https://claude.com/claude-code)
[![Author](https://img.shields.io/badge/by-Lin%20Hsieh--Ting-555?logo=githubpages&logoColor=white)](https://lin.hsiehting.com/about/#en)

> by **[Lin Hsieh-Ting](https://lin.hsiehting.com/about/#en)** · self-hosted, single-key, edge-native image hosting

> 🌐 Language: **English** · [繁體中文](./README.zh-TW.md)

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

### Quickstart

```bash
make bootstrap        # pnpm install + create R2 bucket + create D1
# (paste database_id into wrangler.toml)
make db-remote        # apply schema to remote D1
make secret           # paste your API_KEY
make deploy           # tests + typecheck + wrangler deploy
make install-all      # symlink CLI to ~/bin + skill to ~/.claude/skills
```

`make help` lists every target. The longer form below walks through each step.

### 1. Install

```bash
make install          # or: pnpm install
```

### 2. Cloudflare resources

```bash
# Auth (one time per machine)
pnpm wrangler login

# Create the R2 bucket. Default name in wrangler.toml is "img-hosting";
# rename in wrangler.toml first if you want a different name.
pnpm wrangler r2 bucket create img-hosting

# Create the D1 database. Copy the printed `database_id` into wrangler.toml
# (which you copy from the committed template):
cp wrangler.toml.example wrangler.toml      # gitignored — your real IDs go here
pnpm wrangler d1 create img-hosting         # paste `database_id` into wrangler.toml
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

## Tests

```bash
make test         # vitest against @cloudflare/vitest-pool-workers
make typecheck    # strict tsc --noEmit
make build        # install + typecheck (wrangler bundles src/ at deploy)
```

20 specs cover upload (raw / multipart / urlencoded / JSON+base64), get,
list, count, delete, update, serve (incl. `If-None-Match` 304), auth, and
content-sniff rejection. Tests share an isolated miniflare runtime — no
Cloudflare account needed.

## Resizing notes

`?w=200&h=200&fit=cover&q=80` on `/i/...` is forwarded to Cloudflare's
**image transformations**. You must enable it on the zone (free tier
includes a monthly quota). On `*.workers.dev` URLs transformations don't
apply and the original bytes are returned.

## CLI + Claude skill

The repo ships a self-contained Claude Code skill under [`img-hosting/`](./img-hosting/)
with a thin bash CLI that wraps the API. Install it by symlinking:

```bash
make install-all      # symlinks CLI -> ~/bin and skill -> ~/.claude/skills

# bootstrap config (gitignored)
cp img-hosting/.env.example img-hosting/.env  # then fill in API_KEY + WORKER_URL
```

Usage:

```bash
img-hosting upload screenshot.png
# https://i.example.com/i/Dwql3jX.png

img-hosting md   screenshot.png            # ![screenshot.png](https://...)
img-hosting html screenshot.png            # <img src="..." alt="..." />
img-hosting list --per-page 5              # JSON envelope
img-hosting delete <deletehash>
img-hosting whoami                         # masked config dump
```

When `~/.claude/skills/img-hosting` is in place, Claude Code agents can use
the skill directly — say "upload this png and give me markdown" and the
agent will shell out to the CLI and paste the formatted tag back. See
[`img-hosting/SKILL.md`](./img-hosting/SKILL.md) for the skill manifest.

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
wrangler.toml.example  Committed template (no real IDs)
wrangler.toml          Local config with your real database_id (gitignored)

img-hosting/        Claude Code skill + CLI (`bin/img-hosting`)
  SKILL.md            Skill manifest read by Claude Code
  bin/img-hosting     bash CLI (upload | md | html | list | get | delete | whoami)
  .env.example        Committed template
  .env                Local config (gitignored)
```

## License

MIT.
