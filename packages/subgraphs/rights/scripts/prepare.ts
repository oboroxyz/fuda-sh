import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import * as v from 'valibot'

import { readMvpGraphConfig } from './read-mvp-config.ts'

interface PrepareOptions {
  rootDir: string
  targetsPath: string
  networkConfigPath: string
  templatePath: string
}

const NetworkConfigSchema = v.object({
  easAddress: v.pipe(v.string(), v.regex(/^0x[0-9a-fA-F]{40}$/u)),
  network: v.literal('base-sepolia'),
})

const renderVersions = (
  name: string,
  constantName: string,
  versions: readonly { uid: `0x${string}`; version: number }[],
) => {
  const assignments = versions
    .map(
      ({ uid, version }) => `  versions.set('${uid}', BigInt.fromI32(${version}))\n  // version: ${version}`,
    )
    .join('\n')
  return `const build${name}Versions = (): TypedMap<string, BigInt> => {
  const versions = new TypedMap<string, BigInt>()
${assignments}
  return versions
}

export const ${constantName}_SCHEMA_VERSIONS = build${name}Versions()`
}

const renderSchemaUids = (schemas: ReturnType<typeof readMvpGraphConfig>['schemas']): string =>
  [
    "import { BigInt, TypedMap } from '@graphprotocol/graph-ts'",
    renderVersions('Entitlement', 'ENTITLEMENT', schemas.entitlement),
    renderVersions('IssuerDelegation', 'ISSUER_DELEGATION', schemas.issuerDelegation),
    renderVersions('Attendance', 'ATTENDANCE', schemas.attendance),
    '',
  ].join('\n\n')

export const prepareRightsSubgraph = async (options: PrepareOptions): Promise<void> => {
  const graphConfig = readMvpGraphConfig(options.targetsPath)
  const networkJson: unknown = JSON.parse(await readFile(options.networkConfigPath, 'utf-8'))
  const network = v.parse(NetworkConfigSchema, networkJson)
  const template = await readFile(options.templatePath, 'utf-8')
  const manifest = template
    .replaceAll('__NETWORK__', network.network)
    .replaceAll('__EAS_ADDRESS__', network.easAddress)
    .replaceAll('__GRAPH_START_BLOCK__', String(graphConfig.startBlock))

  if (/__[A-Z_]+__/u.test(manifest)) {
    throw new Error('Subgraph template contains an unresolved placeholder')
  }

  await mkdir(path.join(options.rootDir, 'src'), { recursive: true })
  await Promise.all([
    writeFile(path.join(options.rootDir, 'src/schema-uids.ts'), renderSchemaUids(graphConfig.schemas)),
    writeFile(path.join(options.rootDir, 'subgraph.yaml'), manifest),
  ])
}

export const runPrepareCli = async (): Promise<void> => {
  const rootDir = path.resolve(import.meta.dirname, '..')
  await prepareRightsSubgraph({
    networkConfigPath: path.join(rootDir, 'config/base-sepolia.json'),
    rootDir,
    targetsPath: path.resolve(rootDir, '../../../apps/api/targets.jsonc'),
    templatePath: path.join(rootDir, 'subgraph.template.yaml'),
  })
}

if (process.argv[1] === import.meta.filename) {
  await runPrepareCli()
}
