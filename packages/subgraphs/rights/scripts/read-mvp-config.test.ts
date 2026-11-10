import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { readMvpGraphConfig } from './read-mvp-config.ts'

const UID_A = `0x${'A'.repeat(64)}`
const UID_B = `0x${'b'.repeat(64)}`
const UID_C = `0x${'c'.repeat(64)}`
const UID_D = `0x${'d'.repeat(64)}`

const schemas = {
  attendance: [{ uid: UID_D, version: 3 }],
  entitlement: [
    { uid: UID_A, version: 1 },
    { uid: UID_B, version: 2 },
  ],
  issuerDelegation: [{ uid: UID_C, version: 1 }],
}

const writeTargets = async (config: unknown): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fuda-graph-config-'))
  const configPath = path.join(directory, 'targets.jsonc')
  await writeFile(configPath, JSON.stringify(config))
  return configPath
}

const vars = (overrides: Record<string, string> = {}) => ({
  EAS_SCHEMAS: JSON.stringify(schemas),
  GRAPH_START_BLOCK: '12345',
  ...overrides,
})

describe(readMvpGraphConfig, () => {
  it('accepts JSONC comments and trailing commas', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fuda-graph-config-'))
    const configPath = path.join(directory, 'targets.jsonc')
    await writeFile(
      configPath,
      `{
        // The api targets file is JSONC.
        "develop": {
          "vars": {
            "GRAPH_START_BLOCK": "7",
            "EAS_SCHEMAS": ${JSON.stringify(JSON.stringify(schemas))},
          },
        },
      }`,
    )

    expect(readMvpGraphConfig(configPath).startBlock).toBe(7)
  })

  it('reads every schema family and version from the develop target by default', async () => {
    const configPath = await writeTargets({ develop: { vars: vars() } })

    expect(readMvpGraphConfig(configPath)).toStrictEqual({
      schemas: {
        attendance: [{ uid: UID_D, version: 3 }],
        entitlement: [
          { uid: UID_A.toLowerCase(), version: 1 },
          { uid: UID_B, version: 2 },
        ],
        issuerDelegation: [{ uid: UID_C, version: 1 }],
      },
      startBlock: 12_345,
    })
  })

  it('reads an explicitly selected target', async () => {
    const configPath = await writeTargets({
      develop: { vars: vars() },
      production: { vars: vars({ GRAPH_START_BLOCK: '99' }) },
    })

    expect(readMvpGraphConfig(configPath, { target: 'production' }).startBlock).toBe(99)
  })

  it.each([
    ['missing EAS_SCHEMAS', { GRAPH_START_BLOCK: '1' }],
    ['empty schema family', vars({ EAS_SCHEMAS: JSON.stringify({ ...schemas, attendance: [] }) })],
    [
      'malformed UID',
      vars({
        EAS_SCHEMAS: JSON.stringify({
          ...schemas,
          attendance: [{ uid: '0x1234', version: 3 }],
        }),
      }),
    ],
    [
      'duplicate UID',
      vars({
        EAS_SCHEMAS: JSON.stringify({
          ...schemas,
          entitlement: [
            { uid: UID_A, version: 1 },
            { uid: UID_A.toLowerCase(), version: 2 },
          ],
        }),
      }),
    ],
    [
      'duplicate version',
      vars({
        EAS_SCHEMAS: JSON.stringify({
          ...schemas,
          entitlement: [
            { uid: UID_A, version: 1 },
            { uid: UID_B, version: 1 },
          ],
        }),
      }),
    ],
    ['zero start block', vars({ GRAPH_START_BLOCK: '0' })],
    ['negative start block', vars({ GRAPH_START_BLOCK: '-1' })],
  ])('rejects %s', async (_name, selectedVars) => {
    const configPath = await writeTargets({ develop: { vars: selectedVars } })

    expect(() => readMvpGraphConfig(configPath)).toThrow(Error)
  })
})
