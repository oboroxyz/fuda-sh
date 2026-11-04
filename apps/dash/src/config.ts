import { parseChainConfig } from '@fuda/chains'

export const CHAIN = parseChainConfig(import.meta.env.VITE_CHAIN_ID)

// The browser reaches the api only through its own Worker, which forwards
// `/api/*` with the session cookie's credential
// (docs/adr/0010-void-pages-and-frontend-workers.md).
export const API_BASE_URL = '/api'
export const GRAPH_RIGHTS_ENDPOINT: string = import.meta.env.VITE_GRAPH_RIGHTS_ENDPOINT ?? ''

// Saved assets carry the API's absolute URL. Use the same connection as API
// requests in local previews, regardless of which R2 bucket backs the API.
export const assetUrlForDisplay = (url: string): string =>
  import.meta.env.DEV ? url.replace(/^http:\/\/localhost:8787\/assets\//u, '/api/assets/') : url

// The ERC-7677 endpoint the operator's wallet calls when it submits an ENS claim
// on Ethereum Sepolia. It points at fuda's own api rather than a vendor: the
// vendor key must not ship in this bundle, and the restriction that matters —
// sponsor only claims on fuda's registrar — is one no vendor can express.
export const ENS_PAYMASTER_URL: string = import.meta.env.VITE_ENS_PAYMASTER_URL ?? ''
