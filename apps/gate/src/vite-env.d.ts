/// <reference types="vite/client" />

// Opts into strict `ImportMetaEnv` typing (no implicit fallback to `any` for
// unknown keys) and declares the env vars this app actually reads.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

// The gate reads no build-time values: its api origin is the Worker's
// API_BASE_URL var.
// oxlint-disable-next-line typescript/no-empty-interface, typescript/no-empty-object-type -- an empty ImportMetaEnv keeps strict typing on with no keys declared
interface ImportMetaEnv {}
