// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env dev`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

// The origin the Signed gate must run on — the only one of this Worker's two
// hostnames that the api's CORS list allows (spec §13). Set VITE_APP_ORIGIN to
// the dev origin (http://localhost:5173) when running locally.
export const APP_ORIGIN: string = import.meta.env.VITE_APP_ORIGIN ?? 'https://app.fuda.sh'

// The WebAuthn relying-party id for every fuda passkey ceremony (spec §5):
// `fuda.sh` in production so app.fuda.sh and the apex landing share one passkey.
// Browsers reject an rp.id that is not a registrable suffix of the page's host,
// so local dev must set VITE_RP_ID=localhost.
export const RP_ID: string = import.meta.env.VITE_RP_ID ?? 'fuda.sh'
