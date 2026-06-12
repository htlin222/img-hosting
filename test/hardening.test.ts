import { SELF, env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema, resetState, tinyPng, AUTH } from './helpers';
import app from '../src/index';
import { MAX_B64_CHARS } from '../src/images';

beforeAll(applySchema);
beforeEach(resetState);

const upload = async () => {
  const res = await SELF.fetch('https://example.test/3/image', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'image/png' },
    body: tinyPng(),
  });
  return ((await res.json()) as { data: { id: string } }).data;
};

describe('upload error handling (P2: bad input is 4xx, not 500)', () => {
  it('returns 400 (not 500) for malformed JSON', async () => {
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: '{ this is not json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 (not 500) for invalid base64', async () => {
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: '@@@ not base64 @@@', type: 'base64' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects oversize base64 before decoding (413, memory-DoS guard)', async () => {
    // One char over the pre-decode cap: must be rejected without ever calling
    // atob (which would allocate the decoded buffer).
    const huge = 'A'.repeat(MAX_B64_CHARS + 8);
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: huge, type: 'base64' }),
    });
    expect(res.status).toBe(413);
  });
});

describe('security headers (P2)', () => {
  it('sets X-Content-Type-Options: nosniff on responses', async () => {
    const res = await SELF.fetch('https://example.test/healthz');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets a locked-down Content-Security-Policy on the HTML UI', async () => {
    const res = await SELF.fetch('https://example.test/', { headers: { Accept: 'text/html' } });
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe('edge cache (P2)', () => {
  it('serves /i/ from cache on the second hit, skipping D1', async () => {
    const { id } = await upload();
    const url = `https://example.test/i/${id}.png`;

    // First hit through app.fetch so we can await the waitUntil(cache.put).
    const ctx1 = createExecutionContext();
    const r1 = await app.fetch(new Request(url), env, ctx1);
    await waitOnExecutionContext(ctx1);
    expect(r1.status).toBe(200);

    // Drop the row out-of-band (the real DELETE endpoint would purge the cache).
    await env.IMG_DB.prepare('DELETE FROM images WHERE id = ?').bind(id).run();

    // The row is gone, so a 200 here can only have come from the edge cache.
    const ctx2 = createExecutionContext();
    const r2 = await app.fetch(new Request(url), env, ctx2);
    await waitOnExecutionContext(ctx2);
    expect(r2.status).toBe(200);
    expect(new Uint8Array(await r2.arrayBuffer()).byteLength).toBe(tinyPng().byteLength);
  });
});
