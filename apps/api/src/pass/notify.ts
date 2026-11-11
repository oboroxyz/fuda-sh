import {
  googleAccessToken,
  googleConfigFrom,
  patchGoogleBadgeModules,
  patchGoogleGenericObject,
  patchGoogleStatus,
} from '@fuda/pass'
import type { GoogleConfig, PassValidity } from '@fuda/pass'
import type { Hex, StampSummary } from '@fuda/sdk'
import type { Context } from 'hono'

import { readBadges } from '../badges/store.ts'
import type { AppEnv } from '../env.ts'
import { waitUntilOf } from '../handlers/verify.ts'
import { readStampSummary } from '../stamps/store.ts'
import type { ApplePushSender } from './apple-push.ts'
import { dropDevice, pushTargets, recordPassChange } from './apple-registrations.ts'
import type { PassScope, PushTarget } from './apple-registrations.ts'
import { appleWebServiceFrom } from './apple-web-service.ts'
import type { AppleWebService } from './apple-web-service.ts'
import { loadWalletMember } from './wallet-members.ts'
import { walletValidity } from './wallet-status.ts'

const sameDisplay = (left: StampSummary, right: StampSummary): boolean =>
  left.enabled === right.enabled &&
  left.dailyLimit === right.dailyLimit &&
  left.goal === right.goal &&
  left.total === right.total &&
  left.today === right.today

const sameValidity = (left: PassValidity, right: PassValidity): boolean =>
  left.status === right.status && left.validFrom === right.validFrom && left.validUntil === right.validUntil

const syncGooglePass = async (c: Context<AppEnv>, cfg: GoogleConfig, uid: Hex): Promise<void> => {
  try {
    const signal = AbortSignal.timeout(15_000)
    const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      await fetch(input, { ...init, signal })
    const accessToken = await googleAccessToken(cfg, c.get('now')(), request)
    const member = await loadWalletMember(c.get('db'), uid)
    if (member === undefined) {
      return
    }
    // Reread after each patch, like the Stamp loop below: a delayed job that read an
    // older status must not leave it on the object after a newer job patched a revocation.
    let validity = await walletValidity(c.get('db'), uid, member, c.get('now')())
    for (let attempt = 0; attempt < 3; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- convergence requires patching before observing the next durable status
      await patchGoogleStatus(cfg, uid, validity, accessToken, request)
      // oxlint-disable-next-line no-await-in-loop -- this sequential reread detects a concurrent durable change
      const current = await loadWalletMember(c.get('db'), uid)
      if (current === undefined) {
        break
      }
      // oxlint-disable-next-line no-await-in-loop -- the reread status decides whether to patch again
      const latest = await walletValidity(c.get('db'), uid, current, c.get('now')())
      if (sameValidity(validity, latest)) {
        break
      }
      validity = latest
    }
    // Read after OAuth so an older, delayed job also observes credits committed
    // by newer receptions before either one patches the saved object.
    let summary = await readStampSummary(c.get('db'), uid, c.get('now')())
    for (let attempt = 0; summary !== null && attempt < 3; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- convergence requires patching before observing the next durable summary
      await patchGoogleGenericObject(cfg, uid, summary, accessToken, request)
      // oxlint-disable-next-line no-await-in-loop -- this sequential reread detects a concurrent durable change
      const latest = await readStampSummary(c.get('db'), uid, c.get('now')())
      if (latest === null || sameDisplay(summary, latest)) {
        break
      }
      summary = latest
    }
    // The stored badges, so the pass shows what was saved rather than what was claimed.
    await patchGoogleBadgeModules(cfg, uid, await readBadges(c.get('db'), uid), accessToken, request)
  } catch (error) {
    // The action this follows has already committed. Wallet or OAuth failure must never
    // turn it into a failure or attempt it again.
    // oxlint-disable-next-line no-console -- external sync failures are visible in wrangler tail
    console.error('[fuda-api] Google Wallet update failed', error)
  }
}

const pushTo = async (
  db: D1Database,
  send: ApplePushSender,
  passTypeId: string,
  target: PushTarget,
): Promise<void> => {
  const result = await send(target.pushToken, passTypeId)
  if (result.outcome === 'token_invalid') {
    await dropDevice(db, target)
  } else if (result.outcome === 'failed') {
    // Status and reason are how a deployment finds out whether APNs accepts this Worker's
    // certificate and connection. No device id: it is what authenticates the list route.
    // oxlint-disable-next-line no-console -- APNs failures are visible in wrangler tail
    console.error('[fuda-api] APNs refused a pass update', { reason: result.reason, status: result.status })
  }
}

const updateApplePasses = async (
  c: Context<AppEnv>,
  { passTypeId }: AppleWebService,
  scope: PassScope,
): Promise<void> => {
  try {
    await recordPassChange(c.env.DB, scope, c.get('now')())
    const send = c.get('applePush')
    if (send === null) {
      return
    }
    const targets = await pushTargets(c.env.DB, scope)
    const pushes = await Promise.allSettled(
      targets.map(async (target) => {
        await pushTo(c.env.DB, send, passTypeId, target)
      }),
    )
    for (const push of pushes) {
      if (push.status === 'rejected') {
        // oxlint-disable-next-line no-console -- a connection-level failure names itself only here
        console.error('[fuda-api] APNs push failed', push.reason)
      }
    }
  } catch (error) {
    // oxlint-disable-next-line no-console -- external sync failures are visible in wrangler tail
    console.error('[fuda-api] Apple Wallet update failed', error)
  }
}

// What every action that changes a pass calls, after it has committed. It cannot fail the
// action: everything runs in waitUntil, and each wallet platform catches its own failure.
export const notifyPassChanged = (c: Context<AppEnv>, uid: Hex): void => {
  const google = googleConfigFrom(c.env)
  const apple = appleWebServiceFrom(c.env)
  if (google === null && apple === null) {
    return
  }
  waitUntilOf(c)(
    (async () => {
      const pass = await loadWalletMember(c.get('db'), uid)
      if (pass !== undefined) {
        await Promise.all([
          google === null ? null : syncGooglePass(c, google, uid),
          apple === null ? null : updateApplePasses(c, apple, { uid }),
        ])
      }
    })(),
  )
}

// A card or venue edit. Nothing patches the look of a saved Google object yet, so this
// reaches installed Apple passes only.
export const notifyPassesChanged = (c: Context<AppEnv>, scope: PassScope): void => {
  const apple = appleWebServiceFrom(c.env)
  if (apple !== null) {
    waitUntilOf(c)(updateApplePasses(c, apple, scope))
  }
}
