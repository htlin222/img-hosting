import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applySchema, resetState, tinyPng, AUTH } from './helpers';

beforeAll(applySchema);
beforeEach(resetState);

describe('POST /3/image', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      body: tinyPng(),
    });
    expect(res.status).toBe(401);
    const json = (await res.json()) as { success: boolean };
    expect(json.success).toBe(false);
  });

  it('uploads raw PNG bytes', async () => {
    const bytes = tinyPng();
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'image/png' },
      body: bytes,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      data: {
        id: string;
        deletehash: string;
        link: string;
        type: string;
        width: number;
        height: number;
        size: number;
      };
      success: boolean;
    };
    expect(json.success).toBe(true);
    expect(json.data.id).toMatch(/^[A-Za-z0-9]{7}$/);
    expect(json.data.deletehash).toMatch(/^[A-Za-z0-9]{15}$/);
    expect(json.data.type).toBe('image/png');
    expect(json.data.width).toBe(1);
    expect(json.data.height).toBe(1);
    expect(json.data.size).toBe(bytes.byteLength);
    expect(json.data.link).toBe(`https://i.example.test/i/${json.data.id}.png`);
  });

  it('uploads via multipart form', async () => {
    const fd = new FormData();
    fd.set('image', new Blob([tinyPng()], { type: 'image/png' }), 'pic.png');
    fd.set('title', 'a title');
    fd.set('description', 'a desc');
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: AUTH,
      body: fd,
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { title: string; description: string; name: string } };
    expect(json.data.title).toBe('a title');
    expect(json.data.description).toBe('a desc');
    expect(json.data.name).toBe('pic.png');
  });

  it('uploads via base64 JSON body', async () => {
    const b64 = btoa(String.fromCharCode(...tinyPng()));
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: b64, type: 'base64', name: 'b64.png' }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: { name: string; type: string } };
    expect(json.data.name).toBe('b64.png');
    expect(json.data.type).toBe('image/png');
  });

  it('rejects non-image bytes', async () => {
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: AUTH,
      body: new TextEncoder().encode('hello world'),
    });
    expect(res.status).toBe(415);
  });

  it('rejects empty body', async () => {
    const res = await SELF.fetch('https://example.test/3/image', {
      method: 'POST',
      headers: AUTH,
      body: new Uint8Array(0),
    });
    expect(res.status).toBe(400);
  });
});
