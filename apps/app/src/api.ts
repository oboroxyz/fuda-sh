import type { ChallengeResponse, Hex, VerifySignedResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/web-kit'
import type { Result } from '@fuda/web-kit'

import { API_BASE_URL } from './config.ts'
import type { AnnouncementDto } from './private-member.ts'

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

export interface AnnouncementsResponse {
  announcements: AnnouncementDto[]
  syncedTo: number | null
}

// The whole cached ERC-5564 log from the floor: matching is client-side, so the
// api never learns which rows are this member's (spec §3).
export const announcements = async (fromBlock = 0): Promise<Result<AnnouncementsResponse>> =>
  await apiFetch<AnnouncementsResponse>(API_BASE_URL, `/announcements?fromBlock=${fromBlock}`)
