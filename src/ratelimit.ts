import type { Context, Next } from 'hono';
import type { Env } from './env';
import { fail } from './response';

/**
 * Derive the rate-limit bucket key for a request.
 *
 * SECURITY: never key on the raw `Authorization` header. At rate-limit time the
 * header is unverified and fully attacker-controlled, so keying on it lets a
 * client mint an unlimited number of distinct buckets — and therefore unlimited
 * quota — simply by sending a different fake token on every request. That turns
 * the limiter into a no-op and, on a metered Workers/R2/D1 account, into a
 * billing-amplification vector.
 *
 * We key on `cf-connecting-ip`, which Cloudflare's edge sets (and overwrites)
 * on every request; the client cannot forge it. `x-forwarded-for` is
 * deliberately NOT used as a fallback for the same reason — it is client
 * supplied and spoofable. When no trusted IP is present (e.g. the miniflare
 * test runtime) we collapse to a single shared bucket rather than an
 * attacker-controlled one.
 */
export const rateLimitKey = (c: Context<{ Bindings: Env }>, scope: string): string => {
  const ip = c.req.header('cf-connecting-ip')?.trim() || 'unknown';
  return `${scope}:${ip}`;
};

export const rateLimit = (scope: string) =>
  async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!c.env.RL) {
      // Binding missing (e.g. some test environments). Fail open.
      await next();
      return;
    }
    const { success } = await c.env.RL.limit({ key: rateLimitKey(c, scope) });
    if (!success) return fail(c, 429, 'rate limited');
    await next();
  };
