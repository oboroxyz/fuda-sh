import type { Result } from '@fuda/sdk/http'

// What a call that threw instead of answering looks like to the screens: a network
// failure they can offer to retry.
const NETWORK_FAILURE = { error: 'network', network: true, ok: false, status: 0 } as const

export const settled = async <T>(call: () => Promise<Result<T>>): Promise<Result<T>> => {
  try {
    return await call()
  } catch {
    return NETWORK_FAILURE
  }
}
