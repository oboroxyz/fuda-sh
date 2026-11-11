import { Erc8432AgreementRequirement, formatAgreementEvidence, parseAgreementEvidence } from '@fuda/sdk'
import type { RequirementDetail, Requirement } from '@fuda/sdk'
import type { Hex } from 'viem'

import type { ChainClient } from '../chain/client.ts'
import type { ClaimResult, RequirementAdapter } from './adapter.ts'

// AgreementCreationMode.GRANT in the reference's IPAssetTypes: the asset owner created it.
const GRANT = 0

const checkAgreement = async (
  chain: ChainClient,
  config: Requirement,
  holder: Hex,
  id: Hex,
): Promise<ClaimResult> => {
  const agreement = await chain.agreementOf(config.registry, id)
  if (
    agreement.assetId.toLowerCase() !== config.assetId ||
    !(await chain.isActiveAgreementHolder(config.registry, id, config.assetId, holder))
  ) {
    return { detail: 'agreement-inactive', met: false }
  }
  if (agreement.creationMode !== GRANT) {
    return { detail: 'not-granted', met: false }
  }
  if (config.termsId !== undefined && agreement.termsId.toLowerCase() !== config.termsId) {
    return { detail: 'wrong-terms', met: false }
  }
  return {
    evidence: formatAgreementEvidence({
      agreementId: id,
      chainId: chain.chainId(),
      registry: config.registry,
    }),
    met: true,
  }
}

export const erc8432Agreement = {
  claimCheck: async (chain, config, holder, agreementId?: Hex) => {
    if (agreementId !== undefined) {
      return await checkAgreement(chain, config, holder, agreementId)
    }
    const count = await chain.agreementCountOf(config.registry, config.assetId)
    const end = count
    let cursor = count > 1000n ? count - 1000n : 0n
    let detail: RequirementDetail = 'no-agreement'
    while (cursor < end) {
      const limit = end - cursor < 100n ? end - cursor : 100n
      // oxlint-disable-next-line no-await-in-loop -- each page needs the preceding cursor
      const page = await chain.activeAgreementsOf(config.registry, config.assetId, holder, cursor, limit)
      for (const id of page.agreementIds) {
        // oxlint-disable-next-line no-await-in-loop -- stop at the first acceptable agreement and bound RPC work
        const result = await checkAgreement(chain, config, holder, id)
        if (result.met) {
          return result
        }
        ;({ detail } = result)
      }
      if (page.nextCursor <= cursor) {
        break
      }
      cursor = page.nextCursor
    }
    return { detail: count > 1000n ? 'no-agreement' : detail, met: false }
  },
  kind: 'erc8432-agreement',
  presentationCheck: async (chain, config, holder, evidence) => {
    const parsed = parseAgreementEvidence(evidence)
    const met =
      parsed !== null &&
      parsed.chainId === chain.chainId() &&
      parsed.registry === config.registry &&
      (await chain.isActiveAgreementHolder(config.registry, parsed.agreementId, config.assetId, holder))
    return met ? { met: true } : { detail: 'agreement-inactive', met: false }
  },
  schema: Erc8432AgreementRequirement,
  subject: 'address',
} satisfies RequirementAdapter & { schema: typeof Erc8432AgreementRequirement }
