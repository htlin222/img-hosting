import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema, resetState, tinyPng, AUTH } from './helpers';

beforeAll(applySchema);
beforeEach(resetState);

const upload = async () => {
  const res = await SELF.fetch('https://example.test/3/image', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'image/png' },
    body: tinyPng(),
  });
  const j = (await res.json()) as { data: { id: string; deletehash: string } };
  return j.data;
};

describe('GET /3/image/:id', () => {
  it('returns metadata without deletehash', async () => {
    const { id, deletehash } = await upload();
    const res = await SELF.fetch(`https://example.test/3/image/${id}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Record<string, unknown> };
    expect(json.data.id).toBe(id);
    expect((json.data as { deletehash?: string }).deletehash).toBeUndefined();
    expect(deletehash).toMatch(/^[A-Za-z0-9]{15}$/);
  });

  it('returns 404 for unknown id', async () => {
    const res = await SELF.fetch('https://example.test/3/image/zzzzzzz');
    expect(res.status).toBe(404);
  });
});

describe('GET /i/:filename', () => {
  it('serves raw PNG bytes with cache headers', async () => {
    const { id } = await upload();
    const res = await SELF.fetch(`https://example.test/i/${id}.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toContain('immutable');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(tinyPng().byteLength);
  });

  it('404s if extension does not match stored ext', async () => {
    const { id } = await upload();
    const res = await SELF.fetch(`https://example.test/i/${id}.jpg`);
    expect(res.status).toBe(404);
  });

  it('returns 304 on If-None-Match', async () => {
    const { id } = await upload();
    const first = await SELF.fetch(`https://example.test/i/${id}.png`);
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    const second = await SELF.fetch(`https://example.test/i/${id}.png`, {
      headers: { 'If-None-Match': etag! },
    });
    expect(second.status).toBe(304);
  });
});
