import { Hono } from 'hono';
import type { Env } from './env';
import { imagesApp } from './images';
import { accountApp } from './account';
import { serveApp } from './serve';
import { uiApp } from './ui';
import { requireAuth } from './auth';
import { rateLimit } from './ratelimit';
import { ok, fail } from './response';
import { verifyAccessJwt } from './access';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));

// Lightweight identity probe used by the UI to find out who you are.
// - If a valid Access JWT is present, returns the email/sub.
// - Else if a valid bearer is present, returns { kind: 'bearer' }.
// - Else returns 401 so the UI can fall back to its API_KEY login form.
app.get('/whoami', rateLimit('read'), async (c) => {
  const team = c.env.ACCESS_TEAM;
  const aud = c.env.ACCESS_AUD;
  const jwt = c.req.header('Cf-Access-Jwt-Assertion');
  if (team && aud && jwt) {
    try {
      const identity = await verifyAccessJwt(jwt, team, aud);
      return ok(c, { kind: 'access', identity });
    } catch (e) {
      // Don't leak parser internals to clients; keep details server-side.
      console.warn('whoami: access jwt invalid:', (e as Error).message);
      return fail(c, 401, 'unauthorized');
    }
  }
  // Fall back to bearer. Inline the bearer check here so we can return a
  // proper 200 with identity on success rather than handing off to next().
  return requireAuth(c, async () => {
    c.res = ok(c, { kind: 'bearer' });
  });
});

app.route('/', uiApp);
app.route('/', imagesApp);
app.route('/', accountApp);
app.route('/', serveApp);

app.notFound((c) => fail(c, 404, 'not found'));
app.onError((err, c) => {
  console.error('unhandled error', err);
  return fail(c, 500, 'internal error');
});

export default app;
