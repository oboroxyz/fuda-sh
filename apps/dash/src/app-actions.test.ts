import type { IssueResponse, RevokeResponse } from '@fuda/sdk'
import { describe, expect, it, vi } from 'vitest'

import type { Result } from './api.ts'
import { issueAndReload, revokeAndReload } from './app-actions.ts'
import type { ActionContext, DashIo } from './app-actions.ts'

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
