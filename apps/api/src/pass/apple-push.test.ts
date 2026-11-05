import { describe, expect, it } from 'vitest'

import { applePushSenderFrom } from './apple-push.ts'

interface Sent {
  body: string
  method: string
  topic: string | null
  url: string
}

const binding = (response: () => Response) => {
  const sent: Sent[] = []
  const fake: Pick<Fetcher, 'fetch'> & { sent: Sent[] } = {
    // oxlint-disable-next-line require-await -- Fetch-compatible test double
    fetch: async (input, init) => {
      const request = new Request(input, init)
      sent.push({
        body: await request.text(),
        method: request.method,
        topic: request.headers.get('apns-topic'),
        url: request.url,
      })
      return response()
    },
    sent,
  }
  return fake
}

const reason = (name: string, status: number): Response => Response.json({ reason: name }, { status })

describe(applePushSenderFrom, () => {
  it('is off without the binding', () => {
    expect(applePushSenderFrom()).toBeNull()
  })

  it('sends the empty dictionary Apple requires to production, on the pass type topic', async () => {
    const fake = binding(() => new Response(null, { status: 200 }))
    const send = applePushSenderFrom(fake)
    await expect(send?.('abc123', 'pass.sh.fuda.membership')).resolves.toStrictEqual({ outcome: 'sent' })
    expect(fake.sent).toStrictEqual([
      {
        body: '{}',
        method: 'POST',
        topic: 'pass.sh.fuda.membership',
        url: 'https://api.push.apple.com/3/device/abc123',
      },
    ])
  })

  it('reads 410 and BadDeviceToken as a token that will never work again', async () => {
    const gone = applePushSenderFrom(binding(() => reason('Unregistered', 410)))
    await expect(gone?.('abc', 'pass.x')).resolves.toStrictEqual({ outcome: 'token_invalid' })
    const bad = applePushSenderFrom(binding(() => reason('BadDeviceToken', 400)))
    await expect(bad?.('abc', 'pass.x')).resolves.toStrictEqual({ outcome: 'token_invalid' })
  })

  it('keeps the device on any other refusal and says why', async () => {
    const send = applePushSenderFrom(binding(() => reason('BadCertificate', 403)))
    await expect(send?.('abc', 'pass.x')).resolves.toStrictEqual({
      outcome: 'failed',
      reason: 'BadCertificate',
      status: 403,
    })
  })

  it('survives a refusal that is not JSON', async () => {
    const send = applePushSenderFrom(binding(() => new Response('<html>', { status: 502 })))
    await expect(send?.('abc', 'pass.x')).resolves.toStrictEqual({
      outcome: 'failed',
      reason: '',
      status: 502,
    })
  })
})
