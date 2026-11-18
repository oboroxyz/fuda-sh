// Ad hoc verification on the e2e stack, for agents proving one change (see
// .agents/skills/verify-fuda/SKILL.md). It starts the stack for one surface,
// reports whether it is worth driving, runs a browser journey that saves
// evidence, and stops only what it started.
//
// `void` and `vp` start through `/bin/sh` wrappers that run the first `node` on
// PATH, and void refuses anything older than 24.22, so `up` puts the Node that
// runs this script first on the stack's PATH.
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

import { chromium } from 'playwright-core'
import type { BrowserContext, Page } from 'playwright-core'
import * as v from 'valibot'

import { API_ORIGIN, API_PORT, INSPECTOR_PORT, SURFACES, isSurface, repoRoot } from '../stack.config.ts'
import type { SurfaceName } from '../stack.config.ts'
import { apiRequest, createOperator, createVenue, issueBearerRight } from '../tests/support/seed.ts'

const e2eDir = path.join(repoRoot, 'packages/e2e')
// Under packages/e2e/.e2e/, which Git ignores. Evidence never goes here.
const stateDir = path.join(e2eDir, '.e2e/verify')
const stateFile = path.join(stateDir, 'stack.json')
const lockBackupDir = path.join(stateDir, 'void-locks')
const STARTUP_MS = 180_000
const STOP_MS = 15_000

const SurfaceSchema = v.picklist(['app', 'dash', 'gate'])
const StateSchema = v.object({
  commit: v.string(),
  locks: v.array(v.string()),
  log: v.string(),
  pgid: v.number(),
  startedAt: v.string(),
  surface: SurfaceSchema,
})
type StackState = v.InferOutput<typeof StateSchema>

const git = (...args: string[]): string =>
  spawnSync('git', args, { cwd: repoRoot, encoding: 'utf-8' }).stdout.trim()

const readState = (): StackState | null =>
  existsSync(stateFile) ? v.parse(StateSchema, JSON.parse(readFileSync(stateFile, 'utf-8'))) : null

const groupAlive = (pgid: number): boolean => {
  try {
    process.kill(-pgid, 0)
    return true
  } catch {
    // ESRCH: no process is left in the group.
    return false
  }
}

// Listening loopback TCP ports mapped to the owning pid, read from `ss`.
const listeners = (): Map<number, number> => {
  const out = spawnSync('ss', ['-Hltnp'], { encoding: 'utf-8' }).stdout
  const owners = new Map<number, number>()
  for (const line of out.split('\n')) {
    const port = /:(?<port>\d+)\s/u.exec(line)?.groups?.port
    const pid = /pid=(?<pid>\d+)/u.exec(line)?.groups?.pid
    if (port !== undefined && pid !== undefined) {
      owners.set(Number(port), Number(pid))
    }
  }
  return owners
}

const pgidOf = (pid: number): number | null => {
  try {
    // Field 5 of /proc/<pid>/stat, after the parenthesised command name.
    const stat = readFileSync(`/proc/${String(pid)}/stat`, 'utf-8')
    return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2])
  } catch {
    // The process exited between `ss` and this read.
    return null
  }
}

const stackPorts = (surface: SurfaceName): number[] => [API_PORT, INSPECTOR_PORT, SURFACES[surface].port]

const fetchText = async (url: string): Promise<{ ok: boolean; text: string }> => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) })
    return { ok: response.ok, text: await response.text() }
  } catch {
    // Not listening yet, or stopped.
    return { ok: false, text: '' }
  }
}

// stack.ts starts the surface only after the api answers /health, so both
// serving means the whole stack is up. Gate is a client-side SPA whose HTML is
// a shell; a journey's first step proves it renders.
const stackServes = async (surface: SurfaceName): Promise<boolean> => {
  const [health, page] = await Promise.all([
    fetchText(`${API_ORIGIN}/health`),
    fetchText(SURFACES[surface].origin),
  ])
  return health.ok && health.text.includes('"ok":true') && page.ok && page.text.includes('<html')
}

const lockFiles = (): string[] =>
  readdirSync(path.join(repoRoot, 'apps'))
    .map((app) => path.join('apps', app, 'void.lock.json'))
    .filter((file) => existsSync(path.join(repoRoot, file)))

const backupOf = (file: string): string => path.join(lockBackupDir, file.replaceAll('/', '__'))

const waitReady = async (
  surface: SurfaceName,
  pgid: number,
  log: string,
  deadline: number,
): Promise<void> => {
  if (!groupAlive(pgid)) {
    throw new Error(`stack exited during startup; read ${log}, then run down`)
  }
  if (await stackServes(surface)) {
    return
  }
  if (Date.now() > deadline) {
    throw new Error(`stack not ready after ${String(STARTUP_MS / 1000)}s; read ${log}, then run down`)
  }
  await sleep(500)
  await waitReady(surface, pgid, log, deadline)
}

const up = async (surface: SurfaceName): Promise<void> => {
  const existing = readState()
  if (existing !== null && groupAlive(existing.pgid)) {
    throw new Error(
      `a ${existing.surface} stack from this helper is running (pgid ${String(existing.pgid)}); run down`,
    )
  }
  const owners = listeners()
  const busy = stackPorts(surface).filter((port) => owners.has(port))
  if (busy.length > 0) {
    // Usually `pnpm e2e`, or another agent's stack. Never drive or kill it.
    throw new Error(
      `ports ${busy.join(', ')} are taken by a process this helper did not start; refusing to launch`,
    )
  }
  rmSync(stateDir, { force: true, recursive: true })
  mkdirSync(lockBackupDir, { recursive: true })
  // The stack rewrites apps/*/void.lock.json with local values. Keep the exact
  // bytes, uncommitted edits included, so down can put them back.
  const locks = lockFiles()
  for (const file of locks) {
    copyFileSync(path.join(repoRoot, file), backupOf(file))
  }
  const log = path.join(stateDir, `${surface}.log`)
  const out = openSync(log, 'w')
  const child = spawn(process.execPath, [path.join(e2eDir, 'scripts/stack.ts'), surface], {
    cwd: e2eDir,
    detached: true,
    env: { ...process.env, PATH: `${path.dirname(process.execPath)}:${process.env.PATH ?? ''}` },
    stdio: ['ignore', out, out],
  })
  if (child.pid === undefined) {
    throw new Error('stack did not start')
  }
  child.unref()
  const state: StackState = {
    commit: git('rev-parse', 'HEAD'),
    locks,
    log,
    pgid: child.pid,
    startedAt: new Date().toISOString(),
    surface,
  }
  writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`)
  await waitReady(surface, child.pid, log, Date.now() + STARTUP_MS)
  console.log(JSON.stringify({ api: API_ORIGIN, ready: true, url: SURFACES[surface].origin, ...state }))
}

const doctor = async (): Promise<void> => {
  const state = readState()
  if (state === null) {
    console.log(JSON.stringify({ ok: false, reason: 'no stack started by this helper (run up <surface>)' }))
    process.exitCode = 1
    return
  }
  const owners = listeners()
  const portChecks = stackPorts(state.surface).map((port) => {
    const pid = owners.get(port)
    return [`port${String(port)}OwnedByUs`, pid !== undefined && pgidOf(pid) === state.pgid] as const
  })
  const head = git('rev-parse', 'HEAD')
  const checks = Object.fromEntries([
    ['processGroupAlive', groupAlive(state.pgid)],
    ...portChecks,
    ['apiAndSurfaceServe', await stackServes(state.surface)],
    ['headMatchesLaunch', head === state.commit],
  ])
  const ok = Object.values(checks).every(Boolean)
  console.log(
    JSON.stringify(
      { checks, head, ok, surface: state.surface, url: SURFACES[state.surface].origin },
      null,
      2,
    ),
  )
  if (!ok) {
    process.exitCode = 1
  }
}

const waitStopped = async (pgid: number, deadline: number): Promise<void> => {
  if (!groupAlive(pgid) || Date.now() > deadline) {
    return
  }
  await sleep(250)
  await waitStopped(pgid, deadline)
}

const down = async (): Promise<void> => {
  const state = readState()
  if (state === null) {
    console.log('no stack started by this helper; nothing to stop')
    return
  }
  if (groupAlive(state.pgid)) {
    process.kill(-state.pgid, 'SIGTERM')
    await waitStopped(state.pgid, Date.now() + STOP_MS)
    if (groupAlive(state.pgid)) {
      process.kill(-state.pgid, 'SIGKILL')
    }
  }
  for (const file of state.locks) {
    copyFileSync(backupOf(file), path.join(repoRoot, file))
  }
  rmSync(stateDir, { force: true, recursive: true })
  rmSync(path.join(e2eDir, '.e2e/state', state.surface), { force: true, recursive: true })
  console.log(
    `stopped ${state.surface} stack (pgid ${String(state.pgid)}) and restored ${state.locks.join(', ')}`,
  )
}

// The surface's local D1 file, opened read-only, for proving side effects.
const d1File = (surface: SurfaceName): string => {
  const dir = path.join(e2eDir, '.e2e/state', surface, 'v3/d1/miniflare-D1DatabaseObject')
  const file = readdirSync(dir).find((name) => name.endsWith('.sqlite') && name !== 'metadata.sqlite')
  if (file === undefined) {
    throw new Error(`no D1 database under ${dir}`)
  }
  return path.join(dir, file)
}

const RowsSchema = v.array(v.record(v.string(), v.unknown()))

const d1 = (surface: SurfaceName, sql: string): v.InferOutput<typeof RowsSchema> => {
  if (!/^\s*(?:select|with)\b/iu.test(sql)) {
    throw new Error('d1() runs SELECT or WITH only')
  }
  const result = spawnSync('sqlite3', ['-readonly', '-json', d1File(surface), sql], { encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`sqlite3: ${result.stderr.trim()}`)
  }
  return result.stdout.trim() === '' ? [] : v.parse(RowsSchema, JSON.parse(result.stdout))
}

// A venue with a published Membership Card, plus one claimed pass's QR.
const venueWithPass = async (name?: string) => {
  const venue = await createVenue(name)
  const { qr } = await apiRequest(
    `/issuers/${venue.handle}/${venue.cardSlug}/issue`,
    v.object({ qr: v.string() }),
    {
      body: '{}',
      method: 'POST',
    },
  )
  return { ...venue, qr }
}

const seeds = {
  bearer: issueBearerRight,
  operator: createOperator,
  pass: venueWithPass,
  venue: createVenue,
}

// A D1 row, an api read or a seeded value: any record or list of them.
type Row = v.InferOutput<typeof RowsSchema>[number]
type NoteValue = string | number | boolean | null | Row | readonly Row[]

export interface JourneyContext {
  page: Page
  context: BrowserContext
  surface: SurfaceName
  origin: string
  api: string
  seed: typeof seeds
  apiRequest: typeof apiRequest
  // valibot, so a journey kept outside this package needs no runtime imports.
  v: typeof v
  // Saves <nn>-<name>.png and <nn>-<name>.aria.txt of the current page.
  step: (name: string) => Promise<void>
  // Runs one read-only SELECT on the stack's local D1 and returns its rows.
  d1: (sql: string) => v.InferOutput<typeof RowsSchema>
  // Records a value, such as an api read or a side effect, in journey.json.
  note: (name: string, value: NoteValue) => void
  // Fails the journey with the message when the condition is false.
  check: (condition: boolean, message: string) => void
  // Signs the browser in to dash as an operator with a session token.
  signInOperator: (token: string) => Promise<void>
}

export interface Journey {
  surface: SurfaceName
  viewport?: { width: number; height: number }
  run: (ctx: JourneyContext) => Promise<void>
}

const JourneyModuleSchema = v.object({
  default: v.object({
    run: v.function(),
    surface: SurfaceSchema,
    viewport: v.optional(v.object({ height: v.number(), width: v.number() })),
  }),
})

const today = (): string => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })

const drive = async (journeyPath: string, outArg?: string): Promise<void> => {
  const state = readState()
  const { default: journey } = v.parse(
    JourneyModuleSchema,
    await import(pathToFileURL(path.resolve(journeyPath)).href),
  )
  if (state === null || !groupAlive(state.pgid) || state.surface !== journey.surface) {
    throw new Error(
      `journey needs a ${journey.surface} stack from this helper; run up ${journey.surface}, then doctor`,
    )
  }
  const name = path.basename(journeyPath).replace(/\.ts$/u, '')
  const out = path.resolve(outArg ?? path.join(repoRoot, 'artifacts', `${today()}-verify-${name}`))
  mkdirSync(out, { recursive: true })
  const viewport = journey.viewport ?? { height: 800, width: 1280 }
  const { origin } = SURFACES[journey.surface]
  // Serialized when noted, so journey.json holds the value as it was then.
  const notes = new Map<string, string>()
  const steps: string[] = []
  const record = {
    commit: git('rev-parse', 'HEAD'),
    dirty: git('status', '--porcelain', '--', ':!apps/*/void.lock.json') !== '',
    error: '',
    journey: path.resolve(journeyPath),
    locale: 'en-US',
    result: 'failed',
    startedAt: new Date().toISOString(),
    surface: journey.surface,
    theme: 'unknown',
    timezone: 'Asia/Tokyo',
    url: origin,
    viewport,
  }
  const browser = await chromium.launch()
  // Same locale and timezone as the e2e configs, so the English copy holds.
  const context = await browser.newContext({
    baseURL: origin,
    colorScheme: 'light',
    locale: 'en-US',
    recordVideo: { dir: out, size: viewport },
    timezoneId: 'Asia/Tokyo',
    viewport,
  })
  await context.tracing.start({ screenshots: true, snapshots: true })
  const page = await context.newPage()
  const step = async (stepName: string): Promise<void> => {
    const prefix = `${String(steps.length + 1).padStart(2, '0')}-${stepName}`
    await page.screenshot({ fullPage: true, path: path.join(out, `${prefix}.png`) })
    const aria = await page.locator('body').ariaSnapshot()
    writeFileSync(path.join(out, `${prefix}.aria.txt`), `${page.url()}\n${aria}\n`)
    steps.push(prefix)
  }
  const ctx: JourneyContext = {
    api: API_ORIGIN,
    apiRequest,
    check: (condition, message) => {
      if (!condition) {
        throw new Error(`check failed: ${message}`)
      }
    },
    context,
    d1: (sql) => d1(journey.surface, sql),
    note: (key, value) => {
      notes.set(key, JSON.stringify(value))
    },
    origin,
    page,
    seed: seeds,
    signInOperator: async (token) => {
      await context.addCookies([
        { httpOnly: true, name: 'fuda_operator', sameSite: 'Lax', url: SURFACES.dash.origin, value: token },
      ])
    },
    step,
    surface: journey.surface,
    v,
  }
  try {
    // `run` is checked to be a function above; journeys type it as Journey['run'].
    await Promise.resolve(journey.run(ctx))
    record.theme = await page.evaluate(() => document.documentElement.dataset.theme ?? 'unset')
    record.result = 'passed'
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error)
    // The failure screen is evidence too; a page that cannot be captured is not.
    await step('failure').catch(() => null)
  } finally {
    await context.tracing.stop({ path: path.join(out, 'trace.zip') })
    const video = page.video()
    await context.close()
    await browser.close()
    if (video !== null) {
      // Playwright names the video by a random id; give it a stable name.
      const recorded = await video.path()
      copyFileSync(recorded, path.join(out, 'journey.webm'))
      rmSync(recorded, { force: true })
    }
    const noted = Object.fromEntries(
      [...notes].map(([key, json]) => [key, v.parse(v.unknown(), JSON.parse(json))]),
    )
    writeFileSync(
      path.join(out, 'journey.json'),
      `${JSON.stringify({ ...record, notes: noted, steps }, null, 2)}\n`,
    )
  }
  console.log(JSON.stringify({ error: record.error, evidence: out, result: record.result, steps }))
  if (record.result !== 'passed') {
    process.exitCode = 1
  }
}

const seed = async (kind: string, name?: string): Promise<void> => {
  switch (kind) {
    case 'bearer': {
      console.log(JSON.stringify(await seeds.bearer()))
      return
    }
    case 'operator': {
      console.log(JSON.stringify(await seeds.operator()))
      return
    }
    case 'pass': {
      console.log(JSON.stringify(await seeds.pass(name)))
      return
    }
    case 'venue': {
      console.log(JSON.stringify(await seeds.venue(name)))
      return
    }
    default: {
      throw new Error(`unknown seed ${kind}; expected bearer, operator, pass or venue`)
    }
  }
}

const usage =
  'usage: verify.ts up <gate|app|dash> | doctor | seed <bearer|venue|pass|operator> [name] | drive <journey.ts> [out-dir] | down'

const [command, arg, extra] = process.argv.slice(2)
if (command === 'up' && arg !== undefined && isSurface(arg)) {
  await up(arg)
} else if (command === 'doctor') {
  await doctor()
} else if (command === 'seed' && arg !== undefined) {
  await seed(arg, extra)
} else if (command === 'drive' && arg !== undefined) {
  await drive(arg, extra)
} else if (command === 'down') {
  await down()
} else {
  throw new Error(usage)
}
