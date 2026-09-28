// apps/api/scripts/world-spike.ts — throwaway; deleted in Task 8.
// Prints an RP-signed context so a phone can produce a proof against it.
//
// Real import established during Task 1's Step 3 inspection: `signRequest` lives in
// `@worldcoin/idkit-server` (pure JS, no Node built-ins; re-exported unchanged by
// `@worldcoin/idkit-core/signing`). See .superpowers/2026-09-26-world-spike-notes.md
// for the full trace, including the runtime-gate finding.
import { signRequest } from '@worldcoin/idkit-server'

const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY ?? ''
const action = process.env.WORLD_ACTION ?? ''
const appId = process.env.WORLD_APP_ID ?? ''
const rpId = process.env.WORLD_RP_ID ?? ''

if (!signingKeyHex || !action || !appId || !rpId) {
  console.error(
    'Missing one of WORLD_RP_SIGNING_KEY, WORLD_ACTION, WORLD_APP_ID, WORLD_RP_ID in the environment.',
  )
  process.exit(1)
}

const signed = signRequest({ action, signingKeyHex })

// RpContext (as consumed by `IDKit.request({ rp_context })`) renames the signRequest
// output: sig -> signature, createdAt -> created_at, expiresAt -> expires_at, and adds rp_id.
const rpContext = {
  created_at: signed.createdAt,
  expires_at: signed.expiresAt,
  nonce: signed.nonce,
  rp_id: rpId,
  signature: signed.sig,
}

console.log(JSON.stringify({ action, app_id: appId, rp_context: rpContext }, null, 2))
