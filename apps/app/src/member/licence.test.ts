import { claimMessage } from '@fuda/sdk'
import { verifyMessage } from 'viem'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as api from '../api.ts'
import { receiveLicence } from './licence.ts'
import * as sensitive from './sensitive.ts'

const address = '0xd9c68db0260b6f725cecb060F118cAb847D81D10'
const input = {
  action: 'claim',
  cardId: 'art-card',
  cardTitle: 'Art club',
  identity: 'address',
  scope: { assetId: `0x${'cd'.repeat(32)}`, chainId: 84_532, registry: `0x${'ab'.repeat(20)}` },
  slug: 'fans',
  source: 'invitation',
  token: null,
  venue: 'art-club',
} as const
const issued = {
  holder: address,
  level: 'signed',
  memberNumber: 'qj2yxphepdrka',
  passUrls: { apple: '', google: '', web: '' },
  qr: '',
  uid: `0x${'ab'.repeat(32)}`,
} as const
const open = (): void => {
  vi.spyOn(sensitive, 'openMemberSecret').mockResolvedValue({
    kind: 'open',
    secret: new Uint8Array(32).fill(1),
  })
  vi.spyOn(sensitive, 'readVaultEntries').mockResolvedValue({ entries: [], ok: true, version: 0 })
}

describe('receiving a licence pass', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('applies using the asset address without issuing a pass', async () => {
    open()
    const apply = vi.spyOn(api, 'applyAddressCard').mockResolvedValue({ body: { applied: true }, ok: true })
    const claim = vi.spyOn(api, 'issueAddressCard')
    await expect(receiveLicence({ ...input, action: 'apply' })).resolves.toStrictEqual({
      address,
      kind: 'applied',
    })
    expect(apply).toHaveBeenCalledWith('art-club', 'fans', address, null)
    expect(claim).not.toHaveBeenCalled()
  })

  it('signs the SDK claim message and saves the licence scope in the vault', async () => {
    open()
    const claim = vi.spyOn(api, 'issueAddressCard').mockResolvedValue({ body: issued, ok: true })
    const save = vi
      .spyOn(sensitive, 'saveClaim')
      .mockResolvedValue({ body: issued, ok: true, saved: 'vault' })
    const outcome = await receiveLicence(input)
    expect(outcome.kind).toBe('received')
    const signature = claim.mock.calls[0]?.[3]
    expect(signature).toBeDefined()
    if (signature === undefined) {
      throw new Error('No claim signature')
    }
    await expect(
      verifyMessage({ address, message: claimMessage(input.cardId, address), signature }),
    ).resolves.toBe(true)
    expect(save).toHaveBeenCalledWith(
      sensitive.defaultSensitiveIo,
      new Uint8Array(32).fill(1),
      {
        cardTitle: input.cardTitle,
        licence: input.scope,
        uid: issued.uid,
        venue: input.venue,
      },
      issued,
    )
  })

  it('receives a Standard pass without reading or writing the Vault', async () => {
    open()
    const body = { ...issued, level: 'bearer', qr: `fuda:v1:${issued.uid}` } as const
    vi.spyOn(api, 'issueAddressCard').mockResolvedValue({ body, ok: true })
    const save = vi.spyOn(sensitive, 'saveClaim')
    await expect(receiveLicence({ ...input, identity: 'none' })).resolves.toStrictEqual({
      claim: { body, ok: true },
      kind: 'received',
    })
    expect(sensitive.readVaultEntries).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it.each(['no-agreement', 'not-granted', 'wrong-terms', 'agreement-inactive'] as const)(
    'reports %s without saving a pass',
    async (detail) => {
      open()
      vi.spyOn(api, 'issueAddressCard').mockResolvedValue({
        error: 'requirement_unmet',
        network: false,
        ok: false,
        requirement: { detail, kind: 'erc8432-agreement' },
        status: 403,
      })
      const save = vi.spyOn(sensitive, 'saveClaim')
      await expect(receiveLicence(input)).resolves.toStrictEqual({ address, detail, kind: 'unmet' })
      expect(save).not.toHaveBeenCalled()
    },
  )

  it('stops before applying when the passkey has no PRF result', async () => {
    vi.spyOn(sensitive, 'openMemberSecret').mockResolvedValue({ kind: 'no_prf' })
    const apply = vi.spyOn(api, 'applyAddressCard')
    await expect(receiveLicence({ ...input, action: 'apply' })).resolves.toStrictEqual({
      failure: 'no_prf',
      kind: 'failed',
    })
    expect(apply).not.toHaveBeenCalled()
  })
})
