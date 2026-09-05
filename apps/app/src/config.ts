// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env dev`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'

// The origin the Signed gate must run on — the only one of this Worker's two
// hostnames that the api's CORS list allows (spec §13). Set VITE_APP_ORIGIN to
// the dev origin (http://localhost:5173) when running locally.
export const APP_ORIGIN: string = import.meta.env.VITE_APP_ORIGIN ?? 'https://app.fuda.sh'
