export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  API_KEY: string;
  PUBLIC_BASE_URL?: string;
  // Cloudflare Access (Zero Trust). Both optional — if either is unset, the
  // Access JWT path is skipped and only bearer auth is honored.
  ACCESS_TEAM?: string;
  ACCESS_AUD?: string;
  IMG_BUCKET: R2Bucket;
  IMG_DB: D1Database;
  RL?: RateLimitBinding;
}
