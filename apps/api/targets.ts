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
  // Void republishes triggers once a target has crons, and refuses to guess this and workers_dev.
  preview_urls: v.boolean(),
  r2_buckets: v.array(v.object({ binding: v.string(), bucket_name: v.string() })),
  routes: v.array(v.object({ custom_domain: v.boolean(), pattern: v.string() })),
  vars: v.record(v.string(), v.string()),
  workers_dev: v.boolean(),
})
const TargetsSchema = v.object({ develop: TargetSchema, local: TargetSchema, production: TargetSchema })

type Target = v.InferOutput<typeof TargetSchema>
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

// SQL stays hand-written and shared through each target's db/migrations link,
// the one directory Void accepts. Because Void finds migrations there, `void
// deploy` also applies pending ones before it uploads the Worker. Disabling
// schema inference keeps it from generating migrations of its own.
export const targetConfig = (name: TargetName): VoidConfig => {
  const target = TARGETS[name]
  return {
    cloudflare: {
      ...target,
      d1_databases: target.d1_databases.map((d1) => ({ ...d1, migrations_dir: './db/migrations' })),
    },
    inference: { appType: 'void', bindings: { db: false }, build: 'vp build' },
    worker: { compatibility_date: COMPATIBILITY_DATE, compatibility_flags: COMPATIBILITY_FLAGS },
  }
}
