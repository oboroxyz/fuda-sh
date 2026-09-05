// Live end-to-end smoke test: issue → verify → revoke → verify against a
// running api (a deployed worker or `wrangler dev`). Runs under tsx (node),
// not workerd. Exits non-zero on the first unexpected verdict.
import type { IssueResponse, RevokeResponse, VerifyResponse } from '@fuda/sdk'

const api = process.env.API_URL ?? 'http://localhost:8787'
const token = process.env.ADMIN_TOKEN
const headers = new Headers({ 'content-type': 'application/json' })
if (token !== undefined) {
  headers.set('authorization', `Bearer ${token}`)
}

const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${api}${path}`, init)
  // SAFETY: this is a throwaway smoke script, not app code — the caller names
  // the response type it expects and trusts the api's documented contract;
  // there is no runtime schema to validate an ad hoc HTTP JSON body against.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY comment above
  const body = (await res.json()) as T
  // oxlint-disable-next-line no-console -- smoke script progress output, not app logging
  console.log(`${init?.method ?? 'GET'} ${path} → ${res.status}`, JSON.stringify(body))
  return body
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

const issued = await call<IssueResponse>('/issue', {
  body: JSON.stringify({ memberId: `smoke-${Date.now()}`, usageModel: 0 }),
  headers,
  method: 'POST',
})
if (!('qr' in issued)) {
  throw new Error(`issue: expected a bearer response with qr, got ${JSON.stringify(issued)}`)
}

expectMatch('verify preview', await call<VerifyResponse>(`/verify/${issued.uid}`), { decision: 'ADMIT' })
expectMatch(
  'first scan',
  await call<VerifyResponse>('/verify', { body: JSON.stringify({ qr: issued.qr }), headers, method: 'POST' }),
  { decision: 'ADMIT' },
)
expectMatch(
  'second scan',
  await call<VerifyResponse>('/verify', { body: JSON.stringify({ qr: issued.qr }), headers, method: 'POST' }),
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

// oxlint-disable-next-line no-console -- smoke script success marker, not app logging
console.log('smoke OK')
