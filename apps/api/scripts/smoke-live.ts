// Live end-to-end smoke test against a running api (a deployed worker or
// `wrangler dev`). Runs under tsx (node), not workerd. Two ladders:
//
//   bearer  — issue → verify → re-scan → revoke → verify
//   signed  — issue to a holder key → challenge/response admission, including
//             the wrong-signature, replayed-nonce and single-use rejections
//
// Pick ladders with `--ladder bearer,signed` (or `all`), or with SMOKE_LADDERS;
// the default is both. Every returned issue UID is revoked in finally, even
// after an unexpected verdict. Private discovery is exercised by the Graph
// demo and member app; this script rejects that ladder before any issuance.
import type {
  ChallengeResponse,
  Hex,
  IssueResponse,
  RevokeResponse,
  VerifyResponse,
  VerifySignedResponse,
} from '@fuda/sdk'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const api = process.env.API_URL ?? 'http://localhost:8787'
const token = process.env.ADMIN_TOKEN
const headers = new Headers({ 'content-type': 'application/json' })
if (token !== undefined) {
  headers.set('authorization', `Bearer ${token}`)
}

const readResponseJson = async <T>(response: Response): Promise<T> =>
  // oxlint-disable-next-line promise/avoid-new -- bridge parsed smoke-response text into the caller-owned response contract
  await new Promise((resolve, reject) => {
    void response.text().then(JSON.parse).then(resolve, reject)
  })

const call = async <T>(
  path: string,
  init?: RequestInit,
  describe: (body: T) => string = (body) => JSON.stringify(body),
): Promise<T> => {
  const res = await fetch(`${api}${path}`, init)
  const body = await readResponseJson<T>(res)
  // oxlint-disable-next-line no-console -- smoke script progress output, not app logging
  console.log(`${init?.method ?? 'GET'} ${path} → ${res.status}`, describe(body))
  return body
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters anti-slop/no-unsafe-dictionary-type -- smoke assertions inspect arbitrary external JSON fields
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const expectMatch = (
  label: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- comparing an arbitrary api response shape against a caller-named subset of fields
  actual: unknown,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the caller supplies only the fields it wants to assert on
  expected: Record<string, unknown>,
): void => {
  for (const [k, v] of Object.entries(expected)) {
    const actualValue = isRecord(actual) ? actual[k] : undefined
    if (actualValue !== v) {
      throw new Error(`${label}: expected ${k}=${String(v)}, got ${JSON.stringify(actual)}`)
    }
  }
}

// The subset of POST /issue's body this script sends; which identity key is
// present is what picks the level (docs/specs/attestation-model.md#api-payloads-that-touch-attestations).
interface IssueInput {
  holder?: Hex
  memberId?: string
  tier?: number
  usageModel?: number
}

const issue = async (body: IssueInput): Promise<IssueResponse> =>
  await call<IssueResponse>('/issue', { body: JSON.stringify(body), headers, method: 'POST' })

const revoke = async (uid: Hex): Promise<void> => {
  expectMatch(
    'revoke',
    await call<RevokeResponse>('/revoke', { body: JSON.stringify({ uid }), headers, method: 'POST' }),
    { revoked: true },
  )
}

const bearerLadder = async (): Promise<void> => {
  const issued = await issue({ memberId: `smoke-${Date.now()}`, usageModel: 0 })
  try {
    if (!('qr' in issued)) {
      throw new Error(`issue: expected a bearer response with qr, got ${JSON.stringify(issued)}`)
    }

    expectMatch('verify preview', await call<VerifyResponse>(`/verify/${issued.uid}`), { decision: 'ADMIT' })
    expectMatch(
      'first scan',
      await call<VerifyResponse>('/verify', {
        body: JSON.stringify({ qr: issued.qr }),
        headers,
        method: 'POST',
      }),
      { decision: 'ADMIT' },
    )
    expectMatch(
      'second scan',
      await call<VerifyResponse>('/verify', {
        body: JSON.stringify({ qr: issued.qr }),
        headers,
        method: 'POST',
      }),
      { decision: 'REJECT', reason: 'ALREADY_USED' },
    )
  } finally {
    await revoke(issued.uid)
  }
  expectMatch('after revoke', await call<VerifyResponse>(`/verify/${issued.uid}`), {
    decision: 'REJECT',
    reason: 'REVOKED',
  })
}

const mintChallenge = async (uid: Hex): Promise<ChallengeResponse> =>
  await call<ChallengeResponse>('/challenge', { body: JSON.stringify({ uid }), headers, method: 'POST' })

const verifySigned = async (body: { uid: Hex; nonce: Hex; signature: Hex }): Promise<VerifySignedResponse> =>
  await call<VerifySignedResponse>('/verify-signed', {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  })

const signedLadder = async (): Promise<void> => {
  const holder = privateKeyToAccount(generatePrivateKey())
  const impostor = privateKeyToAccount(generatePrivateKey())

  const issued = await issue({ holder: holder.address, tier: 1, usageModel: 0 })
  try {
    expectMatch('signed issue', issued, { level: 'signed' })
    const { uid } = issued

    if (!('qr' in issued)) {
      throw new Error(`signed issue: expected a qr on the response, got ${JSON.stringify(issued)}`)
    }

    expectMatch('signed preview', await call<VerifyResponse>(`/verify/${uid}`), { decision: 'ADMIT' })
    expectMatch(
      'signed qr scan',
      await call<VerifyResponse>('/verify', {
        body: JSON.stringify({ qr: issued.qr }),
        headers,
        method: 'POST',
      }),
      { decision: 'REJECT', reason: 'LEVEL_REQUIRED' },
    )

    // Wrong key: the nonce is burned by the attempt, so the same nonce with the
    // right key then answers BAD_CHALLENGE rather than admitting.
    const first = await mintChallenge(uid)
    expectMatch(
      'wrong signer',
      await verifySigned({
        nonce: first.nonce,
        signature: await impostor.signMessage({ message: first.challenge }),
        uid,
      }),
      { decision: 'REJECT', reason: 'BAD_SIGNATURE' },
    )
    expectMatch(
      'burned nonce',
      await verifySigned({
        nonce: first.nonce,
        signature: await holder.signMessage({ message: first.challenge }),
        uid,
      }),
      { decision: 'REJECT', reason: 'BAD_CHALLENGE' },
    )

    const second = await mintChallenge(uid)
    const secondSignature = await holder.signMessage({ message: second.challenge })
    expectMatch(
      'signed admit',
      await verifySigned({ nonce: second.nonce, signature: secondSignature, uid }),
      {
        decision: 'ADMIT',
        path: 'signature',
      },
    )
    expectMatch(
      'signed replay',
      await verifySigned({ nonce: second.nonce, signature: secondSignature, uid }),
      {
        decision: 'REJECT',
        reason: 'BAD_CHALLENGE',
      },
    )

    // Fresh challenge, right key, but the SINGLE_USE slot is spent.
    const third = await mintChallenge(uid)
    expectMatch(
      'single use',
      await verifySigned({
        nonce: third.nonce,
        signature: await holder.signMessage({ message: third.challenge }),
        uid,
      }),
      { decision: 'REJECT', reason: 'ALREADY_USED' },
    )
  } finally {
    await revoke(issued.uid)
  }
  expectMatch('signed after revoke', await call<VerifyResponse>(`/verify/${issued.uid}`), {
    decision: 'REJECT',
    reason: 'REVOKED',
  })
}

const LADDERS = ['bearer', 'signed'] as const
type Ladder = (typeof LADDERS)[number]
const RUN = {
  bearer: bearerLadder,
  signed: signedLadder,
} satisfies Record<Ladder, () => Promise<void>>

const selected = (): Ladder[] => {
  const flag = process.argv.indexOf('--ladder')
  const raw = (flag === -1 ? process.env.SMOKE_LADDERS : process.argv[flag + 1]) ?? 'all'
  if (raw === '' || raw === 'all') {
    return [...LADDERS]
  }
  const names = raw.split(',').map((s) => s.trim())
  const unknown = names.filter((n) => !LADDERS.some((l) => l === n))
  if (unknown.length > 0) {
    throw new Error(`unknown ladder(s): ${unknown.join(', ')} — pick from ${LADDERS.join(', ')} or all`)
  }
  return LADDERS.filter((l) => names.includes(l))
}

for (const ladder of selected()) {
  // oxlint-disable-next-line no-console -- smoke script progress output, not app logging
  console.log(`\n── ${ladder} ladder`)
  // oxlint-disable-next-line no-await-in-loop -- the ladders run one after another against one api
  await RUN[ladder]()
}

// oxlint-disable-next-line no-console -- smoke script success marker, not app logging
console.log('\nsmoke OK')
