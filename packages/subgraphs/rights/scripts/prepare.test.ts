import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { prepareRightsSubgraph } from './prepare.mjs'

const ENTITLEMENT_V1 = `0x${'11'.repeat(32)}`
const ENTITLEMENT_V2 = `0x${'22'.repeat(32)}`
const DELEGATION_V1 = `0x${'33'.repeat(32)}`
const ATTENDANCE_V1 = `0x${'44'.repeat(32)}`

const liveSchemas = {
  attendance: [{ uid: ATTENDANCE_V1, version: 1 }],
  entitlement: [
    { uid: ENTITLEMENT_V1, version: 1 },
    { uid: ENTITLEMENT_V2, version: 2 },
  ],
  issuerDelegation: [{ uid: DELEGATION_V1, version: 1 }],
}

interface FixtureSchemas {
  attendance: { uid: string; version: number }[]
  entitlement: { uid: string; version: number }[]
  issuerDelegation: { uid: string; version: number }[]
}

const fixture = async (schemas: FixtureSchemas, startBlock: string) => {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'fuda-rights-prepare-'))
  const scriptsDir = path.join(rootDir, 'scripts')
  const configDir = path.join(rootDir, 'config')
  await Promise.all([mkdir(scriptsDir, { recursive: true }), mkdir(configDir, { recursive: true })])

  const wranglerPath = path.join(rootDir, 'wrangler.jsonc')
  const networkConfigPath = path.join(configDir, 'base-sepolia.json')
  const templatePath = path.join(rootDir, 'subgraph.template.yaml')
  await Promise.all([
    writeFile(
      wranglerPath,
      JSON.stringify({
        vars: {
          ANNOUNCER_FROM_BLOCK: startBlock,
          EAS_SCHEMAS: JSON.stringify(schemas),
        },
      }),
    ),
    writeFile(
      networkConfigPath,
      JSON.stringify({
        announcerAddress: '0x55649E01B5Df198D18D95b5cc5051630cfD45564',
        easAddress: '0x4200000000000000000000000000000000000021',
        network: 'base-sepolia',
      }),
    ),
    writeFile(
      templatePath,
      [
        'network: __NETWORK__',
        'eas: __EAS_ADDRESS__',
        'announcer: __ANNOUNCER_ADDRESS__',
        'startBlock: __ANNOUNCER_FROM_BLOCK__',
      ].join('\n'),
    ),
  ])

  return { networkConfigPath, rootDir, templatePath, wranglerPath }
}

describe(prepareRightsSubgraph, () => {
  it('preserves every accepted schema version in generated AssemblyScript', async () => {
    const options = await fixture(liveSchemas, '123')

    await prepareRightsSubgraph(options)

    const constants = await readFile(path.join(options.rootDir, 'src/schema-uids.ts'), 'utf-8')
    expect(constants).toMatch(
      new RegExp(
        [ENTITLEMENT_V1, 'version: 1', ENTITLEMENT_V2, 'version: 2', DELEGATION_V1, ATTENDANCE_V1].join('.*'),
        'su',
      ),
    )
  })

  it('renders the network addresses and positive start block into the manifest', async () => {
    const options = await fixture(liveSchemas, '456')

    await prepareRightsSubgraph(options)

    const manifest = await readFile(path.join(options.rootDir, 'subgraph.yaml'), 'utf-8')
    expect(manifest).toContain('network: base-sepolia')
    expect(manifest).toContain('eas: 0x4200000000000000000000000000000000000021')
    expect(manifest).toContain('announcer: 0x55649E01B5Df198D18D95b5cc5051630cfD45564')
    expect(manifest).toContain('startBlock: 456')
    expect(manifest).not.toMatch(/__[A-Z_]+__/u)
  })

  it('fails without populated top-level production schemas and start block', async () => {
    const options = await fixture({ attendance: [], entitlement: [], issuerDelegation: [] }, '0')

    await expect(prepareRightsSubgraph(options)).rejects.toThrow(Error)
    await expect(readFile(path.join(options.rootDir, 'subgraph.yaml'), 'utf-8')).rejects.toThrow(Error)
  })
})
