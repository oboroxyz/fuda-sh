// Local dev uses Vite's proxy so SSH previews need only the dashboard port.
// Explicit API origins still win, including production build configuration.
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? '/api' : 'http://localhost:8787')
export const GRAPH_RIGHTS_ENDPOINT: string = import.meta.env.VITE_GRAPH_RIGHTS_ENDPOINT ?? ''

// Saved assets carry the API's absolute URL. Use the same connection as API
// requests in local previews, regardless of which R2 bucket backs the API.
export const assetUrlForDisplay = (url: string): string =>
  import.meta.env.DEV && API_BASE_URL === '/api'
    ? url.replace(/^http:\/\/localhost:8787\/assets\//u, '/api/assets/')
    : url

// The ERC-7677 endpoint the operator's wallet calls when it submits an ENS claim
// on Ethereum Sepolia. It points at fuda's own api rather than a vendor: the
// vendor key must not ship in this bundle, and the restriction that matters —
// sponsor only claims on fuda's registrar — is one no vendor can express.
export const ENS_PAYMASTER_URL: string = import.meta.env.VITE_ENS_PAYMASTER_URL ?? ''
