import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildPortlessCommand, buildProxyStartCommand, buildServiceCommand } from './commands.ts'
import { APP_PATHS, loadPortlessApps, selectPortlessApps } from './model.ts'
import { exitStatus, startCommand, supervise } from './process.ts'
import type { StartCommand } from './process.ts'

export const run = async (
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  rootDir: string,
  start: StartCommand,
): Promise<number> => {
  const serviceMode = argv[0] === '--service'
  const selectedPath = serviceMode ? argv[1] : argv[0]
  if (
    (serviceMode ? argv.length !== 2 : argv.length > 1) ||
    (argv.length > 0 && !APP_PATHS.some((path) => path === selectedPath))
  ) {
    console.error(
      'Usage: tsx tooling/portless/dev.ts [apps/app|apps/api|apps/gate|apps/dash] | --service <app-path>',
    )
    return 1
  }
  const apps = selectPortlessApps(loadPortlessApps(rootDir), selectedPath)
  if (!serviceMode && selectedPath === undefined) {
    const status = exitStatus(await start(buildProxyStartCommand(rootDir)).completed)
    if (status !== 0) {
      return status
    }
  }
  const specs = apps.map((app) =>
    serviceMode ? buildServiceCommand(rootDir, app, env) : buildPortlessCommand(rootDir, app),
  )
  return await supervise(specs.map((spec) => start(spec)))
}

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))

// oxlint-disable-next-line unicorn/prefer-import-meta-properties -- use the same URL-to-path identity under direct tsx execution and Vite's module runner.
if (fileURLToPath(import.meta.url) === nodePath.resolve(process.argv[1] ?? '')) {
  try {
    process.exitCode = await run(process.argv.slice(2), process.env, repositoryRoot, startCommand)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
