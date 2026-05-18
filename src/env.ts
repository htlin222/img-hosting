export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  API_KEY: string;
  PUBLIC_BASE_URL?: string;
  IMG_BUCKET: R2Bucket;
  IMG_DB: D1Database;
  RL?: RateLimitBinding;
}
