import { createWalletClient, http } from 'viem'

import { readParentMutationConfig, readPublicConfig } from '../src/deploy/config.ts'
import { commitParentName } from '../src/deploy/parent.ts'
import { createEnsPublicClient } from '../src/deploy/preflight.ts'
import { ENS_HACKATHON_CHAIN } from '../src/index.ts'

try {
  const config = readPublicConfig(process.env)
  const report = await commitParentName({
    config,
    loadMutation: () => {
      const mutationConfig = readParentMutationConfig(process.env)
      return {
        config: mutationConfig,
        walletClient: createWalletClient({
          account: mutationConfig.parentAccount,
          chain: ENS_HACKATHON_CHAIN,
          transport: http(config.rpcUrl),
        }),
      }
    },
    publicClient: createEnsPublicClient(config.rpcUrl),
  })
  console.log(JSON.stringify(report, null, 2))
} catch {
  console.error(JSON.stringify({ error: 'ENS parent commit failed' }))
  process.exitCode = 1
}
