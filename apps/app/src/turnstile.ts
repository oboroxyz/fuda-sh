import { TURNSTILE_SITE_KEY } from './config.ts'

// Cloudflare Turnstile guards the one public write a member makes: claiming a
// card (docs/specs/pass-types-and-flows.md#claim-bot-check). The widget is
// loaded and rendered only when the member taps to claim, so a card page that is
// only read never talks to Cloudflare.
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

// The widget action the api checks on the Siteverify answer.
const CLAIM_ACTION = 'claim'

export interface TurnstileApi {
  remove: (widgetId: string) => void
  render: (container: HTMLElement, options: TurnstileOptions) => string
}

interface TurnstileOptions {
  action: string
  appearance: 'interaction-only'
  callback: (token: string) => void
  'error-callback': () => void
  'expired-callback': () => void
  'timeout-callback': () => void
  'unsupported-callback': () => void
  sitekey: string
  size: 'flexible'
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

// `token` is null when the deployment has no site key: the api skips the check
// then too, so the claim goes through without one.
export type ClaimToken = { ok: true; token: string | null } | { ok: false }

let loading: Promise<TurnstileApi> | null = null

const loadTurnstile = async (): Promise<TurnstileApi> => {
  // oxlint-disable-next-line promise/avoid-new -- bridges the script tag's load events into a promise
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_SRC
    script.async = true
    script.addEventListener('load', () => {
      if (window.turnstile === undefined) {
        loading = null
        reject(new Error('turnstile missing after load'))
        return
      }
      resolve(window.turnstile)
    })
    script.addEventListener('error', () => {
      // A blocked or failed script is retried by the next claim.
      loading = null
      script.remove()
      reject(new Error('turnstile script failed to load'))
    })
    document.head.append(script)
  })
  return await loading
}

// One widget run, one token. Siteverify accepts a token once, so a retry must
// call this again rather than keep the last answer. `interaction-only` keeps the
// widget invisible unless Cloudflare decides the member must act.
export const requestClaimToken = async (
  siteKey: string,
  container: HTMLElement | null,
  load: () => Promise<TurnstileApi> = loadTurnstile,
): Promise<ClaimToken> => {
  if (siteKey === '') {
    return { ok: true, token: null }
  }
  if (container === null) {
    return { ok: false }
  }
  let api: TurnstileApi
  try {
    api = await load()
  } catch {
    return { ok: false }
  }
  let widgetId: string | null = null
  // oxlint-disable-next-line promise/avoid-new -- bridges the widget's callbacks into a promise
  const token = await new Promise<string | null>((resolve) => {
    const fail = (): void => {
      resolve(null)
    }
    widgetId = api.render(container, {
      action: CLAIM_ACTION,
      appearance: 'interaction-only',
      callback: resolve,
      'error-callback': fail,
      'expired-callback': fail,
      sitekey: siteKey,
      size: 'flexible',
      'timeout-callback': fail,
      'unsupported-callback': fail,
    })
  })
  if (widgetId !== null) {
    api.remove(widgetId)
  }
  return token === null ? { ok: false } : { ok: true, token }
}

export const claimToken = async (container: HTMLElement | null): Promise<ClaimToken> =>
  await requestClaimToken(TURNSTILE_SITE_KEY, container)
