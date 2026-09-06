import nodePath from 'node:path'

import { parseServiceEnvironment } from './environment.ts'
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

export const buildServiceCommand = (
  rootDir: string,
  app: PortlessApp,
  env: Readonly<Record<string, string | undefined>>,
): CommandSpec => {
  const { host, port, publicOrigin } = parseServiceEnvironment(app, env)
  const args = ['--dir', nodePath.join(rootDir, app.path), 'run', 'dev', '--port', String(port)]

  if (app.path === 'apps/api') {
    args.push('--ip', host, '--var', `API_BASE_URL:${publicOrigin}`)
  } else {
    args.push('--host', host)
  }

  return { args, command: 'pnpm', cwd: rootDir }
}
