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

> 作者:**[林協霆 Lin Hsieh-Ting](https://lin.hsiehting.com/about/#en)**·自架、單一金鑰、邊緣執行的私人圖床

> 🌐 Language: **繁體中文** · [English](./README.md)

跑在 **Cloudflare Workers** 上的私人圖床,提供與 **Imgur 同形** 的 REST API、
一個架在 **Cloudflare Access(OAuth)** 後面的**極簡 Web UI**、
一支 bash **CLI**,還有一個 **Claude Code skill** 讓 AI agent 也能上傳。
Repo 內不會放任何帳號專屬 ID;所有 secret 都在 `.dev.vars` /
`wrangler secret` / 被 gitignore 的 `wrangler.toml` 裡。

## 架構

```
                    ┌────────────────────────────────────────────┐
                    │  一個 Worker、三種認證面                       │
                    │                                            │
┌──────────────┐    │  ┌──────────────────────────────────────┐  │
│   Browser    │───▶│  │  upload-image.example.com  (Access)  │  │   ←  OAuth 把守的
│   (you)      │    │  │     UI、/3/image、/3/account/*        │  │       Web UI
└──────────────┘    │  └──────────────────────────────────────┘  │
                    │                                            │
┌──────────────┐    │  ┌──────────────────────────────────────┐  │
│  CLI / agent │───▶│  │  *.workers.dev  /3/image  (bearer)   │  │   ←  只認 API_KEY
│              │    │  │     從 terminal 上傳                    │  │
└──────────────┘    │  └──────────────────────────────────────┘  │
                    │                                            │
┌──────────────┐    │  ┌──────────────────────────────────────┐  │
│ Anyone with  │───▶│  │  *.workers.dev  /i/:id.png  (open)   │  │   ←  不認證
│  the URL     │    │  │     公開圖片                            │  │
└──────────────┘    │  └──────────────────────────────────────┘  │
                    │                                            │
                    │  Worker ─┬─▶ R2 bucket   (圖片本身)          │
                    │          └─▶ D1 database (metadata)        │
                    └────────────────────────────────────────────┘
```

- **R2** 存圖片原始檔。
- **D1** 存 metadata(id、deletehash、title、mime、尺寸……)。
- **Hono** 負責 API 路由。
- **Rate limiting** 透過 Cloudflare 的 `ratelimit` binding(以 IP 或 API key 計)。
- **圖片縮放** 透過 Cloudflare 的 image transformations(`?w=`、`?h=`、`?fit=`、`?q=`)
  ——須在你的 zone 上啟用「Transform images」。

---

# 安裝步驟(逐段照做)

從上到下走一次就裝好。每段都可以單獨重跑。

## 1. 前置條件

- 一個 Cloudflare 帳號(free plan 就夠)。
- Node ≥ 20 跟 `pnpm`(`brew install pnpm` 或 `corepack enable`)。
- `wrangler` 是 dev dep,不用裝 global 版。
- **CLI** 需要 `curl`(macOS 內建)。
- **Cloudflare Access** 需要一個由 Cloudflare 託管的 zone
  (你有的網域、nameserver 指向 Cloudflare)。

clone repo 跟裝套件:

```bash
git clone https://github.com/htlin222/img-hosting
cd img-hosting
make install
```

`make help` 列出所有 target。

## 2. Cloudflare 資源

需要一個 R2 bucket 跟一個 D1 資料庫,免費額度內都免錢。

```bash
pnpm wrangler login                         # 每台機器一次的 OAuth
make bucket                                 # 建 R2 bucket "img-hosting"
make db                                     # 建 D1,印出 database_id
```

**R2 第一次的坑:** R2 必須先在帳號層級啟用才能建 bucket。
前往 `https://dash.cloudflare.com/<account-id>/r2/overview`,
按下 **Purchase R2**(10 GB 內其實免費)、把**兩個** consent 勾選都打勾
(第二個是授權超量計費——沒超過免費額度就是 $0),然後再執行
`make bucket`。

拿到 `database_id` 後,貼進你**本機**的 `wrangler.toml`:

```bash
cp wrangler.toml.example wrangler.toml      # 本機這份是 gitignored 的
$EDITOR wrangler.toml                       # 貼上 database_id
```

接著套 schema 到遠端 D1:

```bash
make db-remote
```

## 3. API_KEY secret

這是 CLI 跟所有非 Access 呼叫者用的 bearer token。產一組,寫到 Worker:

```bash
make secret
# 互動式輸入;openssl rand -hex 32 產一組就好
```

本機 dev 也鏡像一份同樣的值到 `.dev.vars`:

```bash
cp .dev.vars.example .dev.vars
$EDITOR .dev.vars                           # 貼 API_KEY=...
```

如果你的客戶端腳本想要單一來源,也可以鏡像一份到 `.env`(同樣被 gitignore):

```bash
cp .env.example .env
# API_KEY=...   WORKER_URL=https://your-subdomain.workers.dev
```

## 4. 第一次 deploy

```bash
make deploy
```

`make deploy` 會先跑 `pnpm test` + `pnpm typecheck`(想跳過用 `deploy-fast`)。
deploy 完 Cloudflare 印出 `*.workers.dev` 網址。快速驗一下:

```bash
make smoke
# 預期:GET /healthz -> 200、POST /3/image 沒帶 auth -> 401
```

到這裡你已經有一個跑在 `*.workers.dev` 的私人圖床了。下面是其他面向。

## 5. CLI + Claude skill

```bash
make install-all                            # 連結到 ~/bin 跟 ~/.claude/skills
cp img-hosting/.env.example img-hosting/.env
$EDITOR img-hosting/.env                    # 貼 API_KEY + WORKER_URL
```

試試:

```bash
img-hosting upload screenshot.png
# https://your-subdomain.workers.dev/i/Dwql3jX.png

img-hosting md   screenshot.png             # ![screenshot.png](https://...)
img-hosting html screenshot.png             # <img src="..." alt="..." />
img-hosting list --per-page 5               # JSON envelope
img-hosting delete <deletehash>
img-hosting whoami                          # 印出已遮罩的設定
```

只要 `~/.claude/skills/img-hosting` 連好了,Claude Code 的 agent 就會自動找到 skill——
跟它說「上傳這張 png,給我 markdown」,agent 會自動 shell out 到 CLI。

如果 `~/bin` 還沒在 `PATH` 上:

```bash
echo 'export PATH="$HOME/bin:$PATH"' >> ~/.zprofile && source ~/.zprofile
```

## 6.(選用)自訂網域 + Cloudflare Access 把守 Web UI

Worker 預設就在 `/` serving 一個極簡上傳介面
(拖放或貼上圖片,一鍵 copy URL / Markdown / HTML / deletehash)。
在 `*.workers.dev` 上它會要求 API key 登入(以瀏覽器 sessionStorage 存)。
要換成**真正的 Google / GitHub / Email PIN OAuth**,
就在自訂網域前面掛 Cloudflare Access。四個步驟:

### 6.1 掛上自訂網域

進 **Workers & Pages → img-hosting → Settings → Domains & Routes**,
點 **Add → Custom Domain**,輸入例如 `upload-image.example.com`、儲存。
Cloudflare 自動建 DNS、簽憑證,大約 30 秒搞定。

### 6.2 建立 Zero Trust Access 應用

開 **Zero Trust → Access controls → Applications → Add an
application → Self-hosted**。

- **Application name:** `img-hosting`
- **Destination type:** `Public DNS`
- **Subdomain / Domain:** `upload-image` / `example.com`
- **Session duration:** 喜歡多久都行(24 h 很合適)
- **Identity providers:** 勾你已經設好的(Google / GitHub / 一般 OIDC /
  Email One-Time PIN)。

**Policy** 那一頁:

- Action: **Allow**
- Rule: **Emails** = 你的登入 email

儲存應用程式。在應用程式詳細頁面,複製
**Application Audience (AUD) Tag**(64 字元的 hex 字串,沒有 dash)。
順手記下 team subdomain——就是 Zero Trust URL 裡的
`*.cloudflareaccess.com` 主機名。

### 6.3 把 env vars 寫進 Worker

在你**被 gitignore 的** `wrangler.toml`:

```toml
[vars]
PUBLIC_BASE_URL = "https://your-subdomain.workers.dev"     # 看 6.4 解釋
ACCESS_TEAM     = "your-team"                              # 不含 .cloudflareaccess.com
ACCESS_AUD      = "abc123…64hex…"                          # 6.2 拿到的
```

```bash
make deploy-fast
```

### 6.4 為什麼 `PUBLIC_BASE_URL` 指回 `workers.dev`

Cloudflare Access 會把守**自訂網域上的每一條路徑**——包含
`/i/:id.png`。如果公開圖片從自訂網域提供,你分享 URL 給別人時,
對方會撞到登入畫面。

解決方法是讓圖片繼續從 workers.dev 提供:

```
自訂網域 (Access):    upload-image.example.com/        → UI + 上傳(只有你)
workers.dev (無認證): img-hosting.<...>.workers.dev/i/ → 公開圖片
```

`PUBLIC_BASE_URL` 決定 API 回傳的 `link` 欄位是什麼。指向 workers.dev
就確保你從 UI 複製出去的每個網址都會繞過 Access。
如果你寧可一切都在同一個 hostname,就在 Access 多加一條
**Bypass policy**,scope 設成 `Path: /i/*`(Allow → Everyone),
公開圖片就算在自訂網域也不會被擋。

### 6.5 驗證

打開 `https://upload-image.example.com/`。應該會撞到 Cloudflare 登入頁、
登入後進到 UI,**右上角顯示的是你的 email**(不是 "bearer")——
沒有 API key 表單了。傳一張試試,回傳的網址應該指向 `workers.dev`。

## 7. 本機開發

```bash
make dev                                    # http://127.0.0.1:8787
make db-local                               # 第一次:套 schema 到本機 D1
```

`wrangler dev` 從 `.dev.vars` 讀 `API_KEY`。
本機 runtime 沒有 Access JWT 注入,所以 Access env vars 被忽略。

```bash
make test                                   # 20 個 vitest spec
make typecheck                              # tsc --noEmit、strict
```

---

# 參考

## API

所有 endpoint 都使用 Imgur 的回應 envelope:

```json
{ "data": { ... }, "success": true, "status": 200 }
```

| Method | Path | 認證 | 備註 |
|---|---|---|---|
| `POST` | `/3/image` | Bearer **或** Access | multipart(`image` 欄位)、raw bytes、urlencoded base64、或 JSON `{image, type:"base64"}` |
| `GET` | `/3/image/:id` | 公開 | 只回 metadata |
| `POST` | `/3/image/:deletehash` | Bearer **或** Access | 更新 `title` / `description` |
| `DELETE` | `/3/image/:deletehash` | Bearer **或** Access | 軟刪除 + R2 刪除 |
| `GET` | `/3/account/me/images` | Bearer **或** Access | `?page=0&perPage=50` |
| `GET` | `/3/account/me/images/count` | Bearer **或** Access | |
| `GET` | `/3/account/me/image/:id` | Bearer **或** Access | 內含 `deletehash` |
| `GET` | `/i/:id.:ext` | 公開 | 回傳圖片本身;`?w=`、`?h=`、`?fit=`、`?q=` 觸發縮放 |
| `GET` | `/whoami` | Bearer **或** Access | UI 用來辨識身分 |
| `GET` | `/healthz` | 公開 | |
| `GET` | `/` | 公開 | UI(text/html)或 endpoint 列表(JSON) |

### 上傳範例

```bash
# raw bytes
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

## 縮放

`/i/...?w=200&h=200&fit=cover&q=80` 會被轉送到 Cloudflare 的
**image transformations**。需要在 zone 上啟用(免費方案有每月配額)。
在 `*.workers.dev` 上不會生效,會回原圖。

## 測試

```bash
make test         # 用 @cloudflare/vitest-pool-workers 跑 vitest
make typecheck    # tsc --noEmit、strict
make build        # install + typecheck(deploy 時 wrangler 會自動 bundle src/)
```

20 條測試覆蓋:上傳(raw / multipart / urlencoded / JSON+base64)、get、
list、count、delete、update、serve(含 `If-None-Match` 304)、認證,
以及 content-sniff 拒絕。測試跑在隔離的 miniflare runtime——不需要 Cloudflare 帳號。

---

# 專案結構

```
src/
  index.ts          Hono router;mount UI / images / account / serve
  env.ts            Bindings 型別(包含 ACCESS_TEAM/ACCESS_AUD)
  auth.ts           requireAuth:先試 Access JWT、再 fallback bearer
  access.ts         對 team 的 JWKS 做 RS256 JWT 驗證
  ids.ts            base62 id + sha256
  sniff.ts          PNG/JPEG/GIF/WebP magic bytes + 尺寸
  response.ts       Imgur envelope helper
  ratelimit.ts      RL binding 包裝
  resize.ts         cf.image fetch option
  images.ts         POST/GET/DELETE/UPDATE /3/image
  account.ts        /3/account/me/*
  serve.ts          /i/:filename 與 /raw/:filename
  ui.ts             單頁極簡 Web UI
test/               Vitest + @cloudflare/vitest-pool-workers
schema.sql          D1 schema(canonical)
migrations/         wrangler 管的 D1 migrations(內容同 schema.sql)
wrangler.toml.example  Commit 進來的範本(沒有真實 ID)
wrangler.toml          你本機的設定,內含真實 ID + AUD(gitignored)

img-hosting/        Claude Code skill + CLI(`bin/img-hosting`)
  SKILL.md            給 Claude Code 讀的 skill manifest
  bin/img-hosting     bash CLI(upload | md | html | list | get | delete | whoami)
  .env.example        Commit 進來的範本
  .env                你本機的設定(gitignored)

Makefile            單一入口:make help 列出所有 target
```

---

# 疑難排解

**`make bucket` 失敗,訊息 `Please enable R2 through the Cloudflare Dashboard`**
→ 看 §2 R2 第一次的坑。R2 啟用畫面那兩個 consent 勾選都要打勾。

**`make db-remote` 失敗,訊息 `database_id is required`**
→ 你還沒把 `wrangler d1 create` 印出的 `database_id` 貼進本機的
`wrangler.toml`。

**已經透過 Access 登入了,UI 還是一直叫我貼 API key**
→ 不是 Worker 沒設 `ACCESS_TEAM` / `ACCESS_AUD`,就是你瀏覽器開的是
workers.dev 網址而不是自訂網域(Access 只擋自訂網域)。
在自訂網域上強制重新整理(Cmd-Shift-R)。

**分享出去的圖片網址會回 Cloudflare Access 登入畫面**
→ 你把 `PUBLIC_BASE_URL` 設成自訂網域了。要嘛改回 `workers.dev`
(看 §6.4),要嘛新增一條 Access **Bypass** policy 把 scope 設成
`Path: /i/*`。

**剛重新 `wrangler secret put API_KEY`,CLI 就 401**
→ 你的 `.env` / `.dev.vars` 還是舊值。改完再 re-source。

**測試失敗,訊息 `readFileSync is not yet implemented in Workers`**
→ 你在 test runtime 裡用了 Node 的 `fs`。fixture 直接 inline 到
`test/helpers.ts`,Workers test runtime 沒有 `fs`。

---

## 授權

MIT。
