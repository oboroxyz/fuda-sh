// `pnpm e2e [surface...] [-- e2e run flags]`: runs each surface's config in
// turn, gate first, and stops at the first failing surface. With no surface
// named, all three run.
import { spawnSync } from 'node:child_process'
import path from 'node:path'

import { SURFACES, isSurface, repoRoot } from '../stack.config.ts'
import type { SurfaceName } from '../stack.config.ts'

const ORDER: SurfaceName[] = ['gate', 'dash', 'app']

const args = process.argv.slice(2)
const split = args.indexOf('--')
const named = split === -1 ? args : args.slice(0, split)
const passthrough = split === -1 ? [] : args.slice(split + 1)
const unknown = named.filter((name) => !isSurface(name))
if (unknown.length > 0) {
  throw new Error(`unknown surface ${unknown.join(', ')}; expected ${Object.keys(SURFACES).join(', ')}`)
}
const surfaces = named.length === 0 ? ORDER : ORDER.filter((surface) => named.includes(surface))

const e2e = path.join(repoRoot, 'packages/e2e/node_modules/.bin/e2e')
for (const surface of surfaces) {
  const result = spawnSync(e2e, ['run', '--config', `${surface}.config.ts`, ...passthrough], {
    cwd: path.join(repoRoot, 'packages/e2e'),
    env: { ...process.env, E2E_TELEMETRY_DISABLED: '1' },
    stdio: 'inherit',
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}
