import { createWalletClient, http } from 'viem'

import { readTopologyMutationConfig } from '../src/deploy/config.ts'
import { createEnsPublicClient } from '../src/deploy/preflight.ts'
import { deployTopology } from '../src/deploy/topology.ts'
import { ENS_HACKATHON_CHAIN } from '../src/index.ts'

try {
  const config = readTopologyMutationConfig(process.env)
  const report = await deployTopology({
    config,
    onProgress: (progress) => {
      console.log(JSON.stringify(progress))
    },
    publicClient: createEnsPublicClient(config.rpcUrl),
    walletClient: createWalletClient({
      account: config.parentAccount,
      chain: ENS_HACKATHON_CHAIN,
      transport: http(config.rpcUrl),
    }),
  })
  console.log(JSON.stringify(report, null, 2))
} catch {
  console.error(JSON.stringify({ error: 'ENS topology deployment failed' }))
  process.exitCode = 1
}
