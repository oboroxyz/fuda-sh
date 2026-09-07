import type { IssuerCreateResponse, IssuerView, IssueResponse, RevokeResponse } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { applyLogo, issueAndReload, revokeAndReload, submitDesign } from './app-actions.ts'
import type { ActionContext, DashIo, DesignIo } from './app-actions.ts'
import { EMPTY_FORM } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import type { LogoSet } from './logo.ts'

const UID = `0x${'ab'.repeat(32)}` as const
const HOLDER = `0x${'11'.repeat(20)}` as const
const body = { memberId: 'alice', tier: 1, usageModel: 1 }
const issueSuccess: Result<IssueResponse> = {
  body: {
    holder: HOLDER,
    level: 'bearer',
    passUrls: { apple: '/apple', google: '/google', web: '/pass' },
    qr: `fuda:v1:${UID}`,
    uid: UID,
  },
  ok: true,
}
const revokeSuccess: Result<RevokeResponse> = { body: { revoked: true, uid: UID }, ok: true }

const fixture = () => {
  const io = {
    issueRight: vi.fn<DashIo['issueRight']>().mockResolvedValue(issueSuccess),
    listMembers: vi.fn<DashIo['listMembers']>().mockResolvedValue({ body: { members: [] }, ok: true }),
    revokeRight: vi.fn<DashIo['revokeRight']>().mockResolvedValue(revokeSuccess),
  }
  const reload = vi.fn<ActionContext['reload']>().mockResolvedValue()
  const onUnauthorized = vi.fn<ActionContext['onUnauthorized']>()
  return { io, onUnauthorized, reload, token: 'secret' } satisfies ActionContext
}

describe('authenticated actions', () => {
  it('returns the original issue result and reloads once with the current token', async () => {
    const context = fixture()
    await expect(issueAndReload(context, body)).resolves.toBe(issueSuccess)
    expect(context.io.issueRight).toHaveBeenCalledExactlyOnceWith('secret', body)
    expect(context.reload).toHaveBeenCalledExactlyOnceWith('secret')
    expect(context.onUnauthorized).not.toHaveBeenCalled()
  })

  it('returns the original revoke result and reloads once with the current token', async () => {
    const context = fixture()
    await expect(revokeAndReload(context, UID)).resolves.toBe(revokeSuccess)
    expect(context.io.revokeRight).toHaveBeenCalledExactlyOnceWith('secret', UID)
    expect(context.reload).toHaveBeenCalledExactlyOnceWith('secret')
    expect(context.onUnauthorized).not.toHaveBeenCalled()
  })

  it('does not reload or clear the session after non-401 write failures', async () => {
    const context = fixture()
    const failure = { error: 'bad_uid', network: false, ok: false, status: 400 } as const
    context.io.issueRight.mockResolvedValueOnce(failure)
    context.io.revokeRight.mockResolvedValueOnce(failure)

    await expect(issueAndReload(context, body)).resolves.toBe(failure)
    await expect(revokeAndReload(context, UID)).resolves.toBe(failure)
    expect(context.reload).not.toHaveBeenCalled()
    expect(context.onUnauthorized).not.toHaveBeenCalled()
  })

  it('clears the session exactly once without reloading after issue returns 401', async () => {
    const context = fixture()
    const failure = { error: 'unauthorized', network: false, ok: false, status: 401 } as const
    context.io.issueRight.mockResolvedValueOnce(failure)

    await expect(issueAndReload(context, body)).resolves.toBe(failure)
    expect(context.onUnauthorized).toHaveBeenCalledExactlyOnceWith()
    expect(context.reload).not.toHaveBeenCalled()
  })

  it('clears the session exactly once without reloading after revoke returns 401', async () => {
    const context = fixture()
    const failure = { error: 'unauthorized', network: false, ok: false, status: 401 } as const
    context.io.revokeRight.mockResolvedValueOnce(failure)

    await expect(revokeAndReload(context, UID)).resolves.toBe(failure)
    expect(context.onUnauthorized).toHaveBeenCalledExactlyOnceWith()
    expect(context.reload).not.toHaveBeenCalled()
  })
})

const pngOf = (bytes: number): Blob => new Blob([new Uint8Array(bytes)], { type: 'image/png' })

const logo: LogoSet = { logo1x: pngOf(1), logo2x: pngOf(2), logo3x: pngOf(3), master: pngOf(4) }

const venueForm: DesignerForm = { ...EMPTY_FORM, handle: 'wassie-coffee', name: 'Wassie Coffee' }

const issuer: IssuerView = {
  brandColor: '#6F4320',
  createdAt: 1_757_000_000,
  handle: 'wassie-coffee',
  id: 'issuer_1',
  name: 'Wassie Coffee',
  operatorAddress: HOLDER,
  tagline: '',
}

const created: Result<IssuerCreateResponse> = {
  body: {
    card: {
      category: 'membership',
      claimFrom: null,
      claimUntil: null,
      claimable: true,
      id: 'card_1',
      perk: '',
      reward: '',
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
  createCard: vi.fn<DesignIo['createCard']>().mockResolvedValue(created),
  createIssuer: vi.fn<DesignIo['createIssuer']>().mockResolvedValue(created),
  uploadLogo: vi
    .fn<DesignIo['uploadLogo']>()
    .mockResolvedValue({ body: { expiresAt: 1_757_000_900, logoUploadId: 'up_1' }, ok: true }),
  ...overrides,
})

describe('the designer submit', () => {
  it('carries the id the upload returned into the venue create body', async () => {
    const io = designIo()
    const outcome = await submitDesign(io, 'secret', 'venue', venueForm, logo)
    expect(outcome.ok).toBe(true)
    expect(io.uploadLogo).toHaveBeenCalledExactlyOnceWith('secret', logo)
    expect(io.createIssuer).toHaveBeenCalledExactlyOnceWith(
      'secret',
      expect.objectContaining({ logoUploadId: 'up_1' }),
    )
  })

  it('leaves the create body without a logo id when the operator picked none', async () => {
    const io = designIo()
    await submitDesign(io, 'secret', 'venue', venueForm, null)
    expect(io.uploadLogo).not.toHaveBeenCalled()
    expect(io.createIssuer).toHaveBeenCalledExactlyOnceWith(
      'secret',
      expect.objectContaining({ logoUploadId: null }),
    )
  })

  it('keeps the operator form when the upload fails, writing nothing', async () => {
    const io = designIo({
      uploadLogo: vi
        .fn<DesignIo['uploadLogo']>()
        .mockResolvedValue({ error: 'bad_upload', network: false, ok: false, status: 400 }),
    })
    const outcome = await submitDesign(io, 'secret', 'venue', venueForm, logo)
    expect(outcome).toStrictEqual({ failure: 'logo', ok: false })
    expect(io.createIssuer).not.toHaveBeenCalled()
  })

  it('ends the session rather than blaming the logo when the upload is unauthorized', async () => {
    const io = designIo({
      uploadLogo: vi
        .fn<DesignIo['uploadLogo']>()
        .mockResolvedValue({ error: 'unauthorized', network: false, ok: false, status: 401 }),
    })
    const outcome = await submitDesign(io, 'secret', 'venue', venueForm, logo)
    expect(outcome).toStrictEqual({ failure: 'session', ok: false })
    expect(io.createIssuer).not.toHaveBeenCalled()
  })

  it('commits the upload for a venue that already exists, then adds the card', async () => {
    const io = designIo()
    const outcome = await submitDesign(io, 'secret', 'card', venueForm, logo)
    expect(outcome.ok).toBe(true)
    expect(io.commitLogo).toHaveBeenCalledExactlyOnceWith('secret', 'up_1')
    expect(io.createCard).toHaveBeenCalledOnce()
    expect(io.createIssuer).not.toHaveBeenCalled()
  })
})

describe('changing a live venue mark', () => {
  it('stages the blobs and commits the id it got back', async () => {
    const io = designIo()
    await expect(applyLogo(io, 'secret', logo)).resolves.toStrictEqual({ ok: true })
    expect(io.uploadLogo).toHaveBeenCalledExactlyOnceWith('secret', logo)
    expect(io.commitLogo).toHaveBeenCalledExactlyOnceWith('secret', 'up_1')
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
    await expect(applyLogo(refused, 'secret', logo)).resolves.toStrictEqual({ ok: false, session: false })
    await expect(applyLogo(expired, 'secret', logo)).resolves.toStrictEqual({ ok: false, session: true })
  })
})
