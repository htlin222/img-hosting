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

> 作者:**[林協霆 Lin Hsieh-Ting](https://lin.hsiehting.com/about/#en)**·自架、單一金鑰、邊緣執行的私人圖床

> 🌐 Language: **繁體中文** · [English](./README.md)

跑在 **Cloudflare Workers** 上的私人圖床,提供與 **Imgur 同形** 的 REST API。
API 金鑰透過 `.dev.vars` 與 `wrangler secret` 自帶,Repo 內不會放任何帳號專屬 ID。

- **R2** 存放圖片原始檔。
- **D1** 存放 metadata(id、deletehash、標題、MIME、尺寸……)。
- **Hono** 負責 API 路由。
- **Rate limiting** 透過 Cloudflare 的 `ratelimit` binding(以 IP 或 API key 計)。
- **圖片縮放** 透過 Cloudflare 的 image transformations(`?w=`、`?h=`、`?fit=`、`?q=`)
  ——須在你的 zone 上啟用「Transform images」。

## API

所有 endpoint 都使用 Imgur 的回應 envelope:

```json
{ "data": { ... }, "success": true, "status": 200 }
```

| Method | Path | 認證 | 備註 |
|---|---|---|---|
| `POST` | `/3/image` | Bearer | multipart(`image` 欄位)、raw bytes、urlencoded base64、或 JSON `{image, type:"base64"}` |
| `GET` | `/3/image/:id` | 公開 | 只回 metadata |
| `POST` | `/3/image/:deletehash` | Bearer | 更新 `title` / `description` |
| `DELETE` | `/3/image/:deletehash` | Bearer | 軟刪除 + R2 物件刪除 |
| `GET` | `/3/account/me/images` | Bearer | `?page=0&perPage=50` |
| `GET` | `/3/account/me/images/count` | Bearer | |
| `GET` | `/3/account/me/image/:id` | Bearer | 回應內含 `deletehash` |
| `GET` | `/i/:id.:ext` | 公開 | 回傳圖片本身;`?w=`、`?h=`、`?fit=`、`?q=` 觸發縮放 |
| `GET` | `/healthz` | 公開 | |

### 上傳範例

```bash
# raw bytes
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

## 設定

> 本 repo 不綁定任何特定帳號:D1 的 database ID、R2 的 bucket 名稱、你的自訂網域
> 都在**本機**設定時填入。Commit 進來的檔案沒有任何帳號專屬資料。

### 一鍵啟動

```bash
make bootstrap        # pnpm install + 建立 R2 bucket + 建立 D1
# (把 database_id 貼進 wrangler.toml)
make db-remote        # 套 schema 到遠端 D1
make secret           # 貼上你的 API_KEY
make deploy           # 跑測試 + 型別檢查 + wrangler deploy
make install-all      # 把 CLI 連到 ~/bin、skill 連到 ~/.claude/skills
```

`make help` 可列出所有 target。下面是逐步流程。

### 1. 安裝套件

```bash
make install          # 或: pnpm install
```

### 2. 建立 Cloudflare 資源

```bash
# 認證(每台機器一次)
pnpm wrangler login

# 建 R2 bucket。wrangler.toml 預設名稱是 "img-hosting";
# 想改名先改 wrangler.toml,然後執行下行。
pnpm wrangler r2 bucket create img-hosting

# 建 D1 資料庫。把印出的 `database_id` 貼進你本機的 wrangler.toml
# (要先從範本複製過來):
cp wrangler.toml.example wrangler.toml      # gitignored — 你的真正 ID 寫這裡
pnpm wrangler d1 create img-hosting         # 把 database_id 貼進 wrangler.toml
```

把 schema 套到遠端 D1:

```bash
pnpm db:remote
```

### 3. 機敏資訊

```bash
# 本機開發(從範例複製出 .dev.vars 後再編輯)
cp .dev.vars.example .dev.vars
# 產生一組夠長的隨機值:
openssl rand -hex 32

# 正式環境
pnpm wrangler secret put API_KEY
```

### 4. 執行

```bash
# 本機開發
pnpm dev          # http://127.0.0.1:8787
pnpm db:local     # 第一次跑前,把 schema 套到本機 D1

# 測試
pnpm test

# 部署
pnpm deploy
```

### 5. 對外網址

預設 API 回傳的 `link` 會用 request origin(即你的 `*.workers.dev` 網址)。
要換成自己的網域:

1. 在 Cloudflare dashboard 加一條 route,例如 `i.example.com/*` → 這個 Worker。
2. 在 `wrangler.toml` 設 `PUBLIC_BASE_URL = "https://i.example.com"`。
3. 重新 deploy。

## 測試

```bash
make test         # 用 @cloudflare/vitest-pool-workers 跑 vitest
make typecheck    # tsc --noEmit(strict)
make build        # install + typecheck(deploy 時 wrangler 會自己 bundle src/)
```

20 條測試覆蓋:上傳(raw / multipart / urlencoded / JSON+base64)、get、
list、count、delete、update、serve(含 `If-None-Match` 304)、認證,
以及 content-sniff 拒絕。測試跑在隔離的 miniflare runtime——不需要 Cloudflare 帳號。

## 縮放說明

`/i/...?w=200&h=200&fit=cover&q=80` 會被轉送到 Cloudflare 的
**image transformations**。你必須在 zone 上啟用該功能(免費方案有每月配額)。
在 `*.workers.dev` 網址上不會生效,會直接回原圖。

## CLI + Claude skill

Repo 內 [`img-hosting/`](./img-hosting/) 是一個自帶的 Claude Code skill,
內含一支 thin bash CLI 包裝 API。用 symlink 安裝:

```bash
make install-all      # 把 CLI 連到 ~/bin、skill 連到 ~/.claude/skills

# 設定檔(gitignored)
cp img-hosting/.env.example img-hosting/.env  # 然後填入 API_KEY + WORKER_URL
```

用法:

```bash
img-hosting upload screenshot.png
# https://i.example.com/i/Dwql3jX.png

img-hosting md   screenshot.png            # ![screenshot.png](https://...)
img-hosting html screenshot.png            # <img src="..." alt="..." />
img-hosting list --per-page 5              # JSON envelope
img-hosting delete <deletehash>
img-hosting whoami                         # 印出已遮罩的設定
```

只要 `~/.claude/skills/img-hosting` 連好了,Claude Code 的 agent 就能直接呼叫——
跟它說「把這張 png 傳上來,幫我回傳 markdown」就會自動 shell out 到 CLI,
把格式好的 tag 貼回來。skill 詳細說明在
[`img-hosting/SKILL.md`](./img-hosting/SKILL.md)。

## 專案結構

```
src/
  index.ts          Hono router
  env.ts            Bindings 型別
  auth.ts           Bearer 認證 middleware
  ids.ts            base62 id + sha256
  sniff.ts          PNG/JPEG/GIF/WebP magic bytes + 尺寸
  response.ts       Imgur envelope helper
  ratelimit.ts      RL binding 包裝
  resize.ts         cf.image fetch option
  images.ts         POST/GET/DELETE/UPDATE /3/image
  account.ts        /3/account/me/*
  serve.ts          /i/:filename 與 /raw/:filename
test/               Vitest + @cloudflare/vitest-pool-workers
schema.sql          D1 schema(正式版本)
migrations/         wrangler 管的 D1 migrations(內容同 schema.sql)
wrangler.toml.example  Commit 進來的範本(沒有真實 ID)
wrangler.toml          你本機的設定(內含真實 database_id,gitignored)

img-hosting/        Claude Code skill + CLI(`bin/img-hosting`)
  SKILL.md            給 Claude Code 讀的 skill manifest
  bin/img-hosting     bash CLI(upload | md | html | list | get | delete | whoami)
  .env.example        Commit 進來的範本
  .env                你本機的設定(gitignored)
```

## 授權

MIT。
