// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env dev`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
export const GRAPH_RIGHTS_ENDPOINT: string = import.meta.env.VITE_GRAPH_RIGHTS_ENDPOINT ?? ''
