---
name: img-hosting
description: Use when the user asks to upload, host, share, or embed a local image (PNG / JPEG / GIF / WebP) on their private Cloudflare-hosted image API. Returns the hosted URL and can format it as ready-to-paste Markdown or HTML for inclusion in docs, READMEs, blog posts, or chat. Also lists or deletes prior uploads via deletehash.
---

# img-hosting

Wraps the operator's private Cloudflare Workers image host (Imgur-shaped API)
behind a single `img-hosting` CLI on `PATH`. Always shell out to the CLI;
never craft the HTTP request by hand or echo the bearer token.

## When to invoke

Trigger whenever the user wants any of:

- A shareable URL for a local image file ("upload this", "host this", "share this png")
- Markdown to drop into a `.md` doc (`![alt](url)`)
- HTML to drop into a page (`<img src="url" alt="..." />`)
- A list of past uploads, or to delete one

If the user simply pastes an image inline without naming a file, ask for the
path first — the CLI uploads files from disk.

## CLI cheat sheet

| Goal | Command |
|---|---|
| Get just the hosted URL | `img-hosting upload PATH` |
| Markdown image tag | `img-hosting md PATH` |
| HTML `<img>` tag | `img-hosting html PATH` |
| Full JSON response | `img-hosting upload --json PATH` |
| List uploads (paginated) | `img-hosting list [--page N] [--per-page M]` |
| Single image metadata | `img-hosting get ID` |
| Delete by deletehash | `img-hosting delete DELETEHASH` |
| Count uploads | `img-hosting count` |
| Show effective config (masked) | `img-hosting whoami` |

Add `--title "..."` and/or `--description "..."` to `upload`/`md`/`html` to
attach metadata. Use `--alt "..."` on `md`/`html` to override the alt text
(defaults to the filename).

`PATH` can be `-` to read bytes from stdin (no metadata sniffing for the
filename in that case).

## Typical flows

### 1. Insert a screenshot into a markdown doc

```bash
img-hosting md ~/Desktop/cleanshot-2026-05-18.png
# Output:
# ![cleanshot-2026-05-18.png](https://i.example.com/i/Dwql3jX.png)
```

Paste the line as-is into the markdown. Done.

### 2. Embed in HTML

```bash
img-hosting html ~/Desktop/diagram.png --alt "system diagram"
# <img src="https://i.example.com/i/abc1234.png" alt="system diagram" />
```

### 3. Capture link + deletehash for later cleanup

```bash
img-hosting upload --json ~/Desktop/scratch.png
# Use `jq -r '.data.link, .data.deletehash'` if you need both.
```

### 4. Find and delete a prior upload

```bash
img-hosting list --per-page 5
# Pick the deletehash from the JSON
img-hosting delete <deletehash>
```

## Config

`API_KEY` and `WORKER_URL` come from the first existing source:

1. Process env (`API_KEY`, `WORKER_URL`)
2. `$IMG_HOSTING_ENV` file (explicit override)
3. `<this-skill-dir>/.env`
4. `${XDG_CONFIG_HOME:-~/.config}/img-hosting/.env`
5. `./.env` in cwd

The skill ships `.env.example` and a gitignored `.env`. To bootstrap:

```bash
cp .env.example .env
# edit: API_KEY=..., WORKER_URL=https://...
```

## Output contract

- `upload` prints **only** the hosted URL on stdout (no trailing JSON,
  no `link=` prefix). Pipe it directly into other tools.
- `md` and `html` print **exactly one line** — the formatted tag.
- `list`, `count`, `get`, `delete` print the API's raw JSON envelope.
- Errors go to stderr with a non-zero exit. `curl --fail-with-body` is on,
  so 4xx/5xx bodies still surface.

## Don't

- Don't print the contents of `.env` or the bearer token in user-visible output.
- Don't pipe binary image bytes to the terminal — always pass paths to the CLI.
- Don't construct the HTTP request yourself; the CLI handles auth, the
  Imgur-shaped envelope, and the four accepted upload body shapes.
- Don't add the same image twice without checking — the API does not
  dedupe by SHA, so repeat uploads create distinct ids.

## Install (for fresh machines)

```bash
# Link the CLI onto PATH
ln -sf "$PWD/bin/img-hosting" ~/.bin/img-hosting

# Make the skill discoverable by Claude Code
ln -sfn "$PWD" ~/.claude/skills/img-hosting
```
