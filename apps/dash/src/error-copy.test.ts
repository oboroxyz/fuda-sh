import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DASH_ERROR_COPY, dashMessage } from './error-copy.ts'

const API_SOURCES = [
  'handlers/auth.ts',
  'handlers/connected-apps.ts',
  'handlers/ens-claim.ts',
  'handlers/issue.ts',
  'handlers/issuer-management.ts',
  'handlers/issuers.ts',
  'handlers/media.ts',
  'handlers/reception.ts',
  'handlers/revoke.ts',
  'handlers/verify.ts',
  'issue/issue-for-card.ts',
  'mcp/tools.ts',
  'middleware/admin-auth.ts',
  'middleware/operator-auth.ts',
  'middleware/operator-or-admin.ts',
]

// These paths answer the dashboard's API calls, including activity errors from
// connected apps. Field validation and revocation also return computed codes.
const listedCodes = new Set([
  'bad_handle',
  'bad_input',
  'bad_response',
  'bad_slug',
  'chain_error',
  'client_ip_required',
  'internal',
  'no_signer',
  'not_found',
  'rate_limited',
  'session_changed',
])
for (const file of API_SOURCES) {
  const source = readFileSync(new URL(`../../api/src/${file}`, import.meta.url), 'utf-8')
  for (const match of source.matchAll(/(?:errorResponse\(c, |error: )'(?<code>[a-z_]+)'/gu)) {
    const code = match.groups?.code
    if (code !== undefined) {
      listedCodes.add(code)
    }
  }
}

// The redirect validator returns one of these through a conditional expression.
listedCodes.add('bad_redirect_uri')

describe('dashboard error messages', () => {
  it.each([...listedCodes].toSorted())('has English and Japanese copy for API code %s', (code) => {
    const copy = Object.entries(DASH_ERROR_COPY).find(([key]) => key === code)?.[1]
    expect(copy).toBeDefined()
    expect(copy?.en).toMatch(/[a-z]/iu)
    expect(copy?.ja).toMatch(/[ぁ-んァ-ヶ]/u)
    expect(dashMessage(code, 'ja')).not.toContain(code)
  })

  it.each(['future_code', 'constructor', '__proto__'])(
    'explains unknown code %s in both languages',
    (code) => {
      expect(dashMessage(code, 'en')).toBe(`Something went wrong. Try again. (${code})`)
      expect(dashMessage(code, 'ja')).toBe(`処理を完了できませんでした。もう一度お試しください。 (${code})`)
    },
  )
})
