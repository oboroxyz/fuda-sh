import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { readMvpGraphConfig } from './read-mvp-config.mjs'

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

const writeWrangler = async (config: unknown): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'fuda-graph-config-'))
  const configPath = path.join(directory, 'wrangler.jsonc')
  await writeFile(configPath, JSON.stringify(config))
  return configPath
}

const vars = (overrides: Record<string, string> = {}) => ({
  ANNOUNCER_FROM_BLOCK: '12345',
  EAS_SCHEMAS: JSON.stringify(schemas),
  ...overrides,
})

describe(readMvpGraphConfig, () => {
  it('accepts JSONC comments and trailing commas from Wrangler', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'fuda-graph-config-'))
    const configPath = path.join(directory, 'wrangler.jsonc')
    await writeFile(
      configPath,
      `{
        // Wrangler configuration remains JSONC.
        "vars": {
          "ANNOUNCER_FROM_BLOCK": "7",
          "EAS_SCHEMAS": ${JSON.stringify(JSON.stringify(schemas))},
        },
      }`,
    )

    expect(readMvpGraphConfig(configPath).announcerFromBlock).toBe(7)
  })

  it('reads every schema family and version from top-level production vars', async () => {
    const configPath = await writeWrangler({ vars: vars() })

    expect(readMvpGraphConfig(configPath)).toStrictEqual({
      announcerFromBlock: 12_345,
      schemas: {
        attendance: [{ uid: UID_D, version: 3 }],
        entitlement: [
          { uid: UID_A.toLowerCase(), version: 1 },
          { uid: UID_B, version: 2 },
        ],
        issuerDelegation: [{ uid: UID_C, version: 1 }],
      },
    })
  })

  it('reads an explicitly selected Wrangler environment', async () => {
    const configPath = await writeWrangler({
      env: { dev: { vars: vars({ ANNOUNCER_FROM_BLOCK: '99' }) } },
      vars: vars(),
    })

    expect(readMvpGraphConfig(configPath, { environment: 'dev' }).announcerFromBlock).toBe(99)
  })

  it.each([
    ['missing EAS_SCHEMAS', { ANNOUNCER_FROM_BLOCK: '1' }],
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
    ['zero start block', vars({ ANNOUNCER_FROM_BLOCK: '0' })],
    ['negative start block', vars({ ANNOUNCER_FROM_BLOCK: '-1' })],
  ])('rejects %s', async (_name, selectedVars) => {
    const configPath = await writeWrangler({ vars: selectedVars })

    expect(() => readMvpGraphConfig(configPath)).toThrow(Error)
  })
})
