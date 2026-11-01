import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parse } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'
import * as v from 'valibot'
import type { VoidConfig } from 'void/config'

const TargetSchema = v.object({
  d1_databases: v.array(
    v.object({ binding: v.string(), database_id: v.string(), database_name: v.string() }),
  ),
  name: v.string(),
  r2_buckets: v.array(v.object({ binding: v.string(), bucket_name: v.string() })),
  routes: v.array(v.object({ custom_domain: v.boolean(), pattern: v.string() })),
  vars: v.record(v.string(), v.string()),
})
const TargetsSchema = v.object({ develop: TargetSchema, local: TargetSchema, production: TargetSchema })

export type Target = v.InferOutput<typeof TargetSchema>
export type TargetName = keyof v.InferOutput<typeof TargetsSchema>

const readTargets = (): Record<TargetName, Target> => {
  // Void's config loader leaves `import.meta.dirname` unset, so resolve from the URL.
  const file = fileURLToPath(new URL('targets.jsonc', import.meta.url))
  const errors: ParseError[] = []
  const parsed: unknown = parse(readFileSync(file, 'utf-8'), errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    throw new Error(`${file} is not valid JSONC`)
  }
  return v.parse(TargetsSchema, parsed)
}

export const TARGETS = readTargets()

export const COMPATIBILITY_DATE = '2025-09-01'
export const COMPATIBILITY_FLAGS = ['nodejs_compat']

// The Void config of one target. Migrations stay Wrangler's: `db: false` keeps
// Void from inferring a D1 database of its own, so it neither generates nor
// applies migrations, and `pnpm migrate:*` runs `wrangler d1 migrations apply`
// against the config Void generates.
export const targetConfig = (name: TargetName): VoidConfig => {
  const target = TARGETS[name]
  return {
    cloudflare: {
      ...target,
      // Each target is a Void project in `targets/<name>/`, and Void resolves
      // config paths from there.
      d1_databases: target.d1_databases.map((d1) => ({ ...d1, migrations_dir: '../../migrations' })),
    },
    inference: { appType: 'void', bindings: { db: false }, build: 'vp build' },
    worker: { compatibility_date: COMPATIBILITY_DATE, compatibility_flags: COMPATIBILITY_FLAGS },
  }
}
