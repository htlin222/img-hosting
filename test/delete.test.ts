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
  return ((await res.json()) as { data: { id: string; deletehash: string } }).data;
};

describe('DELETE /3/image/:deletehash', () => {
  it('rejects without auth', async () => {
    const { deletehash } = await upload();
    const res = await SELF.fetch(`https://example.test/3/image/${deletehash}`, {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('soft-deletes and removes the R2 object', async () => {
    const { id, deletehash } = await upload();
    const del = await SELF.fetch(`https://example.test/3/image/${deletehash}`, {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(del.status).toBe(200);

    const get = await SELF.fetch(`https://example.test/3/image/${id}`);
    expect(get.status).toBe(404);
    const serve = await SELF.fetch(`https://example.test/i/${id}.png`);
    expect(serve.status).toBe(404);
  });

  it('returns 404 for unknown deletehash', async () => {
    const res = await SELF.fetch('https://example.test/3/image/zzzzzzzzzzzzzzz', {
      method: 'DELETE',
      headers: AUTH,
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /3/image/:deletehash (update)', () => {
  it('updates title and description', async () => {
    const { id, deletehash } = await upload();
    const fd = new FormData();
    fd.set('title', 'new title');
    fd.set('description', 'new desc');
    const up = await SELF.fetch(`https://example.test/3/image/${deletehash}`, {
      method: 'POST',
      headers: AUTH,
      body: fd,
    });
    expect(up.status).toBe(200);

    const get = await SELF.fetch(`https://example.test/3/image/${id}`);
    const j = (await get.json()) as { data: { title: string; description: string } };
    expect(j.data.title).toBe('new title');
    expect(j.data.description).toBe('new desc');
  });

  it('updates via a JSON body (previously silently no-op)', async () => {
    const { id, deletehash } = await upload();
    const up = await SELF.fetch(`https://example.test/3/image/${deletehash}`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'json title', description: 'json desc' }),
    });
    expect(up.status).toBe(200);

    const get = await SELF.fetch(`https://example.test/3/image/${id}`);
    const j = (await get.json()) as { data: { title: string; description: string } };
    expect(j.data.title).toBe('json title');
    expect(j.data.description).toBe('json desc');
  });
});
