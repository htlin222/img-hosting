import type { Context, Next } from 'hono';
import type { Env } from './env';
import { fail } from './response';

const keyFor = (c: Context<{ Bindings: Env }>, scope: string): string => {
  const auth = c.req.header('Authorization') ?? '';
  if (auth) return `auth:${scope}:${auth.slice(-16)}`;
  const ip =
    c.req.header('cf-connecting-ip') ??
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown';
  return `ip:${scope}:${ip}`;
};

export const rateLimit = (scope: string) =>
  async (c: Context<{ Bindings: Env }>, next: Next) => {
    if (!c.env.RL) {
      // Binding missing (e.g. some test environments). Fail open.
      await next();
      return;
    }
    const { success } = await c.env.RL.limit({ key: keyFor(c, scope) });
    if (!success) return fail(c, 429, 'rate limited');
    await next();
  };
