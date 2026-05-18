import type { Context, Next } from 'hono';
import type { Env } from './env';
import { fail } from './response';
import { verifyAccessJwt, type AccessIdentity } from './access';

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

type Identity =
  | { kind: 'bearer' }
  | { kind: 'access'; identity: AccessIdentity };

const tryAccess = async (c: Context<{ Bindings: Env }>): Promise<Identity | null> => {
  const team = c.env.ACCESS_TEAM;
  const aud = c.env.ACCESS_AUD;
  if (!team || !aud) return null;
  const jwt = c.req.header('Cf-Access-Jwt-Assertion') ?? c.req.header('cf-access-jwt-assertion');
  if (!jwt) return null;
  try {
    const identity = await verifyAccessJwt(jwt, team, aud);
    return { kind: 'access', identity };
  } catch (e) {
    console.warn('access jwt rejected:', (e as Error).message);
    return null;
  }
};

const tryBearer = (c: Context<{ Bindings: Env }>): Identity | null => {
  const expected = c.env.API_KEY;
  if (!expected) return null;
  const token = extractBearer(c.req.header('Authorization'));
  if (!token) return null;
  return timingSafeEqual(token, expected) ? { kind: 'bearer' } : null;
};

/**
 * Accepts either a Cloudflare Access JWT (preferred when configured) or
 * an `Authorization: Bearer <API_KEY>` token. On success, attaches the
 * resolved identity to `c.set('identity', ...)`.
 */
export const requireAuth = async (
  c: Context<{ Bindings: Env }>,
  next: Next,
) => {
  if (!c.env.API_KEY && !(c.env.ACCESS_TEAM && c.env.ACCESS_AUD)) {
    return fail(c, 500, 'server misconfigured: no auth method available');
  }
  const id = (await tryAccess(c)) ?? tryBearer(c);
  if (!id) return fail(c, 401, 'unauthorized');
  await next();
};

// Backwards-compat alias so existing imports keep working.
export const requireBearer = requireAuth;
