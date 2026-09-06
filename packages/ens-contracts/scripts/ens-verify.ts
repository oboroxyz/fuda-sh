import { readTopologyVerificationConfig } from '../src/deploy/config.ts'
import { createEnsPublicClient } from '../src/deploy/preflight.ts'
import { verifyTopology } from '../src/deploy/verify.ts'

try {
  const config = readTopologyVerificationConfig(process.env)
  const report = await verifyTopology(
    { config, publicClient: createEnsPublicClient(config.rpcUrl) },
    {
      registrarAddress: config.registrarAddress,
      resolverAddress: config.resolverAddress,
      userRegistryAddress: config.userRegistryAddress,
    },
  )
  console.log(JSON.stringify(report, null, 2))
} catch {
  console.error(JSON.stringify({ error: 'ENS topology verification failed' }))
  process.exitCode = 1
}
