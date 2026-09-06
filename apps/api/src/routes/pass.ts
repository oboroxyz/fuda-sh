import { buildGoogleSaveUrl, googleConfigFrom } from '@fuda/pass'
import { Hono } from 'hono'

import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { loadPassRow } from '../pass/pass-row.ts'
import { passView } from '../pass/pass-view.ts'
import type { PassOutcome } from '../pass/pass-view.ts'
import { PassPage } from '../pass/PassPage.tsx'
import { resolveVerdict } from './verify.ts'

export const passRoutes = new Hono<AppEnv>()

// The browser-based pass: the all-OS floor (docs/specs/pass-types-and-flows.md#passes). Depends on no platform
// secrets and never 5xxs — a chain failure only degrades the status to UNKNOWN.
passRoutes.get('/pass/:uid', async (c) => {
  const found = await loadPassRow(c, c.req.param('uid'))
  if (!found.ok) {
    return found.res
  }
  // The live status is read per request; a cached copy would show a stale
  // verdict at the door (loadPassRow already set no-store).
  const resolved = await resolveVerdict(c, found.row.uid, c.get('now')())
  const outcome: PassOutcome = resolved.ok
    ? { decision: resolved.out.decision, reason: resolved.out.reason }
    : null
  return await c.html(PassPage(passView(found.row, outcome)))
})

// Wallet-pass builders live in @fuda/pass; an unconfigured platform answers 501.
passRoutes.get('/pass/:uid/google', async (c) => {
  const found = await loadPassRow(c, c.req.param('uid'))
  if (!found.ok) {
    return found.res
  }
  const cfg = googleConfigFrom(c.env)
  if (cfg === null) {
    return errorResponse(c, 'google_not_configured', 501)
  }
  const view = passView(found.row, null)
  try {
    const saveUrl = await buildGoogleSaveUrl(
      cfg,
      { holderShort: view.holderShort, qr: view.qr, tierLabel: view.tier, uid: found.row.uid },
      [new URL(c.env.API_BASE_URL).origin, 'https://dash.fuda.sh', 'https://app.fuda.sh'],
      c.get('now')(),
    )
    return jsonResponse(c, { saveUrl }, 200)
  } catch (error) {
    // An unimportable GOOGLE_SA_KEY_PEM is a misconfigured deployment, not an
    // internal defect: the endpoint reads as unconfigured and says why in the log.
    console.error('[fuda-api] GOOGLE_SA_KEY_PEM could not be imported as an RS256 key', error)
    return errorResponse(c, 'google_not_configured', 501)
  }
})

passRoutes.get('/pass/:uid/apple.pkpass', async (c) => {
  const found = await loadPassRow(c, c.req.param('uid'))
  if (!found.ok) {
    return found.res
  }
  // Dynamic: @fuda/pass/apple pulls in pkijs and asn1js, and only this one
  // route needs them. Importing it lazily keeps them out of the Worker's
  // startup path, which every other request pays for.
  const { appleConfigFrom, buildPkpass } = await import('@fuda/pass/apple')
  const cfg = appleConfigFrom(c.env)
  if (cfg === null) {
    return errorResponse(c, 'apple_not_configured', 501)
  }
  const view = passView(found.row, null)
  try {
    const pkpass = await buildPkpass(
      cfg,
      { holderShort: view.holderShort, qr: view.qr, tierLabel: view.tier, uid: found.row.uid },
      c.get('now')(),
    )
    return new Response(pkpass, {
      headers: {
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="fuda-${found.row.uid.slice(0, 10)}.pkpass"`,
        'content-type': 'application/vnd.apple.pkpass',
      },
    })
  } catch (error) {
    // An unparsable certificate or key is a misconfigured deployment, not an
    // internal defect: the endpoint reads as unconfigured and says why in the log.
    console.error('[fuda-api] the APPLE_* certificate or key could not be used to sign a pass', error)
    return errorResponse(c, 'apple_not_configured', 501)
  }
})
