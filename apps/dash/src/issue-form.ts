import { ADDRESS_RE, META_ADDRESS_RE } from '@fuda/sdk'

export interface IssueForm {
  level: 'bearer' | 'signed' | 'private'
  memberId: string
  holder: string
  stealthMetaAddress: string
  tier: number
  usageModel: number
}

// Mirrors the api's derivation rule (spec §3): exactly one identity key per
// level, so the request can never carry both holder and memberId.
export const issueBodyFrom = (f: IssueForm): Record<string, string | number> | null => {
  const common = { tier: f.tier, usageModel: f.usageModel }
  const memberId = f.memberId.trim()
  if (f.level === 'bearer') {
    return memberId === '' ? null : { memberId, ...common }
  }
  if (f.level === 'signed') {
    const holder = f.holder.trim()
    return ADDRESS_RE.test(holder) ? { holder, ...common } : null
  }
  const stealthMetaAddress = f.stealthMetaAddress.trim()
  if (!META_ADDRESS_RE.test(stealthMetaAddress)) {
    return null
  }
  return memberId === '' ? { stealthMetaAddress, ...common } : { memberId, stealthMetaAddress, ...common }
}
