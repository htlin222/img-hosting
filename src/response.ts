import type { Context } from 'hono';

export type ImgurEnvelope<T> = {
  data: T;
  success: boolean;
  status: number;
};

export const ok = <T>(c: Context, data: T, status = 200) =>
  c.json<ImgurEnvelope<T>>({ data, success: true, status }, status as 200);

export const fail = (c: Context, status: number, error: string) =>
  c.json<ImgurEnvelope<{ error: string }>>(
    { data: { error }, success: false, status },
    status as 200,
  );
