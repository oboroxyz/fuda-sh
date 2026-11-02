import { describe, expect, it } from 'vitest'

import { corsPolicy } from '../src/middleware/cors.ts'
import { appWith, fakeChain, testEnv } from './env.ts'

const app = appWith({ chain: fakeChain() })

const allowedOrigin = async (path: string, origin: string): Promise<string | null> => {
  const res = await app.request(
    path,
    {
      headers: {
        'Access-Control-Request-Headers': 'content-type',
        'Access-Control-Request-Method': 'POST',
        Origin: origin,
      },
      method: 'OPTIONS',
    },
    testEnv(),
  )
  return res.headers.get('access-control-allow-origin')
}

describe(corsPolicy, () => {
  it.each([
    'https://app.fuda.sh',
    'https://dash.fuda.sh',
    'https://gate.fuda.sh',
    'http://localhost:5173',
    'https://evil.example',
  ])('answers no CORS to %s on an ordinary route: frontends call through their Workers', async (origin) => {
    await expect(allowedOrigin('/v1/members', origin)).resolves.toBeNull()
  })

  it("lets a wallet's own page reach the paymaster", async () => {
    await expect(allowedOrigin('/v1/ens/paymaster', 'https://keys.coinbase.com')).resolves.toBe('*')
  })

  it('lets a Figma Make page reach the connected-app routes and nothing else', async () => {
    const origin = 'https://shop.figma.site'
    await expect(allowedOrigin('/v1/oauth/token', origin)).resolves.toBe(origin)
    await expect(allowedOrigin('/v1/connect/cards', origin)).resolves.toBe(origin)
    await expect(allowedOrigin('/v1/members', origin)).resolves.toBeNull()
  })
})
