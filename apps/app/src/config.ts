import { parseChainConfig } from '@fuda/chains'

export const CHAIN = parseChainConfig(import.meta.env.VITE_CHAIN_ID)

// The browser reaches the api only through its own Worker, which forwards
// `/api/*` with the member session cookie's credential
// (../../../docs/architecture.md#frontend-workers).
export const API_BASE_URL = '/api'

// Public Graph gateway or a same-origin proxy URL. Never put a Studio deploy key in a VITE_* binding.
export const GRAPH_RIGHTS_ENDPOINT: string = import.meta.env.VITE_GRAPH_RIGHTS_ENDPOINT ?? ''

// The origin the member and card pages answer on; the Worker redirects any
// other host there (docs/specs/pass-types-and-flows.md#surfaces). Local
// development sets VITE_APP_ORIGIN to http://localhost:5173.
export const APP_ORIGIN: string = import.meta.env.VITE_APP_ORIGIN ?? 'https://app.fuda.sh'

// The WebAuthn relying-party id for every fuda passkey ceremony (docs/specs/attestation-model.md#wire-constants):
// `fuda.sh` in production so app.fuda.sh and the apex landing share one passkey.
// Browsers reject an rp.id that is not a registrable suffix of the page's host,
// so direct fixed-port development must set VITE_RP_ID=localhost.
export const RP_ID: string = import.meta.env.VITE_RP_ID ?? 'fuda.sh'

// The Turnstile site key (public) of the widget for the card page's claim. Empty
// disables the widget; the api then has to run without a secret too, or every
// claim answers `bot_check_failed` (docs/runbook.md section 6).
export const TURNSTILE_SITE_KEY: string = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''
