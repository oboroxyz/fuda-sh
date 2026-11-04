import * as v from 'valibot'

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

// The widget action the member app renders for a claim. Siteverify echoes it
// back, so a token minted for another widget action does not open this route.
// Cloudflare's documented test keys answer without any action, and are accepted
// so a local browser run works; a real widget of ours always sets one.
const CLAIM_ACTION = 'claim'

// Cloudflare documents tokens as at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048
const TIMEOUT_MS = 10_000

// `failed`: the visitor's token is not good, and a fresh widget run may fix it.
// `unavailable`: nothing about the visitor is known, because Siteverify did not
// answer, answered garbage, or rejected our own secret.
export type TurnstileOutcome = 'failed' | 'passed' | 'unavailable'

// The slice of `fetch` Siteverify needs, so a test can read exactly what was sent.
export type SiteverifyFetch = (
  url: string,
  init: { body: URLSearchParams; method: 'POST'; signal: AbortSignal },
) => Promise<Response>

export interface TurnstileCheck {
  fetcher?: SiteverifyFetch
  ip: string
  secret: string
  token: string | null
}

const Answer = v.object({
  action: v.optional(v.string()),
  'error-codes': v.optional(v.array(v.string())),
  success: v.boolean(),
})

// Our configuration or Cloudflare's own fault, which no new token can fix.
const SERVER_SIDE_ERRORS = new Set(['internal-error', 'invalid-input-secret', 'missing-input-secret'])

export const verifyTurnstile = async ({
  fetcher = fetch,
  ip,
  secret,
  token,
}: TurnstileCheck): Promise<TurnstileOutcome> => {
  if (token === null || token === '' || token.length > MAX_TOKEN_LENGTH) {
    return 'failed'
  }
  try {
    const res = await fetcher(SITEVERIFY_URL, {
      body: new URLSearchParams({ remoteip: ip, response: token, secret }),
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      return 'unavailable'
    }
    const answer = v.safeParse(Answer, await res.json())
    if (!answer.success) {
      return 'unavailable'
    }
    if (answer.output.success) {
      const { action } = answer.output
      return action === undefined || action === CLAIM_ACTION ? 'passed' : 'failed'
    }
    const codes = answer.output['error-codes'] ?? []
    return codes.some((code) => SERVER_SIDE_ERRORS.has(code)) ? 'unavailable' : 'failed'
  } catch {
    return 'unavailable'
  }
}
