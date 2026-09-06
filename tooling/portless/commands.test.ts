import { describe, expect, it } from 'vitest'

import { buildPortlessCommand, buildProxyStartCommand, buildServiceCommand } from './commands.ts'

const root = '/repo'
const app = { name: 'app', path: 'apps/app' } as const
const api = { name: 'api', path: 'apps/api' } as const

describe('command construction', () => {
  it('wraps a selected app without a shell', () => {
    expect(buildPortlessCommand(root, app)).toStrictEqual({
      args: [
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
    expect(command.args).toStrictEqual([
      '--dir',
      '/repo/apps/api',
      'run',
      'dev',
      '--',
      '--port',
      '4321',
      '--ip',
      '127.0.0.1',
      '--var',
      'API_BASE_URL:https://api.localhost',
    ])
  })

  it('constructs Vite host and port arguments', () => {
    const command = buildServiceCommand(root, app, {
      HOST: '::1',
      PORT: '5173',
      PORTLESS_URL: 'https://app.localhost',
    })
    expect(command.args).toStrictEqual([
      '--dir',
      '/repo/apps/app',
      'run',
      'dev',
      '--',
      '--port',
      '5173',
      '--host',
      '::1',
    ])
  })

  it('starts the shared proxy without a shell', () => {
    expect(buildProxyStartCommand(root)).toStrictEqual({
      args: ['exec', 'portless', 'proxy', 'start'],
      command: 'pnpm',
      cwd: root,
    })
  })
})
