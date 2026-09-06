import type { D1Migration } from 'cloudflare:test'
import { applyD1Migrations, env } from 'cloudflare:test'

// `cloudflare:test` types `env` as `Cloudflare.Env`, so the test-only bindings
// have to be declared by augmenting that ambient namespace. There is no ES
// module form of a global augmentation.
declare global {
  // oxlint-disable-next-line typescript/no-namespace -- ambient global augmentation, not a code namespace
  namespace Cloudflare {
    interface Env {
      DB: D1Database
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
