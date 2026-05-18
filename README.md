# img-hosting

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/workers/)
[![Cloudflare R2](https://img.shields.io/badge/Cloudflare-R2-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/r2/)
[![Cloudflare D1](https://img.shields.io/badge/Cloudflare-D1-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![Cloudflare Access](https://img.shields.io/badge/Cloudflare-Access-F38020?logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/cloudflare-one/applications/configure-apps/self-hosted-apps/)
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
**Imgur-shaped REST API**, a **minimalism web UI** behind **Cloudflare Access
(OAuth)**, a thin **bash CLI**, and a **Claude Code skill** so AI agents can
upload too. Nothing in the committed repo carries a real account ID; every
secret lives in `.dev.vars` / `wrangler secret` / a gitignored
`wrangler.toml`.

## Architecture

```
                    ┌────────────────────────────────────────────┐
                    │  one Worker, three auth surfaces           │
                    │                                            │
┌──────────────┐    │  ┌──────────────────────────────────────┐  │
│   Browser    │───▶│  │  upload-image.example.com  (Access)  │  │   ←  OAuth-gated
│   (you)      │    │  │     UI, /3/image, /3/account/*       │  │      Web UI
└──────────────┘    │  └──────────────────────────────────────┘  │
                    │                                            │
┌──────────────┐    │  ┌──────────────────────────────────────┐  │
│  CLI / agent │───▶│  │  *.workers.dev  /3/image  (bearer)   │  │   ←  API_KEY only
│              │    │  │     upload from terminal             │  │
└──────────────┘    │  └──────────────────────────────────────┘  │
                    │                                            │
┌──────────────┐    │  ┌──────────────────────────────────────┐  │
│ Anyone with  │───▶│  │  *.workers.dev  /i/:id.png  (open)   │  │   ←  no auth
│  the URL     │    │  │     public image serve               │  │
└──────────────┘    │  └──────────────────────────────────────┘  │
                    │                                            │
                    │  Worker ─┬─▶ R2 bucket   (image bytes)     │
                    │          └─▶ D1 database (metadata)        │
                    └────────────────────────────────────────────┘
```

- **R2** stores the image bytes.
- **D1** stores metadata (id, deletehash, title, mime, dimensions, …).
- **Hono** routes the API.
- **Rate limiting** via Cloudflare's `ratelimit` binding (per IP / per key).
- **Image resizing** via Cloudflare's image transformations (`?w=`, `?h=`,
  `?fit=`, `?q=`) — requires "Transform images" enabled on your zone.

---

# Setup guide

Read top-to-bottom for a first-time install. Each section is independently
re-runnable.

## 1. Prerequisites

- A Cloudflare account (free plan is fine).
- Node ≥ 20 and `pnpm` (`brew install pnpm` or `corepack enable`).
- `wrangler` is pulled in as a dev dep; you don't have to install it globally.
- For the **CLI**, `curl` (built-in on macOS).
- For **Cloudflare Access**, a Cloudflare-managed zone (i.e. you own a domain
  whose nameservers are pointed at Cloudflare).

Clone the repo and install:

```bash
git clone https://github.com/htlin222/img-hosting
cd img-hosting
make install
```

`make help` shows every target.

## 2. Cloudflare resources

You need one R2 bucket and one D1 database. They're free under the limits.

```bash
pnpm wrangler login                         # one-time browser OAuth
make bucket                                 # creates R2 bucket "img-hosting"
make db                                     # creates D1 db; prints database_id
```

**R2 first-time setup gotcha:** R2 needs explicit account-level activation
before the first bucket can be created. Visit
`https://dash.cloudflare.com/<account-id>/r2/overview`, click **Purchase R2**
(actually free under 10 GB), tick **both** consent checkboxes (the second one
authorizes overage billing — $0 unless you blow past the free tier), then
re-run `make bucket`.

Take the printed `database_id` and put it into your **local**
`wrangler.toml`:

```bash
cp wrangler.toml.example wrangler.toml      # the local copy is gitignored
$EDITOR wrangler.toml                       # paste database_id
```

Then apply the schema to the remote D1:

```bash
make db-remote
```

## 3. API_KEY secret

The bearer token that authenticates the CLI and any non-Access caller.
Generate one and set it on the Worker:

```bash
make secret
# pastes the value into the prompt; openssl rand -hex 32 is fine
```

For local dev, mirror the same key into `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
$EDITOR .dev.vars                           # paste API_KEY=...
```

For client scripts that want a single source of truth, mirror it into
`.env` too (also gitignored):

```bash
cp .env.example .env
# API_KEY=...   WORKER_URL=https://your-subdomain.workers.dev
```

## 4. First deploy

```bash
make deploy
```

`make deploy` runs `pnpm test` + `pnpm typecheck` first (use `deploy-fast`
to skip). After deploy, Cloudflare prints your `*.workers.dev` URL. Sanity
check:

```bash
make smoke
# expects: GET /healthz -> 200, POST /3/image without auth -> 401
```

You now have a working private image host on `*.workers.dev`. Read on for
the rest.

## 5. CLI + Claude skill

```bash
make install-all                            # symlinks ~/bin and ~/.claude/skills
cp img-hosting/.env.example img-hosting/.env
$EDITOR img-hosting/.env                    # paste API_KEY + WORKER_URL
```

Try it:

```bash
img-hosting upload screenshot.png
# https://your-subdomain.workers.dev/i/Dwql3jX.png

img-hosting md   screenshot.png             # ![screenshot.png](https://...)
img-hosting html screenshot.png             # <img src="..." alt="..." />
img-hosting list --per-page 5               # JSON envelope
img-hosting delete <deletehash>
img-hosting whoami                          # masked config dump
```

Claude Code agents pick the skill up automatically once
`~/.claude/skills/img-hosting` exists — say "upload this png and give me
markdown" and the agent will shell out to the CLI.

If `~/bin` isn't already on `PATH`, add it:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zprofile && source ~/.zprofile
```

## 6. (Optional) Custom domain + Cloudflare Access for the web UI

The Worker already serves a minimalism upload UI at `/` (drop or paste an
image, click-to-copy URL / Markdown / HTML / deletehash). On
`*.workers.dev` it requires the API key as a one-time login. To replace
that with **real OAuth via Google / GitHub / Email PIN**, put Cloudflare
Access in front of a custom domain. Four parts:

### 6.1 Attach the custom domain

In **Workers & Pages → img-hosting → Settings → Domains & Routes** click
**Add → Custom Domain**, enter e.g. `upload-image.example.com`, save.
Cloudflare creates the DNS record and provisions the cert in ~30 s.

### 6.2 Create the Zero Trust Access application

Open **Zero Trust → Access controls → Applications → Add an
application → Self-hosted**.

- **Application name:** `img-hosting`
- **Destination type:** `Public DNS`
- **Subdomain / Domain:** `upload-image` / `example.com`
- **Session duration:** whatever you like (24 h is fine)
- **Identity providers:** the ones you've set up — Google / GitHub / generic
  OIDC / Email One-Time PIN.

On the **Policy** step:

- Action: **Allow**
- Rule: **Emails** = your sign-in email

Save the application. From the application detail page, copy the
**Application Audience (AUD) Tag** (a 64-character hex string, no dashes).
Also note your team subdomain — it's the `*.cloudflareaccess.com`
hostname shown in your Zero Trust URL.

### 6.3 Wire the env vars into the Worker

In your **gitignored** `wrangler.toml`:

```toml
[vars]
PUBLIC_BASE_URL = "https://your-subdomain.workers.dev"     # see 6.4
ACCESS_TEAM     = "your-team"                              # without .cloudflareaccess.com
ACCESS_AUD      = "abc123…64hex…"                          # from 6.2
```

```bash
make deploy-fast
```

### 6.4 Why `PUBLIC_BASE_URL` points back at `workers.dev`

Cloudflare Access gates **every path** on the custom domain — including
`/i/:id.png`. If you served public image bytes from the custom domain,
anyone you shared a URL with would hit a login wall.

The fix is to keep image bytes on the workers.dev hostname:

```
Custom domain (Access):    upload-image.example.com/        → UI + upload (you)
workers.dev (no auth):     img-hosting.<...>.workers.dev/i/ → public image bytes
```

`PUBLIC_BASE_URL` controls the `link` field in API responses. Pointing it
at `workers.dev` ensures every URL you copy from the UI bypasses Access
for the viewer. If you'd rather everything live on one hostname, add an
**Access Bypass policy** scoped to `Path: /i/*` (Allow → Everyone) so
public image bytes stay open even on the Access-protected domain.

### 6.5 Verify

Browse to `https://upload-image.example.com/`. You should hit
Cloudflare's login screen, sign in, and land on the UI with your **email
in the top-right corner** (not "bearer") — no API key prompt. Upload
something; the returned URL should point at `workers.dev`.

## 7. Local development

```bash
make dev                                    # http://127.0.0.1:8787
make db-local                               # one-time: apply schema to local D1
```

`wrangler dev` reads `.dev.vars` for `API_KEY`. Access env vars are
ignored in local dev (no JWT injection in a local runtime).

```bash
make test                                   # 20 vitest specs
make typecheck                              # tsc --noEmit, strict
```

---

# Reference

## API

All endpoints return Imgur's response envelope:

```json
{ "data": { ... }, "success": true, "status": 200 }
```

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/3/image` | Bearer **or** Access | multipart (`image` file), raw bytes, urlencoded base64, or JSON `{image, type:"base64"}` |
| `GET` | `/3/image/:id` | public | metadata only |
| `POST` | `/3/image/:deletehash` | Bearer **or** Access | update `title` / `description` |
| `DELETE` | `/3/image/:deletehash` | Bearer **or** Access | soft-delete + R2 delete |
| `GET` | `/3/account/me/images` | Bearer **or** Access | `?page=0&perPage=50` |
| `GET` | `/3/account/me/images/count` | Bearer **or** Access | |
| `GET` | `/3/account/me/image/:id` | Bearer **or** Access | includes `deletehash` |
| `GET` | `/i/:id.:ext` | public | serves the image bytes; `?w=`, `?h=`, `?fit=`, `?q=` resize |
| `GET` | `/whoami` | Bearer **or** Access | identity probe for the UI |
| `GET` | `/healthz` | public | |
| `GET` | `/` | public | UI (text/html) or endpoint list (JSON) |

### Upload examples

```bash
# raw
curl -X POST -H "Authorization: Bearer $API_KEY" \
     --data-binary @cat.jpg https://your-host/3/image

# multipart
curl -X POST -H "Authorization: Bearer $API_KEY" \
     -F image=@cat.jpg -F title="my cat" \
     https://your-host/3/image

# JSON + base64
curl -X POST -H "Authorization: Bearer $API_KEY" \
     -H "Content-Type: application/json" \
     -d "{\"image\":\"$(base64 -i cat.jpg)\",\"type\":\"base64\"}" \
     https://your-host/3/image
```

## Resizing

`/i/...?w=200&h=200&fit=cover&q=80` is forwarded to Cloudflare's
**image transformations**. You must enable that on the zone (free tier
includes a monthly quota). On `*.workers.dev` URLs transformations don't
apply and the original bytes are returned.

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

---

# Project layout

```
src/
  index.ts          Hono router; mounts ui / images / account / serve
  env.ts            Bindings type (incl. ACCESS_TEAM/ACCESS_AUD)
  auth.ts           requireAuth: tries Access JWT, falls back to bearer
  access.ts         RS256 JWT verification against the team's JWKS
  ids.ts            base62 id + sha256
  sniff.ts          PNG/JPEG/GIF/WebP magic-bytes + dims
  response.ts       Imgur envelope helpers
  ratelimit.ts      RL binding wrapper
  resize.ts         cf.image fetch options
  images.ts         POST/GET/DELETE/UPDATE /3/image
  account.ts        /3/account/me/*
  serve.ts          /i/:filename and /raw/:filename
  ui.ts             single-page minimalism web UI
test/               Vitest + @cloudflare/vitest-pool-workers
schema.sql          D1 schema (canonical)
migrations/         Wrangler-managed D1 migrations (mirror of schema.sql)
wrangler.toml.example  Committed template (no real IDs)
wrangler.toml          Local config with real IDs + AUD (gitignored)

img-hosting/        Claude Code skill + CLI (`bin/img-hosting`)
  SKILL.md            Skill manifest read by Claude Code
  bin/img-hosting     bash CLI (upload | md | html | list | get | delete | whoami)
  .env.example        Committed template
  .env                Local config (gitignored)

Makefile            Single entry-point: make help lists every target
```

---

# Troubleshooting

**`make bucket` fails with `Please enable R2 through the Cloudflare Dashboard`**
→ See §2 R2 first-time setup. You need both consent checkboxes on the R2
activation screen.

**`make db-remote` fails with `database_id is required`**
→ You haven't pasted the `database_id` from `wrangler d1 create` into
your local `wrangler.toml` yet.

**UI keeps asking for the API key even though I signed in via Access**
→ Either the Worker doesn't have `ACCESS_TEAM` / `ACCESS_AUD` set, or
your browser is loading the workers.dev URL instead of the custom-domain
URL (Access only gates the custom domain). Hard-refresh
(Cmd-Shift-R) on the custom-domain URL.

**Shared image URLs return a Cloudflare Access login screen**
→ You set `PUBLIC_BASE_URL` to the custom domain. Either change it back
to the `workers.dev` URL (see §6.4) or add an Access **Bypass** policy
scoped to `Path: /i/*`.

**CLI returns 401 after a fresh `wrangler secret put API_KEY`**
→ Your local `.env` / `.dev.vars` is out of sync with the new secret.
Update them and re-source.

**Tests fail with `readFileSync is not yet implemented in Workers`**
→ You're trying to read a file from the test runtime. Inline fixtures
in `test/helpers.ts`; the Workers test runtime has no Node `fs`.

---

## License

MIT.
