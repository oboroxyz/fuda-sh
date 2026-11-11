import * as v from 'valibot'

import { ADDRESS_RE, UID_RE } from './constants.ts'
import type { Hex } from './constants.ts'

// docs/specs/card-requirements.md. A requirement names a record outside fuda that a member
// must hold. Each kind has its own config schema; the api's adapter for the kind reads it.
export const REQUIREMENT_KINDS = ['erc8432-agreement'] as const
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number]

export const MAX_REQUIREMENTS = 4

const lowerHex = (raw: string): Hex => `0x${raw.slice(2).toLowerCase()}`

// Lower-cased at parse time, so the stored config and the evidence URI never hold two
// spellings of one address.
const registryAddress = v.pipe(v.string(), v.regex(ADDRESS_RE), v.transform(lowerHex))
const bytes32 = v.pipe(v.string(), v.regex(UID_RE), v.transform(lowerHex))

export const Erc8432AgreementRequirement = v.strictObject({
  assetId: bytes32,
  kind: v.literal('erc8432-agreement'),
  registry: registryAddress,
  termsId: v.optional(bytes32),
})

export const CardRequirement = v.variant('kind', [Erc8432AgreementRequirement])
export type Requirement = v.InferOutput<typeof CardRequirement>
export type RequirementInput = v.InferInput<typeof CardRequirement>

export const CardRequirements = v.pipe(v.array(CardRequirement), v.maxLength(MAX_REQUIREMENTS))

export const REQUIREMENT_DETAILS = [
  'no-agreement',
  'not-granted',
  'wrong-terms',
  'agreement-inactive',
] as const
export type RequirementDetail = (typeof REQUIREMENT_DETAILS)[number]

// Why a requirement is not met, as an answer carries it.
export interface RequirementUnmet {
  kind: RequirementKind
  detail: RequirementDetail
}

// `ipagreement:<chainId>:<registry>/<agreementId>`: the evidence a pass keeps of the
// agreement that met an `erc8432-agreement` requirement.
const EVIDENCE_RE =
  /^ipagreement:(?<chainId>[1-9]\d*):(?<registry>0x[0-9a-fA-F]{40})\/(?<agreementId>0x[0-9a-fA-F]{64})$/u

export interface AgreementEvidence {
  chainId: number
  registry: Hex
  agreementId: Hex
}

export const formatAgreementEvidence = (evidence: AgreementEvidence): string =>
  `ipagreement:${evidence.chainId}:${evidence.registry.toLowerCase()}/${evidence.agreementId.toLowerCase()}`

export const parseAgreementEvidence = (raw: string): AgreementEvidence | null => {
  const groups = EVIDENCE_RE.exec(raw)?.groups
  const chainId = Number(groups?.chainId)
  if (groups === undefined || !Number.isSafeInteger(chainId)) {
    return null
  }
  return {
    agreementId: lowerHex(groups.agreementId ?? ''),
    chainId,
    registry: lowerHex(groups.registry ?? ''),
  }
}
