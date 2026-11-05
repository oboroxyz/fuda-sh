import * as v from 'valibot'

import type { Bindings } from '../env.ts'

export type ApplePushResult =
  | { outcome: 'sent' }
  // APNs says this token will never work again, so its device is dropped.
  | { outcome: 'token_invalid' }
  | { outcome: 'failed'; reason: string; status: number }

// The port tests replace, and the one seam a different route to APNs would need.
export type ApplePushSender = (pushToken: string, passTypeId: string) => Promise<ApplePushResult>

const ApnsError = v.object({ reason: v.string() })

const reasonOf = async (response: Response): Promise<string> => {
  const parsed = v.safeParse(ApnsError, await response.json().catch(() => null))
  return parsed.success ? parsed.output.reason : ''
}

// developer.apple.com/documentation/walletpasses/adding-a-web-service-to-update-passes:
// the certificate that signed the pass, the device's push token, an empty JSON dictionary.
// Pass updates exist only in APNs production. No apns-push-type: each documented value is
// defined by an app's payload, and Apple names none for a pass update.
export const applePushSenderFrom = (binding?: Bindings['APPLE_PUSH_CERT']): ApplePushSender | null =>
  binding === undefined
    ? null
    : async (pushToken, passTypeId) => {
        const response = await binding.fetch(`https://api.push.apple.com/3/device/${pushToken}`, {
          body: '{}',
          headers: { 'apns-topic': passTypeId },
          method: 'POST',
          signal: AbortSignal.timeout(10_000),
        })
        if (response.ok) {
          return { outcome: 'sent' }
        }
        const reason = await reasonOf(response)
        return response.status === 410 || reason === 'BadDeviceToken'
          ? { outcome: 'token_invalid' }
          : { outcome: 'failed', reason, status: response.status }
      }
