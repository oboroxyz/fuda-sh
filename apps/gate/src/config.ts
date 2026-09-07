// VITE_API_BASE_URL is baked in at build time; local dev talks to `wrangler dev --env local`.
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'
