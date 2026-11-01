// Starts the local stack one e2e surface needs: a fresh api on its own port and
// D1 state, then that surface's Vite dev server. The e2e runner starts this as
// the target's `app.command` and stops it when the run ends.
//
// The api is the `local` Void target, built and then run by wrangler from the
// build output. It reads `stack.env` through `--env-file`: Void builds ignore
// `.env`, and an explicit env file makes wrangler skip any other, so a
// developer's local secrets (a signer, an ADMIN_TOKEN) never change what the
// suite sees.
import { spawn, spawnSync } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { API_ORIGIN, API_PORT, INSPECTOR_PORT, SURFACES, isSurface, repoRoot } from '../stack.config.ts'

const [surface] = process.argv.slice(2)
if (surface === undefined || !isSurface(surface)) {
  throw new Error(`usage: stack.ts <${Object.keys(SURFACES).join('|')}>`)
}
const { port } = SURFACES[surface]
const apiDir = path.join(repoRoot, 'apps/api/targets/local')
const apiConfig = 'dist/ssr/wrangler.json'
const surfaceDir = path.join(repoRoot, 'apps', surface)
const wrangler = path.join(repoRoot, 'packages/e2e/node_modules/.bin/wrangler')
const vp = path.join(repoRoot, 'node_modules/.bin/vp')
const state = path.join(repoRoot, 'packages/e2e/.e2e/state', surface)
const envFile = path.join(repoRoot, 'packages/e2e/stack.env')

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

const run = (command: string, args: string[], cwd: string): void => {
  const result = spawnSync(command, args, { cwd, env: childEnv, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${String(result.status)}`, {
      cause: result.error,
    })
  }
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

const answers = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(url)
    return response.ok
  } catch {
    // Not listening yet.
    return false
  }
}

const waitFor = async (url: string, deadline: number): Promise<void> => {
  if (await answers(url)) {
    return
  }
  if (Date.now() > deadline) {
    throw new Error(`${url} did not answer in time`)
  }
  await sleep(250)
  await waitFor(url, deadline)
}

rmSync(state, { force: true, recursive: true })
run(vp, ['build'], apiDir)
run(
  wrangler,
  ['d1', 'migrations', 'apply', 'fuda-beta', '--local', '-c', apiConfig, '--persist-to', state],
  apiDir,
)
start(
  wrangler,
  [
    'dev',
    '-c',
    apiConfig,
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
await waitFor(`${API_ORIGIN}/health`, Date.now() + 60_000)

// The surface starts only once the api answers, so the runner's readiness probe
// on the surface URL means the whole stack is up. Each surface's Worker reads
// API_BASE_URL (docs/adr/0010-void-pages-and-frontend-workers.md); a second
// Void dev server would collide with the api's inspector port, so it has none.
start(vp, ['dev', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], surfaceDir, {
  API_BASE_URL: API_ORIGIN,
  VITE_APP_ORIGIN: SURFACES.app.origin,
  VITE_RP_ID: 'localhost',
  VOID_INSPECTOR_PORT: 'false',
})
