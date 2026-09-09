import { baseAccountProvider as createProvider } from '@fuda/libs/wallet'

export const baseAccountProvider = async () => await createProvider({ appChainIds: [84_532] })
