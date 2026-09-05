import type { VerifyResponse } from '@fuda/sdk'

import { API_BASE_URL } from './config.ts'
import type { ApiResult } from './verdict.ts'

// Every 5xx and every transport failure is a network condition for the door:
// the gate fails closed (spec §11) and shows the banner.
const call = async (path: string, init: RequestInit): Promise<ApiResult> => {
  try {
    const res = await fetch(`${API_BASE_URL}${path}`, init)
    if (res.status >= 500) {
      return { error: `api ${res.status}`, network: true, ok: false }
    }
    const json: unknown = await res.json()
    if (!res.ok) {
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- narrowing an untyped JSON error body
      const isObject = typeof json === 'object' && json !== null
      const error = isObject && 'error' in json ? String(json.error) : `api ${res.status}`
      return { error, network: false, ok: false }
    }
    // SAFETY: the api's verify endpoints answer VerifyResponse on every 2xx (spec §3).
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the response body is untyped JSON
    return { body: json as VerifyResponse, ok: true }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'network error',
      network: true,
      ok: false,
    }
  }
}

export const previewUid = async (uid: string): Promise<ApiResult> =>
  await call(`/verify/${uid}`, { method: 'GET' })

export const admitQr = async (qr: string): Promise<ApiResult> =>
  await call('/verify', {
    body: JSON.stringify({ qr }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
