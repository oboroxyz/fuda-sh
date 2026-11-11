import { test } from '@e2e-dev/web'
import { expect } from 'e2e'
import * as v from 'valibot'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

import { SURFACES } from '../../stack.config.ts'
import { apiRequest, createVenue } from '../support/seed.ts'

// The e2e api target grants one agreement on this asset to the address of this key
// (apps/api/targets/e2e/void.config.ts). The registry is the one that target allows.
const REGISTRY = `0x${'ab'.repeat(20)}`
const ASSET_ID = `0x${'ee'.repeat(32)}`
const licensed = privateKeyToAccount(`0x${'11'.repeat(32)}`)

const Pass = v.object({ level: v.literal('signed'), uid: v.string() })
const Refusal = v.object({
  error: v.string(),
  requirement: v.object({ detail: v.string(), kind: v.string() }),
})
const Verdict = v.object({
  decision: v.string(),
  reason: v.string(),
  requirements: v.optional(v.array(v.object({ evidence: v.string(), kind: v.string() }))),
})

// Through the member app's Worker, as the app sends them: no session and no cookie.
const viaApp = async (path: string, body: Record<string, string>): Promise<Response> =>
  await fetch(`${SURFACES.app.origin}/api/v1${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })

test('a licensed address applies, receives one pass and is admitted, and another address is refused', async () => {
  const venue = await createVenue('Paper Moon Studio')
  const { card } = await apiRequest('/issuers/cards', v.object({ card: v.object({ id: v.string() }) }), {
    body: JSON.stringify({
      category: 'membership',
      description: '',
      identity: 'address',
      lockScreen: false,
      requirements: [{ assetId: ASSET_ID, kind: 'erc8432-agreement', registry: REGISTRY }],
      slug: 'moonlight-club',
      title: 'Moonlight Club',
      validityDays: null,
    }),
    method: 'POST',
    token: venue.operatorToken,
  })
  const path = `/issuers/${venue.handle}/moonlight-club`
  const claim = async (account: typeof licensed): Promise<Response> =>
    await viaApp(`${path}/issue`, {
      holderAddress: account.address,
      signature: await account.signMessage({
        message: `fuda.sh:claim:v1:${card.id}:${account.address.toLowerCase()}`,
      }),
    })

  const applied = await viaApp(`${path}/apply`, { holderAddress: licensed.address })
  expect(applied.status).toBe(200)

  const stranger = await claim(privateKeyToAccount(generatePrivateKey()))
  expect(stranger.status).toBe(403)
  const refusal = v.parse(Refusal, await stranger.json())
  expect(refusal.error).toBe('requirement_unmet')
  expect(refusal.requirement.detail).toBe('no-agreement')

  const first = await claim(licensed)
  const pass = v.parse(Pass, await first.json())
  const second = await claim(licensed)
  const again = v.parse(Pass, await second.json())
  expect(again.uid).toBe(pass.uid)

  const minted = await viaApp('/challenge', { uid: pass.uid })
  const { challenge, nonce } = v.parse(
    v.object({ challenge: v.string(), nonce: v.string() }),
    await minted.json(),
  )
  const presented = await viaApp('/verify-signed', {
    nonce,
    signature: await licensed.signMessage({ message: challenge }),
    uid: pass.uid,
  })
  const verdict = v.parse(Verdict, await presented.json())
  expect(verdict.decision).toBe('ADMIT')
  expect(verdict.requirements?.[0]?.evidence).toBe(`ipagreement:84532:${REGISTRY}/${ASSET_ID}`)
})
