import type { Requirement } from '@fuda/sdk'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'

import { ChainError } from '../src/chain/client.ts'
import { FakeChain } from '../src/chain/fake-chain.ts'
import { requirementAdapters } from '../src/requirements/registry.ts'
import { HOLDER, other } from './fixtures.ts'

const config: Requirement = {
  assetId: `0x${'aa'.repeat(32)}`,
  kind: 'erc8432-agreement',
  registry: `0x${'bb'.repeat(20)}`,
  termsId: `0x${'cc'.repeat(32)}`,
}
const id: Hex = `0x${'dd'.repeat(32)}`
const adapter = requirementAdapters[config.kind]
const seeded = () => {
  const chain = new FakeChain()
  chain.seedAgreement({ ...config, creationMode: 0, holder: HOLDER, id, termsId: config.termsId ?? id })
  return chain
}

describe('ERC-8432 requirement', () => {
  it.each([undefined, id])('accepts a grant with hint %s', async (hint) => {
    const chain = seeded()

    const result = await adapter.claimCheck(chain, config, HOLDER, hint)
    if (!result.met) {
      throw new Error(result.detail)
    }
    await expect(adapter.presentationCheck(chain, config, HOLDER, result.evidence)).resolves.toStrictEqual({
      met: true,
    })
    await expect(
      adapter.presentationCheck(chain, config, other.address, result.evidence),
    ).resolves.toStrictEqual({ detail: 'agreement-inactive', met: false })
  })

  it('reports no agreement, self-acquisition and different terms', async () => {
    await expect(adapter.claimCheck(new FakeChain(), config, HOLDER)).resolves.toStrictEqual({
      detail: 'no-agreement',
      met: false,
    })
    const chain = seeded()
    chain.seedAgreement({ ...config, creationMode: 1, holder: HOLDER, id, termsId: config.termsId ?? id })
    await expect(adapter.claimCheck(chain, config, HOLDER)).resolves.toStrictEqual({
      detail: 'not-granted',
      met: false,
    })
    chain.seedAgreement({ ...config, creationMode: 0, holder: HOLDER, id, termsId: id })
    await expect(adapter.claimCheck(chain, config, HOLDER)).resolves.toStrictEqual({
      detail: 'wrong-terms',
      met: false,
    })
    const { termsId: _terms, ...anyTerms } = config
    await expect(adapter.claimCheck(chain, anyTerms, HOLDER)).resolves.toMatchObject({ met: true })
  })

  it.each([{ revoked: true }, { frozen: true }, { expiry: 1n }, { holder: other.address }])(
    'rejects an inactive agreement %s',
    async (change) => {
      const chain = seeded()
      const result = await adapter.claimCheck(chain, config, HOLDER)
      chain.seedAgreement({
        ...config,
        creationMode: 0,
        holder: HOLDER,
        id,
        termsId: config.termsId ?? id,
        ...change,
      })
      await expect(adapter.claimCheck(chain, config, HOLDER, id)).resolves.toStrictEqual({
        detail: 'agreement-inactive',
        met: false,
      })
      if (!result.met) {
        throw new Error(result.detail)
      }
      {
        await expect(
          adapter.presentationCheck(chain, config, HOLDER, result.evidence),
        ).resolves.toStrictEqual({ detail: 'agreement-inactive', met: false })
      }
    },
  )

  it.each([0, 1000])('searches the newest 1000 records, with a hint for older grant %i', async (granted) => {
    const chain = new FakeChain()
    for (let index = 0; index < 1001; index += 1) {
      chain.seedAgreement({
        ...config,
        creationMode: index === granted ? 0 : 1,
        holder: HOLDER,
        id: `0x${index.toString(16).padStart(64, '0')}`,
        termsId: config.termsId ?? id,
      })
    }
    await expect(adapter.claimCheck(chain, config, HOLDER)).resolves.toMatchObject({ met: granted === 1000 })
    await expect(
      adapter.claimCheck(chain, config, HOLDER, `0x${granted.toString(16).padStart(64, '0')}`),
    ).resolves.toMatchObject({ met: true })
  })

  it('counts examined records even on empty filtered pages', async () => {
    const chain = seeded()
    await expect(chain.agreementCountOf(config.registry, config.assetId)).resolves.toBe(1n)
    await expect(
      chain.activeAgreementsOf(config.registry, config.assetId, other.address, 0n, 1n),
    ).resolves.toStrictEqual({ agreementIds: [], nextCursor: 1n })
  })

  it('propagates chain failures', async () => {
    const chain = seeded()
    const result = await adapter.claimCheck(chain, config, HOLDER)
    chain.failReads = true
    await expect(adapter.claimCheck(chain, config, HOLDER)).rejects.toBeInstanceOf(ChainError)
    if (!result.met) {
      throw new Error(result.detail)
    }
    {
      await expect(adapter.presentationCheck(chain, config, HOLDER, result.evidence)).rejects.toBeInstanceOf(
        ChainError,
      )
    }
  })
})
