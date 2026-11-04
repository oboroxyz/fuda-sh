import { ADDRESS_RE } from '@fuda/sdk'

export interface IssueForm {
  level: 'bearer' | 'signed'
  memberId: string
  holder: string
  tier: number
  usageModel: number
}

// Mirrors the api's derivation rule (docs/specs/attestation-model.md#api-payloads-that-touch-attestations): exactly one identity key per
// level, so the request can never carry both holder and memberId.
export const issueBodyFrom = (f: IssueForm): Record<string, string | number> | null => {
  const common = { tier: f.tier, usageModel: f.usageModel }
  const memberId = f.memberId.trim()
  if (f.level === 'bearer') {
    return memberId === '' ? null : { memberId, ...common }
  }
  const holder = f.holder.trim()
  return ADDRESS_RE.test(holder) ? { holder, ...common } : null
}
