import { base64urlBytes } from '@fuda/pass'
import type { Hex } from '@fuda/sdk'

import type { Bindings } from '../env.ts'

export interface AppleWebService {
  passTypeId: string
  secret: string
}

// null means installed passes stay snapshots: pass.json names no web service, and
// nothing is recorded when a pass changes.
export const appleWebServiceFrom = (
  env: Pick<Bindings, 'APPLE_PASS_TYPE_ID' | 'APPLE_WEB_SERVICE_SECRET'>,
): AppleWebService | null => {
  const passTypeId = env.APPLE_PASS_TYPE_ID ?? ''
  const secret = env.APPLE_WEB_SERVICE_SECRET ?? ''
  return passTypeId === '' || secret === '' ? null : { passTypeId, secret }
}

const encoder = new TextEncoder()

// Derived, so nothing per pass is stored. Apple never lets an update change this value,
// so rotating the secret strands every installed pass (docs/runbook.md).
export const applePassToken = async (secret: string, uid: Hex): Promise<string> => {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { hash: 'SHA-256', name: 'HMAC' },
    false,
    ['sign'],
  )
  return base64urlBytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(uid))))
}

const sha256 = async (text: string): Promise<ArrayBuffer> =>
  await crypto.subtle.digest('SHA-256', encoder.encode(text))

export const appleAuthorized = async (
  secret: string,
  uid: Hex,
  header: string | undefined,
): Promise<boolean> => {
  const [presented, expected] = await Promise.all([
    sha256(header ?? ''),
    sha256(`ApplePass ${await applePassToken(secret, uid)}`),
  ])
  return crypto.subtle.timingSafeEqual(presented, expected)
}
