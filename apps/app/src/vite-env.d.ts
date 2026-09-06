/// <reference types="vite/client" />

// Opts into strict `ImportMetaEnv` typing (no implicit fallback to `any` for
// unknown keys) and declares the env vars this app actually reads.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_APP_ORIGIN?: string
  readonly VITE_GRAPH_RIGHTS_ENDPOINT?: string
  readonly VITE_RP_ID?: string
}
