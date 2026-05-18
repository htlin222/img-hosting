import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

// Tests don't read wrangler.toml so they don't need the operator to fill in
// `database_id` first. We declare bindings here and call applyD1Migrations()
// in test setup to install schema.sql into the local D1 instance.
export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        main: './src/index.ts',
        singleWorker: true,
        isolatedStorage: false,
        miniflare: {
          compatibilityDate: '2024-12-30',
          compatibilityFlags: ['nodejs_compat'],
          bindings: {
            API_KEY: 'test-api-key',
            PUBLIC_BASE_URL: 'https://i.example.test',
          },
          r2Buckets: ['IMG_BUCKET'],
          d1Databases: ['IMG_DB'],
        },
      },
    },
  },
});
