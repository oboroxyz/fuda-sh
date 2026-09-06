import { readPublicConfig } from '../src/deploy/config.ts'
import { createEnsPublicClient, runPreflight } from '../src/deploy/preflight.ts'

try {
  const config = readPublicConfig(process.env)
  const report = await runPreflight(createEnsPublicClient(config.rpcUrl), config)
  console.log(JSON.stringify(report, null, 2))
} catch (error) {
  console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'ENS preflight failed' }))
  process.exitCode = 1
}
