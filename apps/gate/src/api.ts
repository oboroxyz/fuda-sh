import type { VerifyResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

export const previewUid = async (uid: string): Promise<Result<VerifyResponse>> =>
  await apiFetch<VerifyResponse>(API_BASE_URL, `/verify/${uid}`, { method: 'GET' })

// `venue` is the station's configured shop, or null for a gate with none; null
// leaves the field out of the body, which the api reads as "check no venue".
export const admitQr = async (qr: string, venue: string | null): Promise<Result<VerifyResponse>> =>
  await apiFetch<VerifyResponse>(API_BASE_URL, '/verify', {
    body: JSON.stringify({ qr, venue: venue ?? undefined }),
    method: 'POST',
  })
