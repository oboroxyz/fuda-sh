import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadPortlessApps, parsePortlessApps, selectPortlessApps } from './model.ts'

const valid = {
  // oxlint-disable-next-line eslint/sort-keys -- fixture order verifies configuration order.
  apps: {
    'apps/app': { name: 'app' },
    'apps/api': { name: 'api' },
    'apps/gate': { name: 'gate' },
    'apps/dash': { name: 'dash' },
  },
}

describe(parsePortlessApps, () => {
  it('returns all four entries in configuration order', () => {
    expect(parsePortlessApps(valid)).toStrictEqual([
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
        'apps/api': { name: 'same' },
        'apps/app': { name: 'same' },
      },
    },
  ])('rejects an invalid registry %#', (value) => {
    expect(() => parsePortlessApps(value)).toThrow(/portless\.apps/u)
  })
})

describe(selectPortlessApps, () => {
  it('selects one path and rejects an unregistered path', () => {
    const apps = parsePortlessApps(valid)
    expect(selectPortlessApps(apps, 'apps/gate')).toStrictEqual([{ name: 'gate', path: 'apps/gate' }])
    expect(() => selectPortlessApps(apps, 'apps/other')).toThrow(/apps\/other/u)
  })
})

describe(loadPortlessApps, () => {
  it('loads all four entries from the root manifest', () => {
    const root = new URL('../..', import.meta.url)
    expect(loadPortlessApps(fileURLToPath(root))).toStrictEqual([
      { name: 'app', path: 'apps/app' },
      { name: 'api', path: 'apps/api' },
      { name: 'gate', path: 'apps/gate' },
      { name: 'dash', path: 'apps/dash' },
    ])
  })
})
