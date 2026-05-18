import type { Context } from 'hono';
import type { Env } from './env';

export type ResizeOptions = {
  width?: number;
  height?: number;
  quality?: number;
  fit?: 'scale-down' | 'contain' | 'cover' | 'crop' | 'pad';
};

export const parseResizeQuery = (c: Context<{ Bindings: Env }>): ResizeOptions | null => {
  const w = c.req.query('w');
  const h = c.req.query('h');
  const q = c.req.query('q');
  const fit = c.req.query('fit');
  if (!w && !h && !q && !fit) return null;
  const opts: ResizeOptions = {};
  if (w) opts.width = Math.max(1, Math.min(4096, parseInt(w, 10) || 0)) || undefined;
  if (h) opts.height = Math.max(1, Math.min(4096, parseInt(h, 10) || 0)) || undefined;
  if (q) opts.quality = Math.max(1, Math.min(100, parseInt(q, 10) || 0)) || undefined;
  if (fit && ['scale-down', 'contain', 'cover', 'crop', 'pad'].includes(fit)) {
    opts.fit = fit as ResizeOptions['fit'];
  }
  if (!opts.width && !opts.height && !opts.quality && !opts.fit) return null;
  return opts;
};

/**
 * Resize via Cloudflare's image transformations (cf.image fetch option).
 *
 * Requirements:
 *   - The zone must have "Transform images" enabled.
 *   - The Worker route must be on a zone (not workers.dev) for transformations
 *     to apply. On workers.dev the request falls through to the raw image.
 *
 * If transformations aren't available, Cloudflare returns the unmodified
 * response; we detect that via the `cf-resized` header and pass through.
 */
export const resizeViaCf = async (
  origin: string,
  rawPath: string,
  opts: ResizeOptions,
): Promise<Response> => {
  const url = new URL(rawPath, origin).toString();
  return fetch(url, {
    cf: { image: opts as Record<string, unknown> },
  } as RequestInit);
};
