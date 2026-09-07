import type { VerifyResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

export const previewUid = async (uid: string): Promise<Result<VerifyResponse>> =>
  await apiFetch<VerifyResponse>(API_BASE_URL, `/verify/${uid}`, { method: 'GET' })

export const admitQr = async (qr: string): Promise<Result<VerifyResponse>> =>
  await apiFetch<VerifyResponse>(API_BASE_URL, '/verify', {
    body: JSON.stringify({ qr }),
    method: 'POST',
  })
