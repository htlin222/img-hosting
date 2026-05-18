import type { Context, Next } from 'hono';
import type { Env } from './env';
import { fail } from './response';

const timingSafeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

export const extractBearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1].trim() : null;
};

export const requireBearer = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  const expected = c.env.API_KEY;
  if (!expected) return fail(c, 500, 'server misconfigured: API_KEY not set');
  const token = extractBearer(c.req.header('Authorization'));
  if (!token || !timingSafeEqual(token, expected)) {
    return fail(c, 401, 'unauthorized');
  }
  await next();
};
