import type { IssueResponse, MembersResponse, RevokeResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

export type { Result } from '@fuda/sdk/http'

// The admin token lives only in memory for the tab's lifetime (docs/specs/pass-types-and-flows.md#surfaces). It is
// fuda's API authorization, not a user account: an api with ADMIN_TOKEN unset
// serves every admin route without authorization and ignores this header.
export const listMembers = async (token: string): Promise<Result<MembersResponse>> =>
  await apiFetch<MembersResponse>(API_BASE_URL, '/members', { token })

export const issueRight = async (
  token: string,
  body: Record<string, string | number>,
): Promise<Result<IssueResponse>> =>
  await apiFetch<IssueResponse>(API_BASE_URL, '/issue', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })

export const revokeRight = async (token: string, uid: string): Promise<Result<RevokeResponse>> =>
  await apiFetch<RevokeResponse>(API_BASE_URL, '/revoke', {
    body: JSON.stringify({ uid }),
    method: 'POST',
    token,
  })
