// Seeds the e2e api through its public HTTP routes only, the same calls the
// live smoke script makes (apps/api/scripts/smoke-live.ts). Nothing here
// imports app code, so the suite keeps passing while the apps are rewritten.
import * as v from 'valibot'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { API_ORIGIN } from '../../stack.config.ts'

// Each call states the fields it reads, so an api change that drops one fails
// here with the route named, not later as an undefined in a locator.
export const apiRequest = async <TSchema extends v.GenericSchema>(
  path: string,
  schema: TSchema,
  options: { body?: string; method?: string; token?: string } = {},
): Promise<v.InferOutput<TSchema>> => {
  const headers = new Headers()
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json')
  }
  if (options.token !== undefined) {
    headers.set('authorization', `Bearer ${options.token}`)
  }
  const response = await fetch(`${API_ORIGIN}/v1${path}`, {
    body: options.body,
    headers,
    method: options.method ?? 'GET',
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${path} answered ${String(response.status)}: ${text}`)
  }
  return v.parse(schema, JSON.parse(text))
}
const post = async <TSchema extends v.GenericSchema>(
  path: string,
  body: string,
  schema: TSchema,
  token?: string,
): Promise<v.InferOutput<TSchema>> => await apiRequest(path, schema, { body, method: 'POST', token })

let counter = 0
// Handles and slugs share one rule: lowercase ASCII, digits and single hyphens.
export const uniqueName = (prefix: string): string => {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${String(counter)}`
}

const BearerRightSchema = v.object({ qr: v.string(), uid: v.string() })
export type BearerRight = v.InferOutput<typeof BearerRightSchema>

// A Bearer Right issued with the deployment's admin authority, which is open
// while the e2e api runs without ADMIN_TOKEN.
export const issueBearerRight = async (): Promise<BearerRight> =>
  await post('/issue', JSON.stringify({ memberId: uniqueName('member'), usageModel: 0 }), BearerRightSchema)

export interface Venue {
  operatorToken: string
  cardSlug: string
  cardTitle: string
  handle: string
  name: string
}

const ChallengeSchema = v.object({ message: v.string(), nonce: v.string() })
const SessionSchema = v.object({ token: v.string() })

export const createOperator = async (): Promise<v.InferOutput<typeof SessionSchema>> => {
  const operator = privateKeyToAccount(generatePrivateKey())
  const challenge = await post(
    '/auth/challenge',
    JSON.stringify({ address: operator.address }),
    ChallengeSchema,
  )
  return await post(
    '/auth/verify',
    JSON.stringify({
      address: operator.address,
      nonce: challenge.nonce,
      signature: await operator.signMessage({ message: challenge.message }),
    }),
    SessionSchema,
  )
}

// A venue owned by a throwaway EOA (its signature verifies offline under the
// fake chain) with one published, claimable Membership Card.
export const createVenue = async (name = 'E2E Coffee'): Promise<Venue> => {
  const session = await createOperator()
  const handle = uniqueName('e2e')
  await post(
    '/issuers',
    JSON.stringify({ brandColor: '#6F4320', handle, name, tagline: 'Omotesando · Coffee shop' }),
    v.unknown(),
    session.token,
  )
  const cardSlug = 'membership'
  const cardTitle = 'Membership Card'
  await post(
    '/issuers/cards',
    JSON.stringify({
      category: 'membership',
      description: 'Stamp card · 10 stamps\nFree drink',
      lockScreen: false,
      slug: cardSlug,
      title: cardTitle,
      validityDays: null,
    }),
    v.unknown(),
    session.token,
  )
  return { cardSlug, cardTitle, handle, name, operatorToken: session.token }
}
