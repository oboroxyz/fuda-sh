import { setTimeout as sleep } from 'node:timers/promises'

// Live end-to-end smoke test against a running api (a deployed worker or
// `wrangler dev`). Runs under tsx (node), not workerd. Three ladders:
//
//   bearer  — issue → verify → re-scan → revoke → verify
//   signed  — issue to a holder key → challenge/response admission, including
//             the wrong-signature, replayed-nonce and single-use rejections
//   private — issue to a stealth meta-address → discover the announcement →
//             admit with the recovered stealth key
//
// Pick ladders with `--ladder bearer,signed,private` (or `all`), or with
// SMOKE_LADDERS in the environment; the default is all three. Throws on the
// first unexpected verdict, so the process exits non-zero.
import type {
  ChallengeResponse,
  Hex,
  IssueResponse,
  RevokeResponse,
  VerifyResponse,
  VerifySignedResponse,
} from '@fuda/sdk'
import { toQr } from '@fuda/sdk'
import { deriveMemberSecret, deriveStealthKeys, matchAnnouncements } from '@fuda/stealth'
import { privateKeyToAccount } from 'viem/accounts'

const api = process.env.API_URL ?? 'http://localhost:8787'
const token = process.env.ADMIN_TOKEN
const headers = new Headers({ 'content-type': 'application/json' })
if (token !== undefined) {
  headers.set('authorization', `Bearer ${token}`)
}

// GET /announcements is the one budgeted route: it needs a client IP. A real
// deployment gets one from the Cloudflare edge, which overwrites whatever a
// client sends; this header only matters when the api runs behind `wrangler dev`.
const announcementHeaders = new Headers(headers)
announcementHeaders.set('cf-connecting-ip', '127.0.0.1')

const call = async <T>(
  path: string,
  init?: RequestInit,
  describe: (body: T) => string = (body) => JSON.stringify(body),
): Promise<T> => {
  const res = await fetch(`${api}${path}`, init)
  // SAFETY: this is a throwaway smoke script, not app code — the caller names
  // the response type it expects and trusts the api's documented contract;
  // there is no runtime schema to validate an ad hoc HTTP JSON body against.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY comment above
  const body = (await res.json()) as T
  // oxlint-disable-next-line no-console -- smoke script progress output, not app logging
  console.log(`${init?.method ?? 'GET'} ${path} → ${res.status}`, describe(body))
  return body
}

// For the endpoints whose status is the assertion and whose 200 body is not
// JSON (the pass page is HTML): read the body as text so a wrong status fails
// the check below instead of crashing a JSON parse.
const callStatus = async (path: string, init?: RequestInit): Promise<{ status: number; body: string }> => {
  const res = await fetch(`${api}${path}`, init)
  const body = await res.text()
  // oxlint-disable-next-line no-console -- smoke script progress output, not app logging
  console.log(`${init?.method ?? 'GET'} ${path} → ${res.status}`)
  return { body, status: res.status }
}

const expectMatch = (
  label: string,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- comparing an arbitrary api response shape against a caller-named subset of fields
  actual: unknown,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the caller supplies only the fields it wants to assert on
  expected: Record<string, unknown>,
): void => {
  for (const [k, v] of Object.entries(expected)) {
    // SAFETY: `expected`'s keys name fields the api's response contract documents; a mismatch throws below.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-unsafe-dictionary-type -- see SAFETY comment above
    if ((actual as Record<string, unknown>)[k] !== v) {
      throw new Error(`${label}: expected ${k}=${String(v)}, got ${JSON.stringify(actual)}`)
    }
  }
}

// The subset of POST /issue's body this script sends; which identity key is
// present is what picks the level (docs/specs/attestation-model.md#api-payloads-that-touch-attestations).
interface IssueInput {
  holder?: Hex
  memberId?: string
  stealthMetaAddress?: Hex
  tier?: number
  usageModel?: number
}

const issue = async (body: IssueInput): Promise<IssueResponse> =>
  await call<IssueResponse>('/issue', { body: JSON.stringify(body), headers, method: 'POST' })

const bearerLadder = async (): Promise<void> => {
  const issued = await issue({ memberId: `smoke-${Date.now()}`, usageModel: 0 })
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
  expectMatch(
    'revoke',
    await call<RevokeResponse>('/revoke', {
      body: JSON.stringify({ uid: issued.uid }),
      headers,
      method: 'POST',
    }),
    { revoked: true },
  )
  expectMatch('after revoke', await call<VerifyResponse>(`/verify/${issued.uid}`), {
    decision: 'REJECT',
    reason: 'REVOKED',
  })
}

// Two fixed throwaway Base Sepolia EOAs: they hold no funds and sign nothing but
// these challenges. The second one exists only to produce a wrong signature.
const HOLDER_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const OTHER_KEY: Hex = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

const mintChallenge = async (uid: Hex): Promise<ChallengeResponse> =>
  await call<ChallengeResponse>('/challenge', { body: JSON.stringify({ uid }), headers, method: 'POST' })

const verifySigned = async (body: { uid: Hex; nonce: Hex; signature: Hex }): Promise<VerifySignedResponse> =>
  await call<VerifySignedResponse>('/verify-signed', {
    body: JSON.stringify(body),
    headers,
    method: 'POST',
  })

const signedLadder = async (): Promise<void> => {
  const holder = privateKeyToAccount(HOLDER_KEY)
  const impostor = privateKeyToAccount(OTHER_KEY)

  const issued = await issue({ holder: holder.address, tier: 1, usageModel: 0 })
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
  expectMatch('signed admit', await verifySigned({ nonce: second.nonce, signature: secondSignature, uid }), {
    decision: 'ADMIT',
    path: 'signature',
  })
  expectMatch('signed replay', await verifySigned({ nonce: second.nonce, signature: secondSignature, uid }), {
    decision: 'REJECT',
    reason: 'BAD_CHALLENGE',
  })

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
}

interface SmokeAnnouncement {
  blockNumber: number
  logIndex: number
  txHash: string
  stealthAddress: Hex
  ephemeralPubKey: Hex
  metadata: Hex
}
interface AnnouncementsPage {
  announcements: SmokeAnnouncement[]
  syncedTo: number | null
}

// The api's ANNOUNCEMENTS_LIMIT: a full page means "there may be more".
const PAGE_ROWS = 1000
// A stop for the pathological case of one block holding more than a page.
const MAX_PAGES = 50

// The client paging rule (the same walk `apps/app` runs): the api pages by block
// number, not by an opaque cursor, so the next page restarts at the last row's
// block and (txHash, logIndex) dedupes the boundary block's repeats.
const walkAnnouncements = async (): Promise<SmokeAnnouncement[]> => {
  const rows: SmokeAnnouncement[] = []
  const seen = new Set<string>()
  let from = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // oxlint-disable-next-line no-await-in-loop -- pages are sequential: each start block comes from the page before it
    const body = await call<AnnouncementsPage>(
      `/announcements?fromBlock=${from}`,
      { headers: announcementHeaders },
      (b) => `${b.announcements.length} rows, syncedTo ${String(b.syncedTo)}`,
    )
    const batch = body.announcements
    for (const row of batch) {
      const key = `${row.txHash}:${row.logIndex}`
      if (!seen.has(key)) {
        seen.add(key)
        rows.push(row)
      }
    }
    const last = batch.at(-1)
    if (batch.length < PAGE_ROWS || last === undefined) {
      return rows
    }
    from = last.blockNumber
  }
  return rows
}

// On a real chain the announcement is only served once the sync passes it, which
// waits out the 5-block confirmation depth (and warms a cold deployment's cursor
// over a few requests). Two minutes of polling covers both. Budget: one poll is
// one page on an MVP-sized log, so a full wait spends ~24 of the 120/h
// per-IP `/announcements` budget.
const POLL_INTERVAL_MS = 5000
const POLL_ATTEMPTS = 24

const privateLadder = async (): Promise<void> => {
  // A fixed "PRF output": the ladder re-derives the same member every run, so a
  // repeat run rediscovers its earlier announcements too — it matches on uid.
  const prf = new Uint8Array(32).fill(7)
  const keys = deriveStealthKeys(deriveMemberSecret(prf))

  const issued = await issue({
    memberId: 'smoke-private',
    stealthMetaAddress: keys.metaAddress,
    usageModel: 1,
  })
  expectMatch('private issue', issued, { announced: true, level: 'private' })
  if ('passUrls' in issued) {
    throw new Error(`private issue: expected no passUrls, got ${JSON.stringify(issued)}`)
  }
  const { uid } = issued

  const pass = await callStatus(`/pass/${uid}`)
  if (pass.status !== 404) {
    throw new Error(`private pass page: expected 404, got ${pass.status}`)
  }

  let found = null
  for (let attempt = 0; attempt < POLL_ATTEMPTS && found === null; attempt += 1) {
    if (attempt > 0) {
      // oxlint-disable-next-line no-await-in-loop -- the wait between polls is the point
      await sleep(POLL_INTERVAL_MS)
    }
    // oxlint-disable-next-line no-await-in-loop -- each poll re-reads the log after the previous one missed
    const rows = await walkAnnouncements()
    found = matchAnnouncements(keys, rows).find((p) => p.uid.toLowerCase() === uid.toLowerCase()) ?? null
  }
  if (found === null) {
    throw new Error(`private discovery: ${uid} never appeared in /announcements`)
  }

  expectMatch(
    'private qr scan',
    await call<VerifyResponse>('/verify', {
      body: JSON.stringify({ qr: toQr(uid) }),
      headers,
      method: 'POST',
    }),
    { decision: 'REJECT', reason: 'LEVEL_REQUIRED' },
  )

  const stealth = privateKeyToAccount(found.stealthPrivateKey)
  const challenge = await mintChallenge(uid)
  const verdict = await verifySigned({
    nonce: challenge.nonce,
    signature: await stealth.signMessage({ message: challenge.challenge }),
    uid,
  })
  expectMatch('private admit', verdict, { decision: 'ADMIT', path: 'signature' })
  if (verdict.holder?.toLowerCase() !== found.stealthAddress.toLowerCase()) {
    throw new Error(`private admit: expected holder ${found.stealthAddress}, got ${String(verdict.holder)}`)
  }

  // The ladder must not leave a usable right behind: this one is MULTI_USE and
  // its stealth key is derivable from the fixed PRF bytes above, so anyone with
  // this repo could keep entering with it. Revoking closes that door and
  // exercises /revoke against a +Private row.
  expectMatch(
    'private revoke',
    await call<RevokeResponse>('/revoke', { body: JSON.stringify({ uid }), headers, method: 'POST' }),
    { revoked: true },
  )
  expectMatch('private after revoke', await call<VerifyResponse>(`/verify/${uid}`), {
    decision: 'REJECT',
    reason: 'REVOKED',
  })
}

const LADDERS = ['bearer', 'signed', 'private'] as const
type Ladder = (typeof LADDERS)[number]
const RUN = {
  bearer: bearerLadder,
  private: privateLadder,
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
