// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env dev`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

// Public Graph gateway or a same-origin proxy URL. Never put a Studio deploy key in a VITE_* binding.
export const GRAPH_RIGHTS_ENDPOINT: string = import.meta.env.VITE_GRAPH_RIGHTS_ENDPOINT ?? ''

// The origin the Signed gate must run on — the only one of this Worker's two
// hostnames that the api's CORS list allows (docs/specs/pass-types-and-flows.md#surfaces). Direct fixed-port
// development must set VITE_APP_ORIGIN to http://localhost:5173; Portless supplies its named public origin.
export const APP_ORIGIN: string = import.meta.env.VITE_APP_ORIGIN ?? 'https://app.fuda.sh'

// The WebAuthn relying-party id for every fuda passkey ceremony (docs/specs/attestation-model.md#wire-constants):
// `fuda.sh` in production so app.fuda.sh and the apex landing share one passkey.
// Browsers reject an rp.id that is not a registrable suffix of the page's host,
// so direct fixed-port development must set VITE_RP_ID=localhost; Portless supplies its exact route hostname.
export const RP_ID: string = import.meta.env.VITE_RP_ID ?? 'fuda.sh'
