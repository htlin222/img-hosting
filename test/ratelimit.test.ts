import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema, resetState, tinyPng, AUTH } from './helpers';
import { rateLimitKey } from '../src/ratelimit';
import app from '../src/index';
import type { Env } from '../src/env';

beforeAll(applySchema);
beforeEach(resetState);

// ---------------------------------------------------------------------------
// Unit: the bucket-key derivation is the security-critical part of finding #1.
// ---------------------------------------------------------------------------
const fakeCtx = (headers: Record<string, string>) =>
  ({
    req: { header: (n: string) => headers[n.toLowerCase()] },
  }) as unknown as Parameters<typeof rateLimitKey>[0];

describe('rateLimitKey', () => {
  it('keys on the Cloudflare client IP, not the Authorization header', () => {
    const a = rateLimitKey(
      fakeCtx({ 'cf-connecting-ip': '1.2.3.4', authorization: 'Bearer aaaa' }),
      'upload',
    );
    const b = rateLimitKey(
      fakeCtx({ 'cf-connecting-ip': '1.2.3.4', authorization: 'Bearer zzzz' }),
      'upload',
    );
    expect(a).toBe('upload:1.2.3.4');
    // Swapping the (forgeable) token must NOT move the request to a new bucket.
    expect(a).toBe(b);
  });

  it('does not trust the spoofable x-forwarded-for header', () => {
    expect(rateLimitKey(fakeCtx({ 'x-forwarded-for': '9.9.9.9' }), 'read')).toBe('read:unknown');
  });

  it('separates buckets by scope for the same client', () => {
    const ip = { 'cf-connecting-ip': '5.5.5.5' };
    expect(rateLimitKey(fakeCtx(ip), 'upload')).not.toBe(rateLimitKey(fakeCtx(ip), 'read'));
  });
});

// ---------------------------------------------------------------------------
// Integration: drive app.fetch directly with an env that carries a spy RL
// binding (miniflare can't host a method-bearing JS binding via config). We
// reuse the runtime's real D1/R2 bindings so DB/bucket state is shared with the
// rest of the suite.
// ---------------------------------------------------------------------------
type Spy = { keys: string[]; deny: boolean };

const fetchWith = async (
  spy: Spy,
  path: string,
  init: RequestInit = {},
): Promise<Response> => {
  const testEnv: Env = {
    IMG_DB: env.IMG_DB,
    IMG_BUCKET: env.IMG_BUCKET,
    API_KEY: env.API_KEY,
    PUBLIC_BASE_URL: env.PUBLIC_BASE_URL,
    RL: {
      limit: async ({ key }) => {
        spy.keys.push(key);
        return { success: !spy.deny };
      },
    },
  };
  const ctx = createExecutionContext();
  const res = await app.fetch(new Request(`https://example.test${path}`, init), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
};

const newSpy = (): Spy => ({ keys: [], deny: false });

const uploadPng = async (spy: Spy, extraHeaders: Record<string, string> = {}) => {
  const res = await fetchWith(spy, '/3/image', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'image/png', ...extraHeaders },
    body: tinyPng(),
  });
  return (await res.json()) as { data: { id: string; deletehash: string } };
};

describe('rate limiting integration', () => {
  it('counts failed-auth upload attempts (limiter runs before auth)', async () => {
    const spy = newSpy();
    const res = await fetchWith(spy, '/3/image', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key', 'CF-Connecting-IP': '1.1.1.1' },
      body: tinyPng(),
    });
    // Auth still rejects the bad token...
    expect(res.status).toBe(401);
    // ...but only after the attempt was metered, so brute force is throttleable.
    expect(spy.keys).toContain('upload:1.1.1.1');
  });

  it('returns 429 when the limiter denies, before auth runs', async () => {
    const spy = newSpy();
    spy.deny = true;
    const res = await fetchWith(spy, '/3/image', {
      method: 'POST',
      headers: { Authorization: 'Bearer wrong-key', 'CF-Connecting-IP': '1.1.1.1' },
      body: tinyPng(),
    });
    expect(res.status).toBe(429);
  });

  it('rate-limits DELETE and update endpoints', async () => {
    const spy = newSpy();
    const { data } = await uploadPng(spy);
    spy.keys.length = 0;

    const del = await fetchWith(spy, `/3/image/${data.deletehash}`, {
      method: 'DELETE',
      headers: { ...AUTH, 'CF-Connecting-IP': '2.2.2.2' },
    });
    expect(del.status).toBe(200);
    expect(spy.keys).toContain('write:2.2.2.2');
  });

  it('rate-limits the /raw/ bypass endpoint', async () => {
    const spy = newSpy();
    const { data } = await uploadPng(spy);
    spy.keys.length = 0;

    const raw = await fetchWith(spy, `/raw/${data.id}.png`, {
      headers: { 'CF-Connecting-IP': '3.3.3.3' },
    });
    expect(raw.status).toBe(200);
    expect(spy.keys).toContain('serve:3.3.3.3');
  });

  it('rate-limits /whoami', async () => {
    const spy = newSpy();
    await fetchWith(spy, '/whoami', {
      headers: { ...AUTH, 'CF-Connecting-IP': '4.4.4.4' },
    });
    expect(spy.keys).toContain('read:4.4.4.4');
  });
});
