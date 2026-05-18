import { Hono } from 'hono';
import type { Env } from './env';

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>img-hosting</title>
<style>
  :root {
    --fg: #111;
    --muted: #777;
    --line: #e6e6e6;
    --line-strong: #c8c8c8;
    --bg: #fafafa;
    --panel: #fff;
    --accent: #111;
    --ok: #16803c;
    --err: #b42318;
    --shadow: 0 1px 0 rgba(0,0,0,0.02);
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, "Roboto Mono", monospace;
  }
  @media (prefers-color-scheme: dark) {
    :root { --fg:#ededed; --muted:#888; --line:#262626; --line-strong:#3a3a3a; --bg:#0a0a0a; --panel:#141414; --accent:#ededed; --ok:#3ddc84; --err:#ff6b6b; --shadow: none; }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--fg); }
  body {
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.5;
    padding: 3rem 1.5rem 6rem;
  }
  main { max-width: 720px; margin: 0 auto; }
  header {
    display: flex; justify-content: space-between; align-items: baseline;
    margin-bottom: 2.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--line);
  }
  header h1 { margin: 0; font-size: 1.1rem; font-weight: 600; letter-spacing: -0.01em; }
  header .who { color: var(--muted); font-size: 0.8rem; }
  .who a { color: inherit; text-decoration: underline dotted; cursor: pointer; }

  /* Drop zone — the hero element. display: block fixes the inline-label collapse. */
  .drop {
    display: block;
    border: 1.5px dashed var(--line-strong);
    background: var(--panel);
    padding: 3.5rem 1.5rem;
    text-align: center;
    color: var(--muted);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s, background 0.15s;
    box-shadow: var(--shadow);
  }
  .drop:hover, .drop.hover { border-color: var(--accent); color: var(--fg); background: var(--panel); }
  .drop .arrow { font-size: 2rem; line-height: 1; display: block; margin-bottom: 0.8rem; color: var(--line-strong); }
  .drop:hover .arrow, .drop.hover .arrow { color: var(--accent); }
  .drop .big { color: var(--fg); font-size: 0.95rem; }
  .drop .big strong { font-weight: 600; }
  .drop .hint { margin-top: 0.5rem; font-size: 0.75rem; letter-spacing: 0.02em; }

  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin-top: 0.8rem;
  }
  .meta input {
    font-family: var(--mono); font-size: 13px;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--line); background: var(--panel); color: var(--fg);
    width: 100%;
  }
  .meta input:focus { outline: none; border-color: var(--accent); }

  .status { margin-top: 1.2rem; min-height: 1.4em; font-size: 0.85rem; color: var(--muted); text-align: center; }
  .status.ok { color: var(--ok); }
  .status.err { color: var(--err); }

  .result { margin-top: 2.5rem; display: none; }
  .result.show { display: block; }
  .preview {
    display: flex; align-items: center; justify-content: center;
    min-height: 220px; padding: 1rem;
    border: 1px solid var(--line); background: var(--panel);
    margin-bottom: 2rem;
    background-image: linear-gradient(45deg, var(--line) 25%, transparent 25%),
                      linear-gradient(-45deg, var(--line) 25%, transparent 25%),
                      linear-gradient(45deg, transparent 75%, var(--line) 75%),
                      linear-gradient(-45deg, transparent 75%, var(--line) 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  .preview img { max-width: 100%; max-height: 360px; display: block; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }

  .row { margin-bottom: 1rem; }
  .row label {
    display: block; color: var(--muted);
    font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em;
    margin-bottom: 0.35rem;
  }
  .row .field { display: flex; gap: 0; align-items: stretch; }
  .row code {
    flex: 1; min-width: 0;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--line);
    background: var(--panel); color: var(--fg);
    overflow-x: auto; white-space: nowrap;
    font-family: var(--mono); font-size: 13px;
    scrollbar-width: thin;
  }
  .row code::-webkit-scrollbar { height: 4px; }
  .row code::-webkit-scrollbar-thumb { background: var(--line-strong); }
  button {
    font-family: var(--mono); font-size: 12px;
    padding: 0 1rem;
    border: 1px solid var(--accent); border-left: none;
    background: var(--panel); color: var(--accent);
    cursor: pointer; white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }
  button:hover { background: var(--accent); color: var(--panel); }
  button:active { transform: translateY(1px); }
  button.copied { background: var(--ok); color: var(--panel); border-color: var(--ok); }

  .login { display: none; }
  .login.show { display: block; }
  .login p { color: var(--muted); margin: 0; }
  .login form { display: flex; gap: 0; margin-top: 1rem; }
  .login input {
    flex: 1; min-width: 0;
    font-family: var(--mono); font-size: 13px;
    padding: 0.65rem 0.75rem;
    border: 1px solid var(--line); border-right: none;
    background: var(--panel); color: var(--fg);
  }
  .login input:focus { outline: none; border-color: var(--accent); }
  .login button { border-left: 1px solid var(--accent); }

  footer {
    margin-top: 5rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
    color: var(--muted); font-size: 0.75rem;
    display: flex; justify-content: space-between;
  }
  footer a { color: inherit; }
  input[type=file] { display: none; }
</style>
</head>
<body>
<main>
  <header>
    <h1>img-hosting</h1>
    <div class="who" id="who"></div>
  </header>

  <div id="login" class="login">
    <p>Sign in with your API key. Stored only in this browser session.</p>
    <form id="loginForm">
      <input id="apiKey" type="password" placeholder="paste API_KEY" autocomplete="off" />
      <button type="submit">unlock</button>
    </form>
  </div>

  <div id="app" style="display:none">
    <label class="drop" id="drop">
      <input type="file" id="file" accept="image/png,image/jpeg,image/gif,image/webp" />
      <span class="arrow" aria-hidden="true">↑</span>
      <div class="big">Drop, paste, or <strong>click to choose</strong> an image</div>
      <div class="hint">PNG · JPEG · GIF · WebP · max 20 MiB</div>
    </label>
    <div class="meta">
      <input id="title" type="text" placeholder="title (optional)" />
      <input id="description" type="text" placeholder="description (optional)" />
    </div>
    <div class="status" id="status"></div>

    <section id="result" class="result">
      <div class="preview"><img id="preview" alt="" /></div>

      <div class="row">
        <label>URL</label>
        <div class="field">
          <code id="url"></code>
          <button data-copy="url">copy</button>
        </div>
      </div>

      <div class="row">
        <label>Markdown</label>
        <div class="field">
          <code id="md"></code>
          <button data-copy="md">copy</button>
        </div>
      </div>

      <div class="row">
        <label>HTML</label>
        <div class="field">
          <code id="html"></code>
          <button data-copy="html">copy</button>
        </div>
      </div>

      <div class="row">
        <label>Delete hash</label>
        <div class="field">
          <code id="dh"></code>
          <button data-copy="dh">copy</button>
        </div>
      </div>
    </section>
  </div>

  <footer>
    <span><a href="https://github.com/htlin222/img-hosting">github</a></span>
    <span><a href="https://lin.hsiehting.com/about/#en">by Lin Hsieh-Ting</a></span>
  </footer>
</main>

<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const login = $('login'), app = $('app'), who = $('who');
  const drop = $('drop'), file = $('file'), status = $('status');
  const titleInput = $('title'), descInput = $('description');
  const result = $('result'), preview = $('preview');
  const urlEl = $('url'), mdEl = $('md'), htmlEl = $('html'), dhEl = $('dh');

  const KEY_STORE = 'img-hosting:key';
  const getKey = () => sessionStorage.getItem(KEY_STORE);
  const setKey = (k) => k ? sessionStorage.setItem(KEY_STORE, k) : sessionStorage.removeItem(KEY_STORE);

  // If Cloudflare Access is in front of this Worker, we get the user's email
  // injected as a request header on every server-rendered request. But this
  // is a fully-static page, so we discover identity by hitting /whoami.
  async function discoverIdentity() {
    try {
      const res = await fetch('/whoami', { credentials: 'include' });
      if (!res.ok) return null;
      const j = await res.json();
      // Worker wraps payloads in { data, success, status }. Access path:
      //   data: { kind: 'access', identity: { email, sub } }
      // Bearer path:
      //   data: { kind: 'bearer' }
      const payload = j?.data ?? j;
      if (payload?.kind === 'access' && payload.identity?.email) {
        return { kind: 'access', email: payload.identity.email };
      }
      if (payload?.kind === 'bearer') {
        return { kind: 'bearer' };
      }
    } catch (_) {}
    return null;
  }

  function showApp(identity) {
    login.classList.remove('show');
    app.style.display = '';
    if (identity?.kind === 'access') {
      who.innerHTML = identity.email + ' · <a id="signout">sign out</a>';
    } else {
      who.innerHTML = 'bearer · <a id="signout">sign out</a>';
    }
    const so = document.getElementById('signout');
    so?.addEventListener('click', () => { setKey(null); location.reload(); });
  }

  function showLogin() {
    login.classList.add('show');
    app.style.display = 'none';
    who.textContent = '';
  }

  function setStatus(text, cls) {
    status.textContent = text;
    status.className = 'status' + (cls ? ' ' + cls : '');
  }

  function authHeaders() {
    const k = getKey();
    return k ? { Authorization: 'Bearer ' + k } : {};
  }

  async function upload(f) {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setStatus('file too large (max 20 MiB)', 'err'); return; }
    setStatus('uploading ' + f.name + '…');
    result.classList.remove('show');
    const fd = new FormData();
    fd.set('image', f);
    if (titleInput.value) fd.set('title', titleInput.value);
    if (descInput.value) fd.set('description', descInput.value);
    let res;
    try {
      res = await fetch('/3/image', { method: 'POST', headers: authHeaders(), body: fd, credentials: 'include' });
    } catch (e) { setStatus('network error: ' + e.message, 'err'); return; }
    let body; try { body = await res.json(); } catch (_) { body = null; }
    if (res.status === 401) { setStatus('unauthorized — sign in again', 'err'); showLogin(); return; }
    if (!res.ok || !body?.success) {
      setStatus('upload failed: ' + (body?.data?.error || res.status), 'err'); return;
    }
    const d = body.data;
    const alt = (titleInput.value || f.name).replace(/[\\[\\]\\\\]/g, '');
    preview.src = d.link;
    preview.alt = alt;
    urlEl.textContent = d.link;
    mdEl.textContent = '![' + alt + '](' + d.link + ')';
    htmlEl.textContent = '<img src="' + d.link + '" alt="' + alt + '" />';
    dhEl.textContent = d.deletehash;
    result.classList.add('show');
    setStatus('uploaded · ' + d.width + '×' + d.height + ' · ' + Math.round(d.size / 1024) + ' KiB', 'ok');
    // Auto-copy the URL on success for the common case.
    try { await navigator.clipboard.writeText(d.link); setStatus('uploaded · URL copied to clipboard', 'ok'); } catch (_) {}
    titleInput.value = ''; descInput.value = '';
  }

  // Drop/click handlers
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault(); drop.classList.remove('hover');
    const f = e.dataTransfer?.files?.[0]; if (f) upload(f);
  });
  file.addEventListener('change', (e) => { const f = e.target.files?.[0]; if (f) upload(f); });

  // Paste from clipboard
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) { const f = item.getAsFile(); if (f) upload(f); }
  });

  // Copy buttons
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-copy]'); if (!btn) return;
    const id = btn.getAttribute('data-copy');
    const text = document.getElementById(id)?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
      btn.classList.add('copied'); const orig = btn.textContent; btn.textContent = 'copied';
      setTimeout(() => { btn.classList.remove('copied'); btn.textContent = orig; }, 1200);
    } catch (_) { setStatus('clipboard blocked — select and copy manually', 'err'); }
  });

  // Login form
  document.getElementById('loginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const k = document.getElementById('apiKey').value.trim();
    if (!k) return;
    setKey(k);
    showApp(null);
  });

  // Bootstrap
  (async () => {
    const identity = await discoverIdentity();
    if (identity?.kind === 'access') {
      // Access wins — drop any leftover API-key from a prior session.
      setKey(null);
      showApp(identity);
      return;
    }
    if (identity?.kind === 'bearer') { showApp(identity); return; }
    if (getKey()) { showApp({ kind: 'bearer' }); return; }
    showLogin();
  })();
})();
</script>
</body>
</html>
`;

export const uiApp = new Hono<{ Bindings: Env }>();

uiApp.get('/', (c) => {
  const accept = c.req.header('accept') ?? '';
  // Browsers send `text/html`; CLI / curl typically send `*/*` or no header.
  // Serve the UI for HTML clients; keep the JSON endpoint listing for the rest.
  if (accept.includes('text/html')) {
    return c.html(HTML);
  }
  return c.json({
    name: 'img-hosting',
    description: 'Imgur-shaped private image host on Cloudflare Workers.',
    endpoints: [
      'POST   /3/image',
      'GET    /3/image/:id',
      'POST   /3/image/:deletehash      (update title/description)',
      'DELETE /3/image/:deletehash',
      'GET    /3/account/me/images',
      'GET    /3/account/me/images/count',
      'GET    /3/account/me/image/:id',
      'GET    /i/:filename              (public image serve)',
      'GET    /whoami                   (identity from Access or bearer)',
      'GET    /healthz',
    ],
  });
});
