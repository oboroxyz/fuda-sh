import { buildGoogleSaveUrl, googleConfigFrom } from '@fuda/pass'
import type { AppleLogo } from '@fuda/pass/apple'
import { passPlatform } from '@fuda/sdk'
import { Hono } from 'hono'
import type { Context } from 'hono'

import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { readLogoObject } from '../media/store.ts'
import { loadPassRow } from '../pass/pass-row.ts'
import { passView } from '../pass/pass-view.ts'
import type { PassOutcome } from '../pass/pass-view.ts'
import { PassPage } from '../pass/PassPage.tsx'
import { readStampSummary } from '../stamps/store.ts'
import { resolveVerdict } from './verify.ts'

// A .pkpass embeds its images, so the three small variants are read out of R2
// here rather than linked. A venue with no logo, or a bucket that is not
// configured, simply yields a pass without one.
const appleLogo = async (c: Context<AppEnv>, logoPrefix: string | null): Promise<AppleLogo | null> => {
  const bucket = c.env.MEDIA_BUCKET
  if (bucket === undefined || logoPrefix === null) {
    return null
  }
  const [logo1x, logo2x, logo3x] = await Promise.all([
    readLogoObject(bucket, logoPrefix, 'logo1x'),
    readLogoObject(bucket, logoPrefix, 'logo2x'),
    readLogoObject(bucket, logoPrefix, 'logo3x'),
  ])
  if (logo1x === null || logo2x === null || logo3x === null) {
    return null
  }
  return {
    logo1x: new Uint8Array(logo1x.body),
    logo2x: new Uint8Array(logo2x.body),
    logo3x: new Uint8Array(logo3x.body),
  }
}

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
  const now = c.get('now')()
  const [resolved, stamps] = await Promise.all([
    resolveVerdict(c, found.row.uid, now),
    readStampSummary(c.get('db'), found.row.uid, now),
  ])
  const outcome: PassOutcome = resolved.ok
    ? { decision: resolved.out.decision, reason: resolved.out.reason }
    : null
  return await c.html(
    PassPage(passView(found.row, outcome, stamps), passPlatform(c.req.header('user-agent') ?? '')),
  )
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
  const view = passView(found.row, null, await readStampSummary(c.get('db'), found.row.uid, c.get('now')()))
  try {
    const saveUrl = await buildGoogleSaveUrl(
      cfg,
      {
        branding: view.branding,
        holderShort: view.holderShort,
        qr: view.qr,
        stamps: view.stamps,
        tierLabel: view.tier,
        uid: found.row.uid,
      },
      [new URL(c.env.API_BASE_URL).origin, 'https://dash.fuda.sh', 'https://app.fuda.sh'],
      c.get('now')(),
    )
    return jsonResponse(c, { saveUrl }, 200)
  } catch (error) {
    // An unimportable GOOGLE_SA_KEY_PEM or a malformed API_BASE_URL is a misconfigured
    // deployment, not an internal defect: the endpoint reads as unconfigured and the log says why.
    // oxlint-disable-next-line no-console -- a misconfigured deploy must be visible in wrangler tail
    console.error('[fuda-api] the Google pass could not be built (GOOGLE_* secrets or API_BASE_URL)', error)
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
  const view = passView(found.row, null, await readStampSummary(c.get('db'), found.row.uid, c.get('now')()))
  try {
    const pkpass = await buildPkpass(
      cfg,
      {
        branding: view.branding,
        holderShort: view.holderShort,
        qr: view.qr,
        stamps: view.stamps,
        tierLabel: view.tier,
        uid: found.row.uid,
      },
      c.get('now')(),
      await appleLogo(c, found.row.logoPrefix),
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
    // oxlint-disable-next-line no-console -- a misconfigured deploy must be visible in wrangler tail
    console.error('[fuda-api] the APPLE_* certificate or key could not be used to sign a pass', error)
    return errorResponse(c, 'apple_not_configured', 501)
  }
})
