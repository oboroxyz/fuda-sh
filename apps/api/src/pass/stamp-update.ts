import { googleAccessToken, googleConfigFrom, patchGoogleGenericObject } from '@fuda/pass'
import type { Hex, StampSummary } from '@fuda/sdk'
import type { Context } from 'hono'

import type { AppEnv } from '../env.ts'
import { waitUntilOf } from '../routes/verify.ts'
import { readStampSummary } from '../stamps/store.ts'

const sameDisplay = (left: StampSummary, right: StampSummary): boolean =>
  left.enabled === right.enabled &&
  left.dailyLimit === right.dailyLimit &&
  left.goal === right.goal &&
  left.total === right.total &&
  left.today === right.today

const updateStampPass = async (c: Context<AppEnv>, uid: Hex): Promise<void> => {
  const cfg = googleConfigFrom(c.env)
  if (cfg === null) {
    return
  }
  try {
    const signal = AbortSignal.timeout(15_000)
    const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      await fetch(input, { ...init, signal })
    const accessToken = await googleAccessToken(cfg, c.get('now')(), request)
    // Read after OAuth so an older, delayed job also observes credits committed
    // by newer receptions before either one patches the saved object.
    let summary = await readStampSummary(c.get('db'), uid, c.get('now')())
    for (let attempt = 0; summary !== null && attempt < 3; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- convergence requires patching before observing the next durable summary
      await patchGoogleGenericObject(cfg, uid, summary, accessToken, request)
      // oxlint-disable-next-line no-await-in-loop -- this sequential reread detects a concurrent durable change
      const latest = await readStampSummary(c.get('db'), uid, c.get('now')())
      if (latest === null || sameDisplay(summary, latest)) {
        return
      }
      summary = latest
    }
    if (summary !== null) {
      // oxlint-disable-next-line no-console -- a later reception/retry will resync after sustained churn
      console.error('[fuda-api] Google Wallet stamp update deferred after repeated summary changes')
    }
  } catch (error) {
    // This effect runs after reception committed. Wallet or OAuth failure must
    // never turn an admitted Entry into a failure or attempt another credit.
    // oxlint-disable-next-line no-console -- external sync failures are visible in wrangler tail
    console.error('[fuda-api] Google Wallet stamp update failed', error)
  }
}

export const scheduleStampPassUpdate = (c: Context<AppEnv>, uid: Hex): void => {
  if (googleConfigFrom(c.env) === null) {
    return
  }
  waitUntilOf(c)(updateStampPass(c, uid))
}
