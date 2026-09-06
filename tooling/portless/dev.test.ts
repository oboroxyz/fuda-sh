import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { run } from './dev.ts'
import type { CommandExit, StartCommand } from './process.ts'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const resolvedStarter = (code: number) =>
  vi.fn<StartCommand>(() => ({
    completed: Promise.resolve({ code, signal: null }),
    kill: vi.fn<(signal: NodeJS.Signals) => void>(),
  }))

describe('development launcher', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts one configured surface without pre-starting the proxy', async () => {
    const start = resolvedStarter(0)
    await expect(run(['apps/app'], {}, repositoryRoot, start)).resolves.toBe(0)
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0].args).toStrictEqual([
      'exec',
      'portless',
      'run',
      '--name',
      'app',
      '--',
      'pnpm',
      'exec',
      'tsx',
      'tooling/portless/dev.ts',
      '--service',
      'apps/app',
    ])
  })

  it('starts the proxy once before all four Portless children', async () => {
    const start = resolvedStarter(0)
    const proxy = Promise.withResolvers<CommandExit>()
    start.mockReturnValueOnce({ completed: proxy.promise, kill: vi.fn<(signal: NodeJS.Signals) => void>() })
    const completion = run([], {}, repositoryRoot, start)
    expect(start).toHaveBeenCalledOnce()
    expect(start.mock.calls[0]?.[0].args).toStrictEqual(['exec', 'portless', 'proxy', 'start'])
    proxy.resolve({ code: 0, signal: null })
    await expect(completion).resolves.toBe(0)
    expect(start).toHaveBeenCalledTimes(5)
    expect(start.mock.calls.slice(1).map(([spec]) => spec.args.at(-1))).toStrictEqual([
      'apps/app',
      'apps/api',
      'apps/gate',
      'apps/dash',
    ])
  })

  it('starts the configured Wrangler service with the injected environment', async () => {
    const start = resolvedStarter(7)
    await expect(
      run(
        ['--service', 'apps/api'],
        {
          HOST: '127.0.0.1',
          PORT: '4321',
          PORTLESS_URL: 'https://api.localhost',
        },
        repositoryRoot,
        start,
      ),
    ).resolves.toBe(7)
    expect(start).toHaveBeenCalledExactlyOnceWith({
      args: [
        '--dir',
        fileURLToPath(new URL('../../apps/api', import.meta.url)),
        'run',
        'dev',
        '--port',
        '4321',
        '--ip',
        '127.0.0.1',
        '--var',
        'API_BASE_URL:https://api.localhost',
      ],
      command: 'pnpm',
      cwd: repositoryRoot,
    })
  })

  it.each([
    ['--unknown'],
    ['apps/missing'],
    ['apps/app', 'apps/api'],
    ['--service'],
    ['--service', 'apps/missing'],
    ['--service', 'apps/api', 'extra'],
  ])('rejects unknown arguments %j without spawning', async (...argv) => {
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn<typeof console.error>())
    const start = resolvedStarter(0)
    await expect(run(argv, {}, repositoryRoot, start)).resolves.toBe(1)
    expect(start).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0]?.join(' ')).toContain('Usage:')
  })

  it('returns proxy-start failure without spawning services', async () => {
    const start = resolvedStarter(7)
    await expect(run([], {}, repositoryRoot, start)).resolves.toBe(7)
    expect(start).toHaveBeenCalledOnce()
  })

  it.each(['SIGINT', 'SIGTERM'] as const)(
    'forwards %s during proxy startup and waits without launching services',
    async (signal) => {
      const on = vi.spyOn(process, 'on')
      const proxy = Promise.withResolvers<CommandExit>()
      const kill = vi.fn<(signal: NodeJS.Signals) => void>()
      const start = resolvedStarter(0)
      start.mockReturnValueOnce({ completed: proxy.promise, kill })
      const finished = vi.fn<() => void>()
      const completion = run([], {}, repositoryRoot, start)
      void completion.then(finished)
      try {
        const handler = on.mock.calls.find(([event]) => event === signal)?.[1]
        handler?.()
        expect(kill).toHaveBeenCalledExactlyOnceWith(signal)
        await setImmediate()
        expect(finished).not.toHaveBeenCalled()
        expect(start).toHaveBeenCalledOnce()
      } finally {
        // Successful child cleanup must not erase the requested shutdown status.
        proxy.resolve({ code: 0, signal: null })
        await completion
      }
      await expect(completion).resolves.toBe(signal === 'SIGINT' ? 130 : 143)
      expect(start).toHaveBeenCalledOnce()
    },
  )
})
