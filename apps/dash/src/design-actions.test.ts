import type { CardCreateResponse, IssuerCreateResponse, IssuerView } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { EMPTY_FORM } from './card-designer.ts'
import { applyLogo, submitCard, submitVenue } from './design-actions.ts'
import type { DesignIo } from './design-actions.ts'
import type { LogoSet } from './logo.ts'
import { EMPTY_VENUE_FORM } from './venue.ts'

const HOLDER = `0x${'11'.repeat(20)}` as const

const pngOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

const logo: LogoSet = { logo1x: pngOf(1), logo2x: pngOf(2), logo3x: pngOf(3), master: pngOf(4) }

const venueForm = { ...EMPTY_VENUE_FORM, handle: 'wassie-coffee', name: 'Wassie Coffee' }

const issuer: IssuerView = {
  brandColor: '#6F4320',
  createdAt: 1_757_000_000,
  handle: 'wassie-coffee',
  id: 'issuer_1',
  logoUrl: null,
  name: 'Wassie Coffee',
  operatorAddress: HOLDER,
  tagline: '',
}

const created: Result<IssuerCreateResponse> = {
  body: {
    cards: [],
    ens: { claimTxHash: null, expiry: null, name: 'wassie-coffee.fuda.eth', status: 'unclaimed' },
    issuer,
    publicUrl: 'https://fuda.sh/@wassie-coffee',
  },
  ok: true,
}
const cardCreated: Result<CardCreateResponse> = {
  body: {
    card: {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      description: '',
      id: 'card_1',
      slug: 'membership-card',
      title: 'Membership Card',
      validFrom: null,
      validUntil: null,
      validityDays: null,
    },
    issuer,
    publicUrl: 'https://fuda.sh/@wassie-coffee',
  },
  ok: true,
}

const designIo = (overrides: Partial<DesignIo> = {}): DesignIo => ({
  commitLogo: vi.fn<DesignIo['commitLogo']>().mockResolvedValue({ body: { issuer }, ok: true }),
  createCard: vi.fn<DesignIo['createCard']>().mockResolvedValue(cardCreated),
  createIssuer: vi.fn<DesignIo['createIssuer']>().mockResolvedValue(created),
  uploadLogo: vi
    .fn<DesignIo['uploadLogo']>()
    .mockResolvedValue({ body: { expiresAt: 1_757_000_900, logoUploadId: 'up_1' }, ok: true }),
  ...overrides,
})

describe('the designer submit', () => {
  it('creates the venue from the registration form', async () => {
    const io = designIo()
    const outcome = await submitVenue(io, venueForm)
    expect(outcome.ok).toBe(true)
    expect(io.uploadLogo).not.toHaveBeenCalled()
    expect(io.createIssuer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ logoUploadId: null }))
  })

  it('adds a card without changing venue identity or logo', async () => {
    const io = designIo()
    const outcome = await submitCard(io, EMPTY_FORM)
    expect(outcome.ok).toBe(true)
    expect(io.commitLogo).not.toHaveBeenCalled()
    expect(io.uploadLogo).not.toHaveBeenCalled()
    expect(io.createCard).toHaveBeenCalledOnce()
    expect(io.createIssuer).not.toHaveBeenCalled()
  })
})

describe('changing a live venue mark', () => {
  it('stages the blobs and commits the id it got back', async () => {
    const io = designIo()
    // The commit hands back the updated issuer, whose versioned `logoUrl` is
    // how the screen shows the new mark instead of a cached old one.
    await expect(applyLogo(io, logo)).resolves.toStrictEqual({ issuer, ok: true })
    expect(io.uploadLogo).toHaveBeenCalledExactlyOnceWith(logo)
    expect(io.commitLogo).toHaveBeenCalledExactlyOnceWith('up_1')
  })

  it('reports a refused commit, and says when it was the session that ended', async () => {
    const refused = designIo({
      commitLogo: vi
        .fn<DesignIo['commitLogo']>()
        .mockResolvedValue({ error: 'upload_not_found', network: false, ok: false, status: 400 }),
    })
    const expired = designIo({
      commitLogo: vi
        .fn<DesignIo['commitLogo']>()
        .mockResolvedValue({ error: 'unauthorized', network: false, ok: false, status: 401 }),
    })
    await expect(applyLogo(refused, logo)).resolves.toStrictEqual({ ok: false, session: false })
    await expect(applyLogo(expired, logo)).resolves.toStrictEqual({ ok: false, session: true })
  })
})
