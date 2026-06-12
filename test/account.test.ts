import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema, resetState, distinctPng, AUTH } from './helpers';

beforeAll(applySchema);
beforeEach(resetState);

// Distinct bytes per upload so each becomes its own row (content dedup would
// otherwise collapse identical uploads into one).
const upload = async () => {
  const res = await SELF.fetch('https://example.test/3/image', {
    method: 'POST',
    headers: { ...AUTH, 'Content-Type': 'image/png' },
    body: distinctPng(),
  });
  return ((await res.json()) as { data: { id: string } }).data;
};

describe('/3/account/me/*', () => {
  it('lists images newest-first with pagination', async () => {
    const first = await upload();
    await new Promise((r) => setTimeout(r, 1100)); // bump created_at second
    const second = await upload();

    const res = await SELF.fetch(
      'https://example.test/3/account/me/images?page=0&perPage=10',
      { headers: AUTH },
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: Array<{ id: string }> };
    expect(json.data.length).toBe(2);
    expect(json.data[0].id).toBe(second.id);
    expect(json.data[1].id).toBe(first.id);
  });

  it('counts images', async () => {
    await upload();
    await upload();
    const res = await SELF.fetch('https://example.test/3/account/me/images/count', {
      headers: AUTH,
    });
    const json = (await res.json()) as { data: number };
    expect(json.data).toBe(2);
  });

  it('rejects unauthenticated list', async () => {
    const res = await SELF.fetch('https://example.test/3/account/me/images');
    expect(res.status).toBe(401);
  });

  it('returns single image with deletehash', async () => {
    const { id } = await upload();
    const res = await SELF.fetch(`https://example.test/3/account/me/image/${id}`, {
      headers: AUTH,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { id: string; deletehash: string } };
    expect(json.data.id).toBe(id);
    expect(json.data.deletehash).toMatch(/^[A-Za-z0-9]{15}$/);
  });
});

describe('GET /healthz', () => {
  it('returns ok', async () => {
    const res = await SELF.fetch('https://example.test/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
