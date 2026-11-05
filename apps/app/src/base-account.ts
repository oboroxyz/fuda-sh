import { baseAccountProvider as createProvider } from '@fuda/libs/wallet'

import { CHAIN } from './config.ts'

export const baseAccountProvider = async () => await createProvider({ appChainIds: [CHAIN.id] })
