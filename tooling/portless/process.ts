import { spawn } from 'node:child_process'

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
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- accepts EventEmitter and process listener APIs; their return values are unused.
  off: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
  // oxlint-disable-next-line anti-slop/no-unknown-returns -- accepts EventEmitter and process listener APIs; their return values are unused.
  on: (event: 'SIGINT' | 'SIGTERM', listener: () => void) => unknown
}

export type StartCommand = (spec: CommandSpec) => RunningCommand

const signalStatuses = new Map<NodeJS.Signals, number>([
  ['SIGHUP', 129],
  ['SIGINT', 130],
  ['SIGQUIT', 131],
  ['SIGABRT', 134],
  ['SIGKILL', 137],
  ['SIGTERM', 143],
])

export const exitStatus = (exit: CommandExit): number =>
  exit.code ?? (exit.signal === null ? 1 : (signalStatuses.get(exit.signal) ?? 1))

export const startCommand: StartCommand = (spec) => {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: process.env,
    shell: false,
    stdio: 'inherit',
  })
  const { promise: completed, resolve } = Promise.withResolvers<CommandExit>()
  let settled = false
  const finish = (exit: CommandExit): void => {
    if (settled) {
      return
    }
    settled = true
    // oxlint-disable-next-line eslint/no-use-before-define -- both callbacks exist before either child listener is registered.
    child.off('exit', onExit)
    // oxlint-disable-next-line eslint/no-use-before-define -- both callbacks exist before either child listener is registered.
    child.off('error', onError)
    resolve(exit)
  }
  const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
    finish({ code, signal })
  }
  const onError = (error: Error): void => {
    console.error(`Could not run ${spec.command} ${spec.args.join(' ')}: ${error.message}`)
    finish({ code: 1, signal: null })
  }
  child.once('exit', onExit)
  child.once('error', onError)
  return {
    completed,
    kill: (signal) => {
      if (!settled) {
        child.kill(signal)
      }
    },
  }
}

export const supervise = async (
  commands: readonly RunningCommand[],
  signalSource: SignalSource = process,
): Promise<number> => {
  if (commands.length === 0) {
    return 0
  }
  const settled = new Set<number>()
  let shutdownStatus: number | undefined
  const signalUnsettled = (signal: NodeJS.Signals): void => {
    for (const [index, command] of commands.entries()) {
      if (!settled.has(index)) {
        command.kill(signal)
      }
    }
  }
  const shutdown = (signal: 'SIGINT' | 'SIGTERM'): void => {
    if (shutdownStatus === undefined) {
      shutdownStatus = exitStatus({ code: null, signal })
      signalUnsettled(signal)
    }
  }
  const onInterrupt = (): void => {
    shutdown('SIGINT')
  }
  const onTerminate = (): void => {
    shutdown('SIGTERM')
  }
  signalSource.on('SIGINT', onInterrupt)
  signalSource.on('SIGTERM', onTerminate)
  try {
    const completions = commands.map(async (command, index) => {
      const exit = await command.completed
      settled.add(index)
      return exit
    })
    const firstExit = await Promise.race(completions)
    if (shutdownStatus === undefined) {
      shutdownStatus = exitStatus(firstExit)
      signalUnsettled('SIGTERM')
    }
    await Promise.all(completions)
    return shutdownStatus
  } finally {
    signalSource.off('SIGINT', onInterrupt)
    signalSource.off('SIGTERM', onTerminate)
  }
}
