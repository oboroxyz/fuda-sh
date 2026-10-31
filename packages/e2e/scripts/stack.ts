// Starts the local stack one e2e surface needs: a fresh api on its own port and
// D1 state, then that surface's Vite dev server. The e2e runner starts this as
// the target's `app.command` and stops it when the run ends.
//
// The api reads `stack.env` through `--env-file`. An explicit env file makes
// wrangler skip `apps/api/.dev.vars`, so a developer's local secrets (a signer,
// an ADMIN_TOKEN) never change what the suite sees.
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { join } from 'node:path'

import { API_ORIGIN, API_PORT, INSPECTOR_PORT, SURFACES, isSurface, repoRoot } from '../stack.config.ts'

const surface = process.argv[2]
if (surface === undefined || !isSurface(surface)) {
  throw new Error(`usage: stack.ts <${Object.keys(SURFACES).join('|')}>`)
}
const { port } = SURFACES[surface]
const apiDir = join(repoRoot, 'apps/api')
const surfaceDir = join(repoRoot, 'apps', surface)
const wrangler = join(repoRoot, 'node_modules/.bin/wrangler')
const vp = join(repoRoot, 'node_modules/.bin/vp')
const state = join(repoRoot, 'packages/e2e/.e2e/state', surface)
const envFile = join(repoRoot, 'packages/e2e/stack.env')

const children: ChildProcess[] = []
const stop = (): void => {
  for (const child of children) {
    child.kill('SIGTERM')
  }
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
process.on('exit', stop)

const childEnv = { ...process.env, WRANGLER_SEND_METRICS: 'false' }

const run = async (command: string, args: string[], cwd: string): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: childEnv, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${args.join(' ')} exited with ${String(code)}`))
      }
    })
  })
}

const start = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): void => {
  const child = spawn(command, args, { cwd, env: { ...childEnv, ...env }, stdio: 'inherit' })
  child.on('exit', (code) => {
    // One server dying takes the stack down, so the runner reports it instead
    // of timing out against half a stack.
    stop()
    process.exitCode = code ?? 1
  })
  children.push(child)
}

const waitFor = async (url: string, timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) {
        return
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
  }
  throw new Error(`${url} did not answer within ${String(timeoutMs)} ms`)
}

rmSync(state, { force: true, recursive: true })
await run(
  wrangler,
  ['d1', 'migrations', 'apply', 'fuda-beta', '--local', '--env', 'local', '--persist-to', state],
  apiDir,
)
start(
  wrangler,
  [
    'dev',
    '--env',
    'local',
    '--env-file',
    envFile,
    '--persist-to',
    state,
    '--ip',
    '127.0.0.1',
    '--port',
    String(API_PORT),
    '--inspector-port',
    String(INSPECTOR_PORT),
    '--show-interactive-dev-session=false',
    '--var',
    `API_BASE_URL:${API_ORIGIN}`,
    '--var',
    `PUBLIC_BASE_URL:${SURFACES.app.origin}`,
  ],
  apiDir,
)
await waitFor(`${API_ORIGIN}/health`, 60_000)

// The surface starts only once the api answers, so the runner's readiness probe
// on the surface URL means the whole stack is up.
start(vp, ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], surfaceDir, {
  VITE_API_BASE_URL: API_ORIGIN,
  VITE_APP_ORIGIN: SURFACES.app.origin,
  VITE_RP_ID: 'localhost',
})
