import type { Browser } from '@e2e-dev/web'
import * as v from 'valibot'

import { SURFACES } from '../../stack.config.ts'
import { apiRequest, createOperator, uniqueName } from './seed.ts'

const IssuerSchema = v.object({ handle: v.string(), id: v.string(), name: v.string() })
const CreatedIssuerSchema = v.object({ issuer: IssuerSchema, token: v.optional(v.string()) })
const CardSchema = v.object({ card: v.object({ id: v.string(), slug: v.string(), title: v.string() }) })

const createProfile = async (token: string, name: string) => {
  const profile = await apiRequest('/issuers', CreatedIssuerSchema, {
    body: JSON.stringify({ brandColor: '#112233', handle: uniqueName('store'), name, tagline: '' }),
    method: 'POST',
    token,
  })
  const sessionToken = profile.token ?? token
  const { card } = await apiRequest('/issuers/cards', CardSchema, {
    body: JSON.stringify({
      category: 'membership',
      description: '',
      lockScreen: false,
      slug: 'membership',
      title: `${name} card`,
    }),
    method: 'POST',
    token: sessionToken,
  })
  return { card, issuer: profile.issuer, token: sessionToken }
}

export const operatorWithTwoProfiles = async () => {
  const { token } = await createOperator()
  const first = await createProfile(token, 'E2E Coffee')
  const second = await createProfile(token, 'E2E Tea')
  return { first, second }
}

export const signInOperator = async (browser: Browser, token: string): Promise<void> => {
  await browser.setCookies([
    { httpOnly: true, name: 'fuda_operator', sameSite: 'Lax', url: SURFACES.dash.origin, value: token },
  ])
}

export const readProfile = async (token: string) =>
  await apiRequest('/issuers/me', v.object({ issuer: IssuerSchema }), { token })

export const claimCard = async (profile: Awaited<ReturnType<typeof createProfile>>): Promise<void> => {
  await apiRequest(`/issuers/me/cards/${profile.card.id}/stamps`, v.unknown(), {
    body: JSON.stringify({ dailyLimit: 2, enabled: true, goal: 10 }),
    method: 'PUT',
    token: profile.token,
  })
  const issued = await apiRequest(
    `/issuers/${profile.issuer.handle}/${profile.card.slug}/issue`,
    v.object({ qr: v.string() }),
    {
      body: '{}',
      method: 'POST',
    },
  )
  await apiRequest('/issuers/me/reception', v.object({ stamp: v.object({ status: v.literal('awarded') }) }), {
    body: JSON.stringify({ qr: issued.qr, requestId: crypto.randomUUID() }),
    method: 'POST',
    token: profile.token,
  })
}
