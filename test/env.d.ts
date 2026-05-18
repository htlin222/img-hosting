// Tell @cloudflare/vitest-pool-workers about the bindings declared in
// vitest.config.ts so `env` in tests is properly typed.
import type { Env } from '../src/env';

declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
