import type { ChallengeResponse, Hex, VerifyResponse, VerifySignedResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

export const challenge = async (uid: Hex): Promise<Result<ChallengeResponse>> =>
  await apiFetch<ChallengeResponse>(API_BASE_URL, '/challenge', {
    body: JSON.stringify({ uid }),
    method: 'POST',
  })

export const verifySigned = async (body: {
  uid: Hex
  nonce: Hex
  signature: Hex
}): Promise<Result<VerifySignedResponse>> =>
  await apiFetch<VerifySignedResponse>(API_BASE_URL, '/verify-signed', {
    body: JSON.stringify(body),
    method: 'POST',
  })

export const verifyUid = async (uid: Hex): Promise<Result<VerifyResponse>> =>
  await apiFetch<VerifyResponse>(API_BASE_URL, `/verify/${uid}`, { method: 'GET' })
