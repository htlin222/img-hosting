import { Hono } from 'hono';
import type { Env } from './env';
import { imagesApp } from './images';
import { accountApp } from './account';
import { serveApp } from './serve';
import { fail } from './response';

const app = new Hono<{ Bindings: Env }>();

app.get('/', (c) =>
  c.json({
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
      'GET    /healthz',
    ],
  }),
);

app.get('/healthz', (c) => c.json({ ok: true }));

app.route('/', imagesApp);
app.route('/', accountApp);
app.route('/', serveApp);

app.notFound((c) => fail(c, 404, 'not found'));
app.onError((err, c) => {
  console.error('unhandled error', err);
  return fail(c, 500, 'internal error');
});

export default app;
