// Seeds the e2e api through its public HTTP routes only, the same calls the
// live smoke script makes (apps/api/scripts/smoke-live.ts). Nothing here
// imports app code, so the suite keeps passing while the apps are rewritten.
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { API_ORIGIN } from '../../stack.config.ts'

const call = async <T>(path: string, init: RequestInit = {}, token?: string): Promise<T> => {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json')
  if (token !== undefined) {
    headers.set('authorization', `Bearer ${token}`)
  }
  const response = await fetch(`${API_ORIGIN}/v1${path}`, { ...init, headers })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${init.method ?? 'GET'} ${path} answered ${String(response.status)}: ${text}`)
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- seed calls trust the api's own response shape; a mismatch fails the test that reads it.
  return JSON.parse(text) as T
}

const post = async <T>(path: string, body: unknown, token?: string): Promise<T> =>
  await call<T>(path, { body: JSON.stringify(body), method: 'POST' }, token)

let counter = 0
// Handles and slugs share one rule: lowercase ASCII, digits and single hyphens.
export const uniqueName = (prefix: string): string => {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${String(counter)}`
}

export interface BearerRight {
  qr: string
  uid: string
}

// A Bearer Right issued with the deployment's admin authority, which is open
// while the e2e api runs without ADMIN_TOKEN.
export const issueBearerRight = async (): Promise<BearerRight> =>
  await post<BearerRight>('/issue', { memberId: uniqueName('member'), usageModel: 0 })

export interface Venue {
  cardSlug: string
  cardTitle: string
  handle: string
  name: string
}

// A venue owned by a throwaway EOA (its signature verifies offline under the
// fake chain) with one published, claimable Membership Card.
export const createVenue = async (name = 'E2E Coffee'): Promise<Venue> => {
  const operator = privateKeyToAccount(generatePrivateKey())
  const challenge = await post<{ message: string; nonce: string }>('/auth/challenge', {
    address: operator.address,
  })
  const session = await post<{ token: string }>('/auth/verify', {
    address: operator.address,
    nonce: challenge.nonce,
    signature: await operator.signMessage({ message: challenge.message }),
  })
  const handle = uniqueName('e2e')
  await post('/issuers', { brandColor: '#6F4320', handle, name, tagline: 'Omotesando · Coffee shop' }, session.token)
  const cardSlug = 'membership'
  const cardTitle = 'Membership Card'
  await post(
    '/issuers/cards',
    {
      category: 'membership',
      description: 'Stamp card · 10 stamps\nFree drink',
      lockScreen: false,
      slug: cardSlug,
      title: cardTitle,
      validityDays: null,
    },
    session.token,
  )
  return { cardSlug, cardTitle, handle, name }
}
