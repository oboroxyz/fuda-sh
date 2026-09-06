import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { exitStatus, startCommand, supervise } from './process.ts'
import type { CommandExit } from './process.ts'

vi.mock(import('node:child_process'), () => ({
  // Vitest models the last overload; these tests exercise only spawn(command, args, options).
  spawn: vi.fn<typeof spawn>() as unknown as typeof spawn,
}))

// oxlint-disable-next-line unicorn/prefer-event-target -- the production boundary uses Node process/ChildProcess EventEmitter semantics.
const signalEmitter = () => new EventEmitter()

const fakeChild = () => {
  const child = Object.assign(signalEmitter(), { kill: vi.fn<(signal: NodeJS.Signals) => boolean>() })
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>)
  return child
}

const fakeRunningCommand = () => {
  const { promise: completed, resolve } = Promise.withResolvers<CommandExit>()
  const kill = vi.fn<(signal: NodeJS.Signals) => void>()
  return { command: { completed, kill }, kill, resolve }
}

describe('exit status', () => {
  it.each<[CommandExit, number]>([
    [{ code: 0, signal: null }, 0],
    [{ code: 7, signal: null }, 7],
    [{ code: null, signal: 'SIGHUP' }, 129],
    [{ code: null, signal: 'SIGINT' }, 130],
    [{ code: null, signal: 'SIGQUIT' }, 131],
    [{ code: null, signal: 'SIGABRT' }, 134],
    [{ code: null, signal: 'SIGKILL' }, 137],
    [{ code: null, signal: 'SIGTERM' }, 143],
    [{ code: null, signal: null }, 1],
  ])('normalizes %# to %s', (exit, expected) => {
    expect(exitStatus(exit)).toBe(expected)
  })
})

describe('supervision', () => {
  it.each(['SIGINT', 'SIGTERM'] as const)('forwards %s once and waits for every child', async (signal) => {
    const signals = signalEmitter()
    const first = fakeRunningCommand()
    const second = fakeRunningCommand()
    const finished = vi.fn<() => void>()
    const completion = supervise([first.command, second.command], signals)
    void completion.then(finished)
    signals.emit(signal)
    expect([first.kill.mock.calls, second.kill.mock.calls]).toStrictEqual([[[signal]], [[signal]]])
    first.resolve({ code: 0, signal: null })
    await first.command.completed
    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    expect(second.kill).toHaveBeenCalledExactlyOnceWith(signal)
    second.resolve({ code: null, signal })
    await expect(completion).resolves.toBe(signal === 'SIGINT' ? 130 : 143)
    expect({
      first: first.kill.mock.calls,
      listeners: signals.eventNames(),
      second: second.kill.mock.calls,
    }).toStrictEqual({ first: [[signal]], listeners: [], second: [[signal]] })
  })

  it.each([0, 7])('terminates siblings and preserves the first spontaneous exit %s', async (code) => {
    const signals = signalEmitter()
    const first = fakeRunningCommand()
    const second = fakeRunningCommand()
    const completion = supervise([first.command, second.command], signals)
    first.resolve({ code, signal: null })
    await vi.waitFor(() => {
      expect(second.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
    })
    expect(first.kill).not.toHaveBeenCalled()
    second.resolve({ code: null, signal: 'SIGTERM' })
    await expect(completion).resolves.toBe(code)
    expect(signals.listenerCount('SIGINT')).toBe(0)
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })

  it('does not signal children that have already completed', async () => {
    const first = fakeRunningCommand()
    const second = fakeRunningCommand()
    first.resolve({ code: 7, signal: null })
    second.resolve({ code: 0, signal: null })
    await expect(supervise([first.command, second.command], signalEmitter())).resolves.toBe(7)
    expect(first.kill).not.toHaveBeenCalled()
    expect(second.kill).not.toHaveBeenCalled()
  })

  it('preserves existing signal listeners', async () => {
    const signals = signalEmitter()
    const existing = vi.fn<() => void>()
    signals.on('SIGINT', existing)
    const child = fakeRunningCommand()
    child.resolve({ code: 0, signal: null })
    await expect(supervise([child.command], signals)).resolves.toBe(0)
    expect(signals.listeners('SIGINT')).toStrictEqual([existing])
    expect(signals.listenerCount('SIGTERM')).toBe(0)
  })
})

describe('spawn boundary', () => {
  const spec = { args: ['exec', 'portless', 'run', '--name', 'app'], command: 'pnpm', cwd: '/repo' } as const
  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('spawns with inherited IO and environment without a shell', async () => {
    const child = fakeChild()
    const running = startCommand({ ...spec, args: [...spec.args] })
    expect(spawn).toHaveBeenCalledExactlyOnceWith('pnpm', [...spec.args], {
      cwd: '/repo',
      env: process.env,
      shell: false,
      stdio: 'inherit',
    })
    running.kill('SIGINT')
    expect(child.kill).toHaveBeenCalledExactlyOnceWith('SIGINT')
    child.emit('exit', null, 'SIGINT')
    await expect(running.completed).resolves.toStrictEqual({ code: null, signal: 'SIGINT' })
    expect(child.listenerCount('exit')).toBe(0)
    expect(child.listenerCount('error')).toBe(0)
  })

  it('settles a spawn error once and removes exit listeners', async () => {
    const child = fakeChild()
    const log = vi.spyOn(console, 'error').mockImplementation(vi.fn<typeof console.error>())
    const running = startCommand({ ...spec, args: [...spec.args] })
    const error = new Error('spawn pnpm ENOENT')
    child.emit('error', error)
    child.emit('exit', 0, null)
    await expect(running.completed).resolves.toStrictEqual({ code: 1, signal: null })
    expect(log).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/pnpm.*ENOENT/u))
    expect(child.eventNames()).toStrictEqual([])
    running.kill('SIGTERM')
    expect(child.kill).not.toHaveBeenCalled()
  })
})
