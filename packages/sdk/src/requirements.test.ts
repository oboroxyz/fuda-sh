import * as v from 'valibot'
import { describe, expect, it } from 'vitest'

import type { Hex } from './constants.ts'
import {
  CardRequirement,
  CardRequirements,
  formatAgreementEvidence,
  parseAgreementEvidence,
  REQUIREMENT_KINDS,
} from './requirements.ts'

const registry: Hex = `0x${'Ab'.repeat(20)}`
const assetId = `0x${'CD'.repeat(32)}`
const termsId = `0x${'ef'.repeat(32)}`
const base = { assetId, kind: 'erc8432-agreement', registry }

describe('a requirement', () => {
  it('lists the kinds a requirement can have', () => {
    expect(REQUIREMENT_KINDS).toStrictEqual(['erc8432-agreement'])
  })

  it('lower-cases the registry, the asset and the terms at parse time', () => {
    expect(v.parse(CardRequirement, { ...base, termsId })).toStrictEqual({
      assetId: assetId.toLowerCase(),
      kind: 'erc8432-agreement',
      registry: registry.toLowerCase(),
      termsId,
    })
  })

  it('leaves termsId out when none was given', () => {
    expect(v.parse(CardRequirement, base)).not.toHaveProperty('termsId')
  })

  it.each([
    ['an unknown kind', { ...base, kind: 'nft-ownership' }],
    ['a short registry', { ...base, registry: '0x1234' }],
    ['an asset that is not 32 bytes', { ...base, assetId: `0x${'cd'.repeat(20)}` }],
    ['terms that are not hex', { ...base, termsId: 'terms' }],
    ['an extra field', { ...base, chainId: 84_532 }],
    ['a missing asset', { kind: 'erc8432-agreement', registry }],
  ])('rejects %s', (_label, input) => {
    expect(v.safeParse(CardRequirement, input).success).toBe(false)
  })
})

const entry = (index: number) => ({ ...base, assetId: `0x${index.toString(16).padStart(64, '0')}` })

describe('a list of requirements', () => {
  it('accepts up to four requirements and no more', () => {
    expect(v.safeParse(CardRequirements, [1, 2, 3, 4].map(entry)).success).toBe(true)
    expect(v.safeParse(CardRequirements, [1, 2, 3, 4, 5].map(entry)).success).toBe(false)
  })
})

describe('agreement evidence URI', () => {
  const agreementId: Hex = `0x${'12'.repeat(32)}`

  it('round-trips and folds hex to lower case', () => {
    const uri = formatAgreementEvidence({ agreementId, chainId: 84_532, registry })
    expect(uri).toBe(`ipagreement:84532:${registry.toLowerCase()}/${agreementId}`)
    expect(parseAgreementEvidence(uri)).toStrictEqual({
      agreementId,
      chainId: 84_532,
      registry: registry.toLowerCase(),
    })
    expect(parseAgreementEvidence(uri.toUpperCase().replace('IPAGREEMENT', 'ipagreement'))).toBeNull()
  })

  it.each([
    'ipagreement:84532:0x1234/0x12',
    `ipagreement:0:${registry}/${agreementId}`,
    `ipagreement:084532:${registry}/${agreementId}`,
    `ipagreement:84532:${registry}:${agreementId}`,
    `ipasset:84532:${registry}/${agreementId}`,
    `ipagreement:84532:${registry}/${agreementId}/extra`,
  ])('refuses %s', (raw) => {
    expect(parseAgreementEvidence(raw)).toBeNull()
  })
})
