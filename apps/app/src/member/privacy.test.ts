import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'

import { forwardMemberApi } from '../server/member-api.ts'

describe('Sensitive proxy privacy', () => {
  it('forwards claims at two venues and presentation without any account credential', async () => {
    const captured: { url: string; authorization: string | null; body: string; cookie: string | null }[] = []
    vi.stubGlobal('fetch', async (input: string, init: RequestInit) => {
      captured.push({
        authorization: new Headers(init.headers).get('authorization'),
        body: await new Response(init.body).text(),
        cookie: new Headers(init.headers).get('cookie'),
        url: input,
      })
      return Response.json({ ok: true })
    })
    const worker = new Hono<{ Bindings: { API_BASE_URL?: string } }>()
    worker.all('/api/*', async (c) => await forwardMemberApi(c, 'https://api.test'))
    for (const [path, body] of [
      [
        '/issuers/venue-one/staff/issue',
        { holderAddress: `0x${'11'.repeat(20)}`, turnstileToken: 'sensitive-token' },
      ],
      ['/issuers/venue-two/staff/issue', { holderAddress: `0x${'22'.repeat(20)}` }],
      ['/challenge', { uid: `0x${'aa'.repeat(32)}` }],
      ['/verify-signed', { nonce: `0x${'cc'.repeat(32)}`, signature: '0x01', uid: `0x${'bb'.repeat(32)}` }],
    ] as const) {
      // oxlint-disable-next-line no-await-in-loop -- capture each request in route order
      const response = await worker.request(
        `/api/v1${path}`,
        {
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json', cookie: 'fuda_member=fictional-session' },
          method: 'POST',
        },
        { API_BASE_URL: 'https://api.test' },
      )
      expect(response.status).toBe(200)
    }
    expect(captured).toHaveLength(4)
    expect(captured.map((request) => request.cookie)).toStrictEqual([null, null, null, null])
    expect(captured.map((request) => request.authorization)).toStrictEqual([null, null, null, null])
    expect(JSON.parse(captured[0]?.body ?? '{}')).toMatchObject({
      holderAddress: `0x${'11'.repeat(20)}`,
      turnstileToken: 'sensitive-token',
    })
    expect(captured[2]?.body).toContain('uid')
    vi.unstubAllGlobals()
  })

  it('keeps the member session on recovery and Identified claim requests', async () => {
    const captured: (string | null)[] = []
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) => {
      captured.push(new Headers(init.headers).get('authorization'))
      return Response.json({ ok: true })
    })
    const worker = new Hono()
    worker.all('/api/*', async (c) => await forwardMemberApi(c, 'https://api.test'))
    await worker.request('/api/v1/member/secret', { headers: { cookie: 'fuda_member=account-session' } })
    await worker.request('/api/v1/issuers/venue/identified/issue', {
      body: JSON.stringify({ webauthn: {} }),
      headers: { 'content-type': 'application/json', cookie: 'fuda_member=account-session' },
      method: 'POST',
    })
    expect(captured).toStrictEqual(['Bearer account-session', 'Bearer account-session'])
  })
})
