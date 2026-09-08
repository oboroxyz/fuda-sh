import { describe, expect, it } from 'vitest'

import { appWith, fakeChain, testEnv } from './env.ts'

// A route's own 4xx proves it was reached; 404 with the api's not-found body
// proves it was not. Neither depends on the route succeeding, so this stays true
// as the routes behind them change.
const reached = async (path: string, method = 'GET'): Promise<boolean> => {
  const app = appWith({ chain: fakeChain() })
  const res = await app.request(path, { method }, testEnv())
  if (res.status !== 404) {
    return true
  }
  // `/issuers/:handle` answers its own 404 for an unknown venue; the router's
  // miss has no body at all.
  const body = await res.json<{ error?: string }>().catch(() => ({ error: undefined }))
  return body.error === 'not_found'
}

describe('the version prefix', () => {
  it('serves the routes a program calls under /v1', async () => {
    const paths = ['/v1/verify/0x00', '/v1/members', '/v1/issuers/nobody']

    await expect(Promise.all(paths.map(async (path) => await reached(path)))).resolves.toStrictEqual([
      true,
      true,
      true,
    ])
  })

  it('no longer answers those routes unversioned', async () => {
    const paths = ['/verify/0x00', '/members', '/issuers/nobody']

    await expect(Promise.all(paths.map(async (path) => await reached(path)))).resolves.toStrictEqual([
      false,
      false,
      false,
    ])
  })

  // These URLs are held by someone fuda cannot reach to update — a pass in a
  // wallet, a mark on a printed page, the gateway address written into the
  // deployed ENS resolver, a health check in somebody's monitoring — so a
  // version prefix on them could never be retired.
  it('keeps the URLs it cannot reissue outside the prefix', async () => {
    const paths = ['/health', `/pass/0x${'ab'.repeat(32)}`, '/assets/nobody/logo/logo1x']

    await expect(Promise.all(paths.map(async (path) => await reached(path)))).resolves.toStrictEqual([
      true,
      true,
      true,
    ])
  })

  it('does not serve those same URLs under the prefix', async () => {
    const paths = ['/v1/health', `/v1/pass/0x${'ab'.repeat(32)}`, '/v1/assets/nobody/logo/logo1x']

    await expect(Promise.all(paths.map(async (path) => await reached(path)))).resolves.toStrictEqual([
      false,
      false,
      false,
    ])
  })
})
