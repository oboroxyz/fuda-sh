# Portless Local Development Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide root `pnpm dev` and `pnpm dev:<surface>` commands that run all four fuda surfaces through worktree-safe Portless URLs while preserving the existing direct workspace commands.

**Architecture:** The root `package.json` owns the Portless app registry. A root TypeScript launcher reads that registry, wraps selected services with `portless run`, adapts Portless's dynamic environment to Vite+ or Wrangler arguments, and supervises child processes. A shared Vite helper uses the current public Portless URL to configure a same-origin `/api` proxy and the member app's WebAuthn origin values.

**Tech Stack:** TypeScript 7, Node.js 24, pnpm 11, Portless 0.15.6, Vite+ 0.3, Vitest 4, Wrangler 4

**Spec:** `.superpowers/specs/2026-09-06-portless-local-development-design.md`

## Global Constraints

- Pin `portless` at exactly `0.15.6` in the root `devDependencies`.
- Store every Portless setting in the root `package.json`; do not create `portless.json` or edit any `apps/*/package.json`.
- Register exactly `apps/app` as `app`, `apps/api` as `api`, `apps/gate` as `gate`, and `apps/dash` as `dash`.
- Do not configure fixed `appPort` values; backing ports must remain dynamic and worktree-safe.
- Keep `pnpm --filter <name> dev` behavior unchanged, including its existing fixed port and frontend configuration defaults.
- In Portless mode, browser API calls must use a same-origin `/api` path; do not expand the API CORS allow-list.
- Support the default `.localhost` naming layout and Portless's optional single worktree-prefix label. LAN mode, tunnels, and custom TLDs are out of scope.
- Build commands as executable-plus-argument arrays and spawn without a shell; never interpolate a URL or port into a shell command.
- Follow test-driven development and the repository's near-full-strict Vite+ lint configuration.
- Create all implementation in this repository; do not copy code or designs from another repository.

## File map

- `tooling/portless/model.ts` — validate and select the root `portless.apps` registry.
- `tooling/portless/environment.ts` — validate Portless's child environment and derive sibling API origins.
- `tooling/portless/commands.ts` — construct shell-free Portless, Vite+, and Wrangler command specifications.
- `tooling/portless/vite.ts` — return the Portless-only Vite `define` and `/api` proxy additions.
- `tooling/portless/process.ts` — spawn commands, normalize exit status, forward signals, and supervise a group.
- `tooling/portless/dev.ts` — thin coordinator/service-mode CLI.
- `tooling/portless/*.test.ts` — colocated unit tests for each boundary.
- `package.json` / `pnpm-lock.yaml` — dependency, app registry, root commands, and root tooling test entry point.
- `apps/{app,gate,dash}/vite.config.ts` — opt into the shared helper only when `PORTLESS_URL` exists.
- `README.md` — contributor commands, named URLs, TLS first-run behavior, and direct-command compatibility.
- `docs/specs/pass-types-and-flows.md` — durable local surface, API routing, and WebAuthn behavior.

---

### Task 1: Root Portless registry boundary

**Files:**
- Create: `tooling/portless/model.ts`
- Test: `tooling/portless/model.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the unknown value at root `package.json#portless`
- Produces: `AppPath`, `PortlessApp`, `parsePortlessApps(value)`, `loadPortlessApps(rootDir)`, and `selectPortlessApps(apps, selectedPath?)`

- [ ] **Step 1: Write registry parsing and selection tests**

  Create `tooling/portless/model.test.ts` with an inline valid registry, so the tests do not pass merely because the real root manifest is correct:

  ```ts
  import { describe, expect, it } from 'vitest'

  import { parsePortlessApps, selectPortlessApps } from './model.ts'

  const valid = {
    apps: {
      'apps/app': { name: 'app' },
      'apps/api': { name: 'api' },
      'apps/gate': { name: 'gate' },
      'apps/dash': { name: 'dash' },
    },
  }

  describe('parsePortlessApps', () => {
    it('returns all four entries in configuration order', () => {
      expect(parsePortlessApps(valid)).toEqual([
        { name: 'app', path: 'apps/app' },
        { name: 'api', path: 'apps/api' },
        { name: 'gate', path: 'apps/gate' },
        { name: 'dash', path: 'apps/dash' },
      ])
    })

    it.each([
      undefined,
      {},
      { apps: [] },
      { apps: { ...valid.apps, 'apps/app': {} } },
      { apps: { ...valid.apps, 'apps/app': { name: '' } } },
      { apps: { ...valid.apps, 'apps/other': { name: 'other' } } },
      {
        apps: {
          ...valid.apps,
          'apps/app': { name: 'same' },
          'apps/api': { name: 'same' },
        },
      },
    ])('rejects an invalid registry %#', (value) => {
      expect(() => parsePortlessApps(value)).toThrow(/portless\.apps/u)
    })
  })

  it('selects one path and rejects an unregistered path', () => {
    const apps = parsePortlessApps(valid)
    expect(selectPortlessApps(apps, 'apps/gate')).toEqual([{ name: 'gate', path: 'apps/gate' }])
    expect(() => selectPortlessApps(apps, 'apps/other')).toThrow(/apps\/other/u)
  })
  ```

- [ ] **Step 2: Run the focused test and verify the red state**

  Run:

  ```bash
  pnpm exec vp test tooling/portless/model.test.ts
  ```

  Expected: FAIL because `tooling/portless/model.ts` does not exist.

- [ ] **Step 3: Implement the registry model**

  Create `tooling/portless/model.ts` with these public types and functions:

  ```ts
  export const APP_PATHS = ['apps/app', 'apps/api', 'apps/gate', 'apps/dash'] as const
  export type AppPath = (typeof APP_PATHS)[number]

  export interface PortlessApp {
    name: string
    path: AppPath
  }

  export declare const parsePortlessApps: (value: unknown) => PortlessApp[]
  export declare const loadPortlessApps: (rootDir: string) => PortlessApp[]
  export declare const selectPortlessApps: (
    apps: readonly PortlessApp[],
    selectedPath?: string,
  ) => PortlessApp[]
  ```

  Implement the bodies without an untyped cast chain: narrow records with a small `isRecord` guard, require `apps` to be a record, require exactly the four `APP_PATHS`, require each entry to contain only a non-empty string `name`, and reject duplicate names. `loadPortlessApps` reads `<rootDir>/package.json`, parses JSON, and passes its `portless` value to `parsePortlessApps`. Every thrown message starts with `Invalid package.json portless.apps:` and identifies the offending path or name.

- [ ] **Step 4: Add the pinned dependency, root registry, and tooling test entry point**

  Run:

  ```bash
  pnpm add --save-dev --workspace-root --save-exact portless@0.15.6
  ```

  Then add the exact `portless.apps` object from the design spec and change the root test command to include root tooling tests:

  ```json
  {
    "scripts": {
      "test": "vp run -r test && vp test tooling/portless"
    },
    "devDependencies": {
      "portless": "0.15.6"
    },
    "portless": {
      "apps": {
        "apps/app": { "name": "app" },
        "apps/api": { "name": "api" },
        "apps/gate": { "name": "gate" },
        "apps/dash": { "name": "dash" }
      }
    }
  }
  ```

  Preserve all existing scripts and dependencies around these additions. Let pnpm update `pnpm-lock.yaml`; do not hand-edit the lockfile.

- [ ] **Step 5: Verify the real manifest and focused tests**

  Add a test that resolves the repository root from `import.meta.url`, calls `loadPortlessApps(root)`, and expects the same four `PortlessApp` values as the inline fixture. Then run:

  ```bash
  pnpm exec vp test tooling/portless/model.test.ts
  pnpm check
  ```

  Expected: both commands pass.

- [ ] **Step 6: Commit the registry boundary**

  ```bash
  git add package.json pnpm-lock.yaml tooling/portless/model.ts tooling/portless/model.test.ts
  git commit -m "chore: add portless workspace registry"
  ```

### Task 2: Portless environment and command adaptation

**Files:**
- Create: `tooling/portless/environment.ts`
- Test: `tooling/portless/environment.test.ts`
- Create: `tooling/portless/commands.ts`
- Test: `tooling/portless/commands.test.ts`

**Interfaces:**
- Consumes: `PortlessApp` from Task 1 and Portless child values `PORT`, `HOST`, `PORTLESS_URL`
- Produces: `ServiceEnvironment`, `parseServiceEnvironment(app, env)`, `deriveApiOrigin(publicUrl, appName)`, `CommandSpec`, `buildProxyStartCommand(rootDir)`, `buildPortlessCommand(rootDir, app)`, and `buildServiceCommand(rootDir, app, env)`

- [ ] **Step 1: Write failing environment tests**

  Create `tooling/portless/environment.test.ts` with these cases:

  ```ts
  import { describe, expect, it } from 'vitest'

  import { deriveApiOrigin, parseServiceEnvironment } from './environment.ts'

  const app = { name: 'app', path: 'apps/app' } as const

  it.each([
    ['https://app.localhost', 'https://api.localhost'],
    ['https://feature-auth.app.localhost', 'https://feature-auth.api.localhost'],
    ['http://app.localhost:1355', 'http://api.localhost:1355'],
  ])('derives the matching API origin from %s', (input, expected) => {
    expect(deriveApiOrigin(input, 'app')).toBe(expected)
  })

  it.each([
    'https://gate.localhost',
    'https://one.two.app.localhost',
    'https://user:pass@app.localhost',
    'https://app.localhost/path',
    'https://app.localhost?query=yes',
    'https://app.example.com',
  ])('rejects an unsupported app URL: %s', (input) => {
    expect(() => deriveApiOrigin(input, 'app')).toThrow(/PORTLESS_URL/u)
  })

  it('parses a complete loopback service environment', () => {
    expect(
      parseServiceEnvironment(app, {
        HOST: '127.0.0.1',
        PORT: '4321',
        PORTLESS_URL: 'https://app.localhost',
      }),
    ).toMatchObject({
      apiOrigin: 'https://api.localhost',
      host: '127.0.0.1',
      hostname: 'app.localhost',
      port: 4321,
      publicOrigin: 'https://app.localhost',
    })
  })
  ```

  Add table cases for a missing value, port `0`, port `65536`, non-integer port, non-loopback host, and URL/name mismatch. Each must identify `PORT`, `HOST`, or `PORTLESS_URL` in its error.

- [ ] **Step 2: Run the environment test and verify the red state**

  ```bash
  pnpm exec vp test tooling/portless/environment.test.ts
  ```

  Expected: FAIL because `environment.ts` does not exist.

- [ ] **Step 3: Implement strict environment and URL parsing**

  Create `tooling/portless/environment.ts` with this interface:

  ```ts
  import type { PortlessApp } from './model.ts'

  export interface ServiceEnvironment {
    apiOrigin: string
    host: '127.0.0.1' | '::1'
    hostname: string
    port: number
    publicOrigin: string
  }

  export declare const deriveApiOrigin: (publicUrl: string, appName: string) => string
  export declare const parseServiceEnvironment: (
    app: PortlessApp,
    env: Readonly<Record<string, string | undefined>>,
  ) => ServiceEnvironment
  ```

  Accept only `http:` or `https:`, no credentials, and URL pathname `/` with empty search/hash. Split the hostname into labels and accept only `[appName, 'localhost']` or `[worktreePrefix, appName, 'localhost']`; require every label to be non-empty. Replace only the validated app-name label with `api`, preserve protocol and explicit port, and serialize without a trailing slash. Accept only `127.0.0.1` and `::1` as `HOST`. Parse `PORT` with a digits-only expression before checking the integer range 1–65535.

- [ ] **Step 4: Write failing command-construction tests**

  Create `tooling/portless/commands.test.ts` and assert full arrays, not joined command strings:

  ```ts
  import { expect, it } from 'vitest'

  import { buildPortlessCommand, buildProxyStartCommand, buildServiceCommand } from './commands.ts'

  const root = '/repo'
  const app = { name: 'app', path: 'apps/app' } as const
  const api = { name: 'api', path: 'apps/api' } as const

  it('wraps a selected app without a shell', () => {
    expect(buildPortlessCommand(root, app)).toEqual({
      args: [
        'exec', 'portless', 'run', '--name', 'app', '--',
        'pnpm', 'exec', 'tsx', 'tooling/portless/dev.ts', '--service', 'apps/app',
      ],
      command: 'pnpm',
      cwd: root,
    })
  })

  it('constructs the Wrangler override as one argument', () => {
    const command = buildServiceCommand(root, api, {
      HOST: '127.0.0.1',
      PORT: '4321',
      PORTLESS_URL: 'https://api.localhost',
    })
    expect(command.args).toEqual([
      '--dir', '/repo/apps/api', 'run', 'dev', '--',
      '--port', '4321', '--ip', '127.0.0.1',
      '--var', 'API_BASE_URL:https://api.localhost',
    ])
  })
  ```

  Also assert the Vite command's `--port`/`--host` arguments and
  `buildProxyStartCommand(root) === { command: 'pnpm', args: ['exec', 'portless', 'proxy', 'start'], cwd: root }`.

- [ ] **Step 5: Run the command test and verify the red state**

  ```bash
  pnpm exec vp test tooling/portless/commands.test.ts
  ```

  Expected: FAIL because `commands.ts` does not exist.

- [ ] **Step 6: Implement command specifications**

  Create `tooling/portless/commands.ts` with no process-spawning side effects:

  ```ts
  import type { PortlessApp } from './model.ts'

  export interface CommandSpec {
    args: string[]
    command: 'pnpm'
    cwd: string
  }

  export const buildProxyStartCommand = (rootDir: string): CommandSpec => ({
    args: ['exec', 'portless', 'proxy', 'start'],
    command: 'pnpm',
    cwd: rootDir,
  })

  export const buildPortlessCommand = (rootDir: string, app: PortlessApp): CommandSpec => ({
    args: [
      'exec',
      'portless',
      'run',
      '--name',
      app.name,
      '--',
      'pnpm',
      'exec',
      'tsx',
      'tooling/portless/dev.ts',
      '--service',
      app.path,
    ],
    command: 'pnpm',
    cwd: rootDir,
  })
  ```

  `buildServiceCommand` first calls `parseServiceEnvironment`. It uses `path.join(rootDir, app.path)` after the `AppPath` validation from Task 1. Its common prefix is `['--dir', appDir, 'run', 'dev', '--']`. Append `['--port', String(port), '--host', host]` for `apps/app`, `apps/gate`, and `apps/dash`; append `['--port', String(port), '--ip', host, '--var', `API_BASE_URL:${publicOrigin}`]` for `apps/api`.

- [ ] **Step 7: Run both focused suites and commit**

  ```bash
  pnpm exec vp test tooling/portless/environment.test.ts tooling/portless/commands.test.ts
  pnpm check
  git add tooling/portless/environment.ts tooling/portless/environment.test.ts tooling/portless/commands.ts tooling/portless/commands.test.ts
  git commit -m "feat: adapt dev services to portless"
  ```

  Expected: tests and checks pass; the commit contains only pure environment and command construction.

### Task 3: Same-origin Vite API proxy

**Files:**
- Create: `tooling/portless/vite.ts`
- Test: `tooling/portless/vite.test.ts`
- Modify: `apps/app/vite.config.ts`
- Modify: `apps/gate/vite.config.ts`
- Modify: `apps/dash/vite.config.ts`

**Interfaces:**
- Consumes: `deriveApiOrigin(publicUrl, surface)` from Task 2 and optional `process.env.PORTLESS_URL`
- Produces: `portlessViteOverrides(surface, publicUrl?)` returning `undefined` outside Portless or `{ define, proxy }` in Portless mode

- [ ] **Step 1: Write failing Vite override tests**

  Create `tooling/portless/vite.test.ts`:

  ```ts
  import { describe, expect, it } from 'vitest'

  import { portlessViteOverrides } from './vite.ts'

  describe('portlessViteOverrides', () => {
    it('does nothing outside Portless', () => {
      expect(portlessViteOverrides('gate', undefined)).toBeUndefined()
    })

    it('adds a same-origin proxy for a worktree frontend', () => {
      const overrides = portlessViteOverrides('gate', 'https://feature-auth.gate.localhost')
      expect(overrides?.define).toEqual({
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
      })
      expect(overrides?.proxy['/api']).toMatchObject({
        changeOrigin: true,
        target: 'https://feature-auth.api.localhost',
      })
      expect(overrides?.proxy['/api'].rewrite('/api/health')).toBe('/health')
      expect(overrides?.proxy['/api'].rewrite('/api')).toBe('/')
    })

    it('sets the member origin and exact WebAuthn hostname', () => {
      expect(portlessViteOverrides('app', 'https://feature-auth.app.localhost')?.define).toEqual({
        'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
        'import.meta.env.VITE_APP_ORIGIN': JSON.stringify('https://feature-auth.app.localhost'),
        'import.meta.env.VITE_RP_ID': JSON.stringify('feature-auth.app.localhost'),
      })
    })
  })
  ```

  Add one assertion each for `dash` and for an invalid `PORTLESS_URL` propagating the strict Task 2 error.

- [ ] **Step 2: Run the Vite helper test and verify the red state**

  ```bash
  pnpm exec vp test tooling/portless/vite.test.ts
  ```

  Expected: FAIL because `vite.ts` does not exist.

- [ ] **Step 3: Implement the Vite override helper**

  Create `tooling/portless/vite.ts`:

  ```ts
  import { env } from 'node:process'

  import { deriveApiOrigin } from './environment.ts'

  export type FrontendName = 'app' | 'dash' | 'gate'

  export interface PortlessViteOverrides {
    define: Record<string, string>
    proxy: Record<
      '/api',
      { changeOrigin: true; rewrite: (path: string) => string; target: string }
    >
  }

  export declare const portlessViteOverrides: (
    surface: FrontendName,
    publicUrl?: string,
  ) => PortlessViteOverrides | undefined
  ```

  Implement the optional parameter as `publicUrl = env.PORTLESS_URL`, using the explicit `node:process` import so the app TypeScript configurations do not need Node globals. Parse `publicUrl` once to obtain the member hostname. Build the rewrite with an anchored `/^\/api(?=\/|$)/u` expression and return `/` when removing the prefix produces an empty string. Do not mutate the environment.

- [ ] **Step 4: Integrate the helper into all three Vite configs**

  In each config, import the helper with the appropriate relative path, evaluate it once, and conditionally spread only its additions. The app shape is:

  ```ts
  import { portlessViteOverrides } from '../../tooling/portless/vite.ts'

  const portless = portlessViteOverrides('app')

  export default defineConfig({
    ...(portless === undefined ? {} : { define: portless.define }),
    plugins: [tailwindcss()],
    server: {
      port: 5173,
      ...(portless === undefined ? {} : { proxy: portless.proxy }),
      strictPort: true,
    },
    test: { environment: 'node', include: ['src/**/*.test.ts'], unstubGlobals: true },
  })
  ```

  Apply the same conditional form to `gate` on 5174 and `dash` on 5175. Preserve the existing direct-development port comments, updating them only to clarify that they describe non-Portless invocation.

- [ ] **Step 5: Verify both modes and commit**

  ```bash
  pnpm exec vp test tooling/portless/vite.test.ts apps/app/src/api.test.ts apps/gate/src/api.test.ts apps/dash/src/api.test.ts
  pnpm check
  git add tooling/portless/vite.ts tooling/portless/vite.test.ts apps/app/vite.config.ts apps/gate/vite.config.ts apps/dash/vite.config.ts
  git commit -m "feat: proxy local api through portless"
  ```

  Expected: the helper suite proves Portless mode and the existing API suites retain `http://localhost:8787` outside Portless.

### Task 4: Process supervision and root dev commands

**Files:**
- Create: `tooling/portless/process.ts`
- Test: `tooling/portless/process.test.ts`
- Create: `tooling/portless/dev.ts`
- Test: `tooling/portless/dev.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: app selection from Task 1 and command specifications from Task 2
- Produces: `RunningCommand`, `StartCommand`, `startCommand(spec)`, `exitStatus(exit)`, `supervise(commands, signalSource?)`, `run(argv, env, rootDir, start)`, and the five root dev scripts

- [ ] **Step 1: Write failing process tests with controllable children**

  Create `tooling/portless/process.test.ts`. Use deferred promises and an `EventEmitter` instead of real processes:

  ```ts
  import { EventEmitter } from 'node:events'
  import { describe, expect, it, vi } from 'vitest'

  import { exitStatus, supervise } from './process.ts'

  const fakeRunningCommand = () => {
    let resolve!: (exit: { code: number | null; signal: NodeJS.Signals | null }) => void
    const completed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolvePromise) => {
        resolve = resolvePromise
      },
    )
    const kill = vi.fn<(signal: NodeJS.Signals) => void>()
    return { command: { completed, kill }, kill, resolve }
  }

  it.each([
    [{ code: 0, signal: null }, 0],
    [{ code: 7, signal: null }, 7],
    [{ code: null, signal: 'SIGINT' as const }, 130],
    [{ code: null, signal: 'SIGTERM' as const }, 143],
  ])('normalizes %# to %s', (exit, expected) => {
    expect(exitStatus(exit)).toBe(expected)
  })

  it('forwards SIGINT and waits for every child', async () => {
    const signals = new EventEmitter()
    const first = fakeRunningCommand()
    const second = fakeRunningCommand()
    const completion = supervise([first.command, second.command], signals)
    signals.emit('SIGINT')
    expect(first.kill).toHaveBeenCalledWith('SIGINT')
    expect(second.kill).toHaveBeenCalledWith('SIGINT')
    first.resolve({ code: null, signal: 'SIGINT' })
    second.resolve({ code: null, signal: 'SIGINT' })
    await expect(completion).resolves.toBe(130)
  })
  ```

  Add a case where the first child exits `7`; assert the other child receives `SIGTERM`, resolves, and the group returns `7`. Add a case proving signal listeners are removed after completion. In the external-signal case, also assert that sibling completion does not cause a second `SIGTERM` after the already-forwarded `SIGINT`.

- [ ] **Step 2: Run the process suite and verify the red state**

  ```bash
  pnpm exec vp test tooling/portless/process.test.ts
  ```

  Expected: FAIL because `process.ts` does not exist.

- [ ] **Step 3: Implement shell-free process supervision**

  Create `tooling/portless/process.ts` with these contracts:

  ```ts
  import type { CommandSpec } from './commands.ts'

  export interface CommandExit {
    code: number | null
    signal: NodeJS.Signals | null
  }

  export interface RunningCommand {
    completed: Promise<CommandExit>
    kill: (signal: NodeJS.Signals) => void
  }

  export interface SignalSource {
    off: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
    on: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
  }

  export type StartCommand = (spec: CommandSpec) => RunningCommand

  export declare const exitStatus: (exit: CommandExit) => number
  export declare const startCommand: StartCommand
  export declare const supervise: (
    commands: readonly RunningCommand[],
    signalSource?: SignalSource,
  ) => Promise<number>
  ```

  Use `spawn(spec.command, spec.args, { cwd: spec.cwd, env: process.env, shell: false, stdio: 'inherit' })`. Convert both the child's `exit` event and pre-exit `error` event into exactly one `completed` resolution; a spawn error returns status 1 after logging the command and error. Map `SIGHUP`, `SIGINT`, `SIGQUIT`, `SIGABRT`, `SIGKILL`, and `SIGTERM` to conventional `128 + signal number` statuses. Track which child promises have settled. On the first completion without a preceding external signal, send `SIGTERM` only to unsettled siblings. After `SIGINT` or `SIGTERM` has already been forwarded, do not replace it with another signal. In both paths, `await Promise.all` for every child and remove the installed signal listeners in `finally`.

- [ ] **Step 4: Write failing CLI orchestration tests**

  Create `tooling/portless/dev.test.ts` with a fake `StartCommand` that records every `CommandSpec` and returns already-resolved exits. Cover:

  ```ts
  import { expect, it, vi } from 'vitest'

  import { run } from './dev.ts'
  import type { StartCommand } from './process.ts'

  const resolvedStarter = (code: number) =>
    vi.fn<StartCommand>(() => ({
      completed: Promise.resolve({ code, signal: null }),
      kill: vi.fn(),
    }))

  it('starts one configured surface without pre-starting the proxy', async () => {
    const start = resolvedStarter(0)
    await expect(run(['apps/app'], {}, repositoryRoot, start)).resolves.toBe(0)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start.mock.calls[0]?.[0].args).toContain('portless')
  })

  it('starts the proxy once before all four Portless children', async () => {
    const start = resolvedStarter(0)
    await expect(run([], {}, repositoryRoot, start)).resolves.toBe(0)
    expect(start).toHaveBeenCalledTimes(5)
    expect(start.mock.calls[0]?.[0].args).toEqual(['exec', 'portless', 'proxy', 'start'])
  })
  ```

  Add cases for `--service apps/api` producing the Wrangler spec, unknown arguments returning 1 without spawning, and proxy-start failure returning its status without spawning any service.

- [ ] **Step 5: Run the CLI suite and verify the red state**

  ```bash
  pnpm exec vp test tooling/portless/dev.test.ts
  ```

  Expected: FAIL because `dev.ts` does not exist.

- [ ] **Step 6: Implement the thin two-mode CLI**

  Create `tooling/portless/dev.ts` with an exported, dependency-injected entry point:

  ```ts
  import type { StartCommand } from './process.ts'

  export declare const run: (
    argv: readonly string[],
    env: Readonly<Record<string, string | undefined>>,
    rootDir: string,
    start: StartCommand,
  ) => Promise<number>
  ```

  Coordinator mode accepts either no arguments or one app path. Load and select the root registry. For all apps, start and await `buildProxyStartCommand` before starting services; stop immediately if that command is non-zero. Start one `buildPortlessCommand` per selection and return `supervise(...)`.

  Service mode accepts exactly `['--service', appPath]`. Select exactly one configured app, construct `buildServiceCommand(rootDir, app, env)`, start it, and supervise the single result. Reject every other argument shape with a concise usage line and status 1.

  Resolve the repository root with `fileURLToPath(new URL('../..', import.meta.url))`. At the bottom, detect direct execution by comparing `fileURLToPath(import.meta.url)` with `path.resolve(process.argv[1] ?? '')`, call `run(process.argv.slice(2), process.env, repositoryRoot, startCommand)`, catch validation/spawn errors into one concise `console.error`, and assign `process.exitCode` rather than calling `process.exit()`.

- [ ] **Step 7: Add root dev scripts**

  Add these exact entries without editing app manifests:

  ```json
  {
    "scripts": {
      "dev": "tsx tooling/portless/dev.ts",
      "dev:api": "tsx tooling/portless/dev.ts apps/api",
      "dev:app": "tsx tooling/portless/dev.ts apps/app",
      "dev:dash": "tsx tooling/portless/dev.ts apps/dash",
      "dev:gate": "tsx tooling/portless/dev.ts apps/gate"
    }
  }
  ```

- [ ] **Step 8: Verify orchestration and commit**

  ```bash
  pnpm exec vp test tooling/portless/process.test.ts tooling/portless/dev.test.ts
  pnpm test
  pnpm check
  git add package.json tooling/portless/process.ts tooling/portless/process.test.ts tooling/portless/dev.ts tooling/portless/dev.test.ts
  git commit -m "feat: add root portless dev commands"
  ```

  Expected: focused tests, every workspace suite, root tooling tests, lint, formatting, and types pass.

### Task 5: Contributor and canonical documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/specs/pass-types-and-flows.md`

**Interfaces:**
- Consumes: the working root commands and verified named-route behavior from Tasks 1–4
- Produces: current contributor instructions and durable local-development behavior

- [ ] **Step 1: Update the README development entry point**

  Add a concise named-development table immediately after the existing surface table:

  ```markdown
  For the complete local stack, run `pnpm dev`. Portless exposes the services at:

  | Root command | Local URL |
  | --- | --- |
  | `pnpm dev:app` | `https://app.localhost` |
  | `pnpm dev:api` | `https://api.localhost` |
  | `pnpm dev:gate` | `https://gate.localhost` |
  | `pnpm dev:dash` | `https://dash.localhost` |
  ```

  State that a selective frontend command needs `pnpm dev:api` in another terminal for live API calls, linked worktrees receive a branch prefix, Portless may request local-CA trust on first HTTPS use, and `pnpm exec portless doctor` diagnoses routing/trust. Keep the existing surface table as the direct fixed-port fallback and explicitly say those `pnpm --filter <name> dev` commands remain available.

  Replace the manual `VITE_API_BASE_URL`, `VITE_APP_ORIGIN`, and `VITE_RP_ID` local setup prose with the distinction: root Portless commands set/proxy them automatically; direct fixed-port commands retain the documented manual overrides.

- [ ] **Step 2: Update the canonical surface specification**

  In `docs/specs/pass-types-and-flows.md` under `## Surfaces`, retain the production host and direct dev-port table, then add these durable rules in prose:

  ```text
  Root Portless commands expose app, api, gate, and dash under HTTPS .localhost
  names. Linked worktrees prepend Portless's normalized branch label. In this
  mode each frontend calls same-origin /api; Vite strips that prefix and proxies
  to the matching worktree's api route. The API CORS allow-list is unchanged.

  Portless mode sets the member app origin to its public URL and its WebAuthn
  RP ID to that URL's exact hostname. Direct workspace commands keep their
  fixed ports and existing localhost/manual environment contract.
  ```

  Keep production `fuda.sh` / `app.fuda.sh` passkey behavior unchanged.

- [ ] **Step 3: Check documentation and commit**

  ```bash
  pnpm format:check
  git diff --check
  git add README.md docs/specs/pass-types-and-flows.md
  git commit -m "docs: document portless local development"
  ```

  Expected: formatting and whitespace checks pass, and the commit contains only durable documentation.

### Task 6: End-to-end verification and artifact cleanup

**Files:**
- Delete: `.superpowers/specs/2026-09-06-portless-local-development-design.md`
- Delete: `.superpowers/plans/2026-09-06-portless-local-development.md`

**Interfaces:**
- Consumes: all implemented commands, tests, and documentation
- Produces: a verified feature branch with no completed temporary artifacts

- [ ] **Step 1: Run the complete static and automated test suite**

  ```bash
  pnpm format:check
  pnpm lint
  pnpm typecheck
  pnpm test
  git diff --check
  ```

  Expected: every command exits 0. Treat transient workerd log noise as non-failing only when the test command itself exits 0 and reports all suites passed.

- [ ] **Step 2: Run an isolated Portless HTTP smoke test**

  From the feature worktree, use an isolated state directory and unprivileged proxy port so this check neither changes the normal Portless state nor installs a CA:

  ```bash
  smoke_state="$(mktemp -d)"
  export PORTLESS_STATE_DIR="$smoke_state"
  export PORTLESS_HTTPS=0
  export PORTLESS_PORT=41355
  export PORTLESS_SYNC_HOSTS=0
  pnpm dev >/tmp/fuda-portless-smoke.log 2>&1 &
  stack_pid=$!
  cleanup() {
    kill -INT "$stack_pid" 2>/dev/null || true
    wait "$stack_pid" 2>/dev/null || true
    pnpm exec portless proxy stop >/dev/null 2>&1 || true
  }
  trap cleanup EXIT
  ready=0
  for attempt in $(seq 1 60); do
    api_url="$(pnpm exec portless get api 2>/dev/null || true)"
    if [ -n "$api_url" ] && curl -fsS "$api_url/health" >/tmp/fuda-portless-api-health.json; then
      ready=1
      break
    fi
    sleep 0.5
  done
  test "$ready" -eq 1
  app_url="$(pnpm exec portless get app)"
  curl -fsS "$app_url/api/health" >/tmp/fuda-portless-app-health.json
  grep -F '"ok":true' /tmp/fuda-portless-api-health.json
  grep -F '"ok":true' /tmp/fuda-portless-app-health.json
  ```

  Expected: both direct API and frontend-proxied health responses contain `{"ok":true}`. Inspect `/tmp/fuda-portless-smoke.log` if readiness fails. Run `cleanup` before retrying with a different unprivileged `PORTLESS_PORT` if 41355 is occupied.

- [ ] **Step 3: Manually verify the default HTTPS setup without changing trust automatically**

  With the isolated smoke stack stopped and its environment variables unset, run:

  ```bash
  unset PORTLESS_STATE_DIR PORTLESS_HTTPS PORTLESS_PORT PORTLESS_SYNC_HOSTS
  pnpm exec portless doctor
  ```

  Expected: Portless reports the normal proxy/routing/trust state. If the local CA is not trusted, record that `pnpm dev` will request the documented first-run trust action; do not bypass or mutate the machine trust store during automated verification.

- [ ] **Step 4: Review the final implementation against every design requirement**

  ```bash
  git status --short
  git diff HEAD~4 -- package.json pnpm-lock.yaml tooling/portless apps/app/vite.config.ts apps/gate/vite.config.ts apps/dash/vite.config.ts README.md docs/specs/pass-types-and-flows.md
  rg -n "portless|PORTLESS_URL|/api" package.json tooling/portless apps/app/vite.config.ts apps/gate/vite.config.ts apps/dash/vite.config.ts README.md docs/specs/pass-types-and-flows.md
  ```

  Confirm from the output that all four root names exist once in `package.json`, no `appPort` exists, app manifests and CORS are unchanged, direct ports remain, command arguments are arrays, and canonical docs describe the verified behavior.

- [ ] **Step 5: Delete completed temporary artifacts and commit the lifecycle cleanup**

  ```bash
  git rm .superpowers/specs/2026-09-06-portless-local-development-design.md
  git rm .superpowers/plans/2026-09-06-portless-local-development.md
  git diff --cached --check
  git commit -m "chore: finish portless local development"
  ```

- [ ] **Step 6: Confirm the branch is ready for handoff**

  ```bash
  git status --short
  git log --oneline --decorate -7
  ```

  Expected: the worktree is clean, the design/plan deletions are committed, and the feature commits remain visible in history.
