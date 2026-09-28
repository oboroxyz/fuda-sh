import { googleAccessToken, googleConfigFrom, patchGoogleBadgeModules } from '@fuda/pass'
import type { Hex } from '@fuda/sdk'
import type { Context } from 'hono'

import { readBadges } from '../badges/store.ts'
import type { AppEnv } from '../env.ts'
import { waitUntilOf } from '../routes/verify.ts'

const updateBadgePass = async (c: Context<AppEnv>, uid: Hex): Promise<void> => {
  const cfg = googleConfigFrom(c.env)
  if (cfg === null) {
    return
  }
  try {
    const signal = AbortSignal.timeout(15_000)
    const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
      await fetch(input, { ...init, signal })
    const accessToken = await googleAccessToken(cfg, c.get('now')(), request)
    // Read the stored badges, not the just-submitted proof, so the pass
    // reflects what was actually saved rather than what was merely claimed.
    const badges = await readBadges(c.get('db'), uid)
    await patchGoogleBadgeModules(cfg, uid, badges, accessToken, request)
  } catch (error) {
    // This effect runs after the badge route already answered. Wallet or
    // OAuth failure must never turn a saved badge into a failed request or
    // retry the save.
    // oxlint-disable-next-line no-console -- external sync failures are visible in wrangler tail
    console.error('[fuda-api] Google Wallet badge update failed', error)
  }
}

export const scheduleBadgePassUpdate = (c: Context<AppEnv>, uid: Hex): void => {
  if (googleConfigFrom(c.env) === null) {
    return
  }
  waitUntilOf(c)(updateBadgePass(c, uid))
}
