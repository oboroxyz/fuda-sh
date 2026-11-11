import { claimMessage } from '@fuda/sdk'
import type { Hex, RequirementDetail } from '@fuda/sdk'

import { applyAddressCard, cardFailureOf, issueAddressCard } from '../api.ts'
import type { CardFailure } from '../api.ts'
import type { PasskeyClaim } from './auth.ts'
import { licenceKeyFrom } from './member-secret.ts'
import type { LicenceScope } from './member-secret.ts'
import {
  defaultSensitiveIo,
  failureOfOpen,
  openMemberSecret,
  readVaultEntries,
  saveClaim,
} from './sensitive.ts'
import type { SensitiveClaim } from './sensitive.ts'

export type LicenceOutcome =
  | { kind: 'applied'; address: Hex }
  | { kind: 'received'; claim: Extract<SensitiveClaim | PasskeyClaim, { ok: true }> }
  | { kind: 'unmet'; address: Hex; detail: RequirementDetail }
  | { kind: 'failed'; failure: CardFailure | 'no_prf' }

export const receiveLicence = async (input: {
  action: 'apply' | 'claim'
  identity: 'none' | 'address'
  cardId: string
  cardTitle: string
  venue: string
  slug: string
  source: string | null
  token: string | null
  scope: LicenceScope
  only?: string
}): Promise<LicenceOutcome> => {
  const io = defaultSensitiveIo
  const opened = await openMemberSecret(io, input.only)
  if (opened.kind !== 'open') {
    return { failure: failureOfOpen(opened), kind: 'failed' }
  }
  if (input.identity === 'address') {
    const listed = await readVaultEntries(io, opened.secret)
    if (!listed.ok) {
      return { failure: 'secret_unopenable', kind: 'failed' }
    }
  }
  const key = await licenceKeyFrom(opened.secret, input.scope)
  if (input.action === 'apply') {
    const applied = await applyAddressCard(input.venue, input.slug, key.address, input.token)
    return applied.ok
      ? { address: key.address, kind: 'applied' }
      : { failure: cardFailureOf(applied), kind: 'failed' }
  }
  const signature = await key.signMessage({ message: claimMessage(input.cardId, key.address) })
  const issued = await issueAddressCard(
    input.venue,
    input.slug,
    key.address,
    signature,
    input.source,
    input.token,
  )
  if (!issued.ok) {
    return issued.error === 'requirement_unmet' && issued.requirement !== undefined
      ? { address: key.address, detail: issued.requirement.detail, kind: 'unmet' }
      : { failure: cardFailureOf(issued), kind: 'failed' }
  }
  if (input.identity === 'none') {
    return { claim: { body: issued.body, ok: true }, kind: 'received' }
  }
  const claim = await saveClaim(
    io,
    opened.secret,
    {
      cardTitle: input.cardTitle,
      licence: input.scope,
      uid: issued.body.uid,
      venue: input.venue,
    },
    issued.body,
  )
  return { claim, kind: 'received' }
}
