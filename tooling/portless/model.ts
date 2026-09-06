import { readFileSync } from 'node:fs'
import nodePath from 'node:path'

export const APP_PATHS = ['apps/app', 'apps/api', 'apps/gate', 'apps/dash'] as const
export type AppPath = (typeof APP_PATHS)[number]

export interface PortlessApp {
  name: string
  path: AppPath
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- narrows untrusted package.json data at the registry boundary.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAppPath = (value: string): value is AppPath => APP_PATHS.some((path) => path === value)

const invalidRegistry = (detail: string): Error => new Error(`Invalid package.json portless.apps: ${detail}`)

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- parses untrusted package.json portless input at the registry boundary.
export const parsePortlessApps = (value: unknown): PortlessApp[] => {
  if (!isRecord(value)) {
    throw invalidRegistry('expected an object')
  }

  const { apps } = value
  if (!isRecord(apps)) {
    throw invalidRegistry('expected apps to be an object')
  }

  for (const path of APP_PATHS) {
    if (!Object.hasOwn(apps, path)) {
      throw invalidRegistry(`missing path ${path}`)
    }
  }

  const names = new Set<string>()
  const portlessApps: PortlessApp[] = []
  for (const [path, app] of Object.entries(apps)) {
    if (!isAppPath(path)) {
      throw invalidRegistry(`unregistered path ${path}`)
    }
    if (
      !isRecord(app) ||
      Object.keys(app).length !== 1 ||
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- validates an untrusted manifest field at the registry boundary.
      typeof app.name !== 'string' ||
      app.name.length === 0
    ) {
      throw invalidRegistry(`invalid entry for path ${path}`)
    }
    if (names.has(app.name)) {
      throw invalidRegistry(`duplicate name ${app.name}`)
    }
    names.add(app.name)
    portlessApps.push({ name: app.name, path })
  }
  return portlessApps
}

export const loadPortlessApps = (rootDir: string): PortlessApp[] => {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(nodePath.join(rootDir, 'package.json'), 'utf-8'))
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'could not read package.json'
    throw invalidRegistry(detail)
  }
  return parsePortlessApps(isRecord(manifest) ? manifest.portless : undefined)
}

export const selectPortlessApps = (apps: readonly PortlessApp[], selectedPath?: string): PortlessApp[] => {
  if (selectedPath === undefined) {
    return [...apps]
  }

  const selected = apps.find((app) => app.path === selectedPath)
  if (selected === undefined) {
    throw invalidRegistry(`unregistered path ${selectedPath}`)
  }
  return [selected]
}
