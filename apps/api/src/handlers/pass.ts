import { buildGoogleSaveUrl, googleConfigFrom } from '@fuda/pass'
import type { GooglePassInput } from '@fuda/pass'
import type { AppleLogo } from '@fuda/pass/apple'
import { passPlatform } from '@fuda/sdk'
import type { PassCardResponse } from '@fuda/sdk'
import type { Context } from 'hono'
import { defineHandler } from 'void'

import type { AppEnv } from '../env.ts'
import { errorResponse, jsonResponse } from '../json.ts'
import { readLogoObject } from '../media/store.ts'
import { applePassToken, appleWebServiceFrom } from '../pass/apple-web-service.ts'
import { passBackup } from '../pass/pass-backup.ts'
import { loadPassRow } from '../pass/pass-row.ts'
import { passView } from '../pass/pass-view.ts'
import type { PassOutcome, PassRow } from '../pass/pass-view.ts'
import { PassPage } from '../pass/PassPage.tsx'
import { readStampSummary } from '../stamps/store.ts'
import { badgesFor, resolveVerdict } from './verify.ts'

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

// What a wallet pass shows, read when the pass is built. The badge read is
// advisory like every other: `badgesFor` swallows a lookup failure, so it can
// never turn a pass request into an error.
const walletPassInput = async (c: Context<AppEnv>, row: PassRow): Promise<GooglePassInput> => {
  const [stamps, badges] = await Promise.all([
    readStampSummary(c.get('db'), row.uid, c.get('now')()),
    badgesFor(c, row.uid),
  ])
  const view = passView(row, null, stamps)
  return {
    badges,
    branding: view.branding,
    holderShort: view.holderShort,
    qr: view.qr,
    stamps: view.stamps,
    tierLabel: view.tier,
    uid: row.uid,
    validity: row.validity,
  }
}

// The browser-based pass: the all-OS floor (docs/specs/pass-types-and-flows.md#passes). Depends on no platform
// secrets and never 5xxs — a chain failure only degrades the status to UNKNOWN.
export const getPassUid = defineHandler(async (c) => {
  const found = await loadPassRow(c, c.req.param().uid)
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

// The venue's look behind a pass, as JSON, for a client that lists passes in
// that look (the member app). Same lookup and same 400 → 404
// contract as the page. An admin-issued right answers `card: null`: it has no
// venue card and keeps the plain fuda look.
export const getPassUidCard = defineHandler(async (c) => {
  const found = await loadPassRow(c, c.req.param().uid)
  if (!found.ok) {
    return found.res
  }
  const { branding } = found.row
  const body: PassCardResponse = {
    card:
      branding === null
        ? null
        : {
            brandColor: branding.brandColor,
            cardTitle: branding.cardTitle,
            category: branding.category,
            issuerName: branding.issuerName,
            logoUrl: branding.logoUrl,
            memberNumber: branding.memberNumber,
          },
  }
  return jsonResponse(c, body)
})

// docs/specs/pass-types-and-flows.md#keeping-a-pass-without-a-provider. Same lookup and
// contract as the page, and for the same reason open to anyone with the uid: the uid is
// the pass.
export const getPassUidBackup = defineHandler(async (c) => {
  const found = await loadPassRow(c, c.req.param().uid)
  if (!found.ok) {
    return found.res
  }
  return jsonResponse(c, await passBackup(c, found.row.uid, found.row.holder))
})

// Wallet-pass builders live in @fuda/pass; an unconfigured platform answers 501.
export const getPassUidGoogle = defineHandler(async (c) => {
  const found = await loadPassRow(c, c.req.param().uid)
  if (!found.ok) {
    return found.res
  }
  const cfg = googleConfigFrom(c.env)
  if (cfg === null) {
    return errorResponse(c, 'google_not_configured', 501)
  }
  // Badges ride along in the generated object, so a member who badged first and
  // saved the pass afterwards sees the badge without waiting for a patch (there
  // is nothing to patch until a save completes).
  const input = await walletPassInput(c, found.row)
  try {
    const saveUrl = await buildGoogleSaveUrl(
      cfg,
      input,
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

// Null when the deployment cannot sign a pass, which every Apple route answers as 501.
// The same snapshot as the Google save link, plus what only a pass Wallet can refresh has:
// the web service.
export const buildApplePass = async (
  c: Context<AppEnv>,
  row: PassRow,
): Promise<Uint8Array<ArrayBuffer> | null> => {
  // Dynamic: @fuda/pass/apple pulls in pkijs and asn1js, and only the routes that build a
  // pass need them. Importing it lazily keeps them out of the Worker's startup path, which
  // every other request pays for.
  const { appleConfigFrom, buildPkpass } = await import('@fuda/pass/apple')
  const cfg = appleConfigFrom(c.env)
  if (cfg === null) {
    return null
  }
  const service = appleWebServiceFrom(c.env)
  const input = {
    ...(await walletPassInput(c, row)),
    webService:
      service === null
        ? null
        : {
            authenticationToken: await applePassToken(service.secret, row.uid),
            url: `${c.env.API_BASE_URL}/apple`,
          },
  }
  try {
    return await buildPkpass(cfg, input, c.get('now')(), await appleLogo(c, row.logoPrefix))
  } catch (error) {
    // An unparsable certificate or key is a misconfigured deployment, not an
    // internal defect: the endpoint reads as unconfigured and says why in the log.
    // oxlint-disable-next-line no-console -- a misconfigured deploy must be visible in wrangler tail
    console.error('[fuda-api] the APPLE_* certificate or key could not be used to sign a pass', error)
    return null
  }
}

export const getPassUidApplePkpass = defineHandler(async (c) => {
  const found = await loadPassRow(c, c.req.param().uid)
  if (!found.ok) {
    return found.res
  }
  const pkpass = await buildApplePass(c, found.row)
  if (pkpass === null) {
    return errorResponse(c, 'apple_not_configured', 501)
  }
  return new Response(pkpass, {
    headers: {
      'cache-control': 'no-store',
      'content-disposition': `attachment; filename="fuda-${found.row.uid.slice(0, 10)}.pkpass"`,
      'content-type': 'application/vnd.apple.pkpass',
    },
  })
})
