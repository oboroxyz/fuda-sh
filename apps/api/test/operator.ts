import type { CardInput, IssuerCreateInput } from '@fuda/sdk'
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import type { Bindings } from '../src/env.ts'
import type { appWith } from './env.ts'

type App = ReturnType<typeof appWith>

export const OPERATOR_KEY = `0x${'6a'.repeat(32)}` as const
export const operator = privateKeyToAccount(OPERATOR_KEY)

const headersFor = (token: string | undefined, json: boolean): HeadersInit => {
  const headers: Record<string, string> = {}
  if (json) {
    headers['content-type'] = 'application/json'
  }
  if (token !== undefined) {
    headers.authorization = `Bearer ${token}`
  }
  return headers
}

export const postJson = async (
  app: App,
  bindings: Bindings,
  path: string,
  body: unknown,
  token?: string,
): Promise<Response> =>
  await app.request(
    path,
    { body: JSON.stringify(body), headers: headersFor(token, true), method: 'POST' },
    bindings,
  )

export const getJson = async (
  app: App,
  bindings: Bindings,
  path: string,
  token?: string,
): Promise<Response> => await app.request(path, { headers: headersFor(token, false) }, bindings)

// The whole passkey sign-in as a test would drive it: challenge → sign → verify.
export const signIn = async (
  app: App,
  bindings: Bindings,
  account: { address: Hex; signMessage: (p: { message: string }) => Promise<Hex> } = operator,
): Promise<{ token: string; issuer: unknown }> => {
  const challenge = await postJson(app, bindings, '/v1/auth/challenge', { address: account.address })
  const { message, nonce } = await challenge.json<{ message: string; nonce: Hex }>()
  const signature = await account.signMessage({ message })
  const verified = await postJson(app, bindings, '/v1/auth/verify', {
    address: account.address,
    nonce,
    signature,
  })
  return await verified.json<{ token: string; issuer: unknown }>()
}

export const SECOND_CARD: CardInput = {
  category: 'ticket',
  claimFrom: null,
  claimUntil: null,
  lockScreen: false,
  perk: 'One entry',
  reward: '',
  slug: 'gig',
  title: 'Gig Ticket',
  validityDays: 30,
}

export const CARD_INPUT: IssuerCreateInput = {
  brandColor: '#6f4320',
  card: {
    category: 'membership',
    lockScreen: false,
    perk: 'Stamp card · 10 stamps',
    reward: 'Free drink of your choice',
    slug: 'stamp',
    title: 'Membership Card',
    validityDays: null,
  },
  handle: 'wassie-coffee',
  name: 'Wassie Coffee',
  tagline: 'Omotesando · Coffee shop',
}
