import type {
  AuthorizeApprovalRequest,
  AuthorizeApprovalResponse,
  AuthorizePreviewResponse,
  ConnectedAppGrantsResponse,
  ConnectedAppRequest,
  ConnectedAppResponse,
  ConnectedAppsResponse,
} from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'
import { apiFetch } from './session-request.ts'

// docs/specs/connected-apps.md — the dashboard's half of connected apps:
// registering apps, approving one for an issuer, and ending approvals.

export const authorizePreview = async (params: URLSearchParams): Promise<Result<AuthorizePreviewResponse>> =>
  await apiFetch<AuthorizePreviewResponse>(API_BASE_URL, `/oauth/authorize?${params.toString()}`)

export const approveAuthorization = async (
  body: AuthorizeApprovalRequest,
): Promise<Result<AuthorizeApprovalResponse>> =>
  await apiFetch<AuthorizeApprovalResponse>(API_BASE_URL, '/oauth/authorize', {
    body: JSON.stringify(body),
    method: 'POST',
  })

export const listConnectedApps = async (): Promise<Result<ConnectedAppsResponse>> =>
  await apiFetch<ConnectedAppsResponse>(API_BASE_URL, '/connected-apps')

export const registerConnectedApp = async (
  body: ConnectedAppRequest,
): Promise<Result<ConnectedAppResponse>> =>
  await apiFetch<ConnectedAppResponse>(API_BASE_URL, '/connected-apps', {
    body: JSON.stringify(body),
    method: 'POST',
  })

export const deleteConnectedApp = async (clientId: string): Promise<Result<{ deleted: true }>> =>
  await apiFetch<{ deleted: true }>(API_BASE_URL, `/connected-apps/${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
  })

export const listGrants = async (): Promise<Result<ConnectedAppGrantsResponse>> =>
  await apiFetch<ConnectedAppGrantsResponse>(API_BASE_URL, '/connected-apps/grants')

export const revokeGrant = async (id: string): Promise<Result<{ revoked: true }>> =>
  await apiFetch<{ revoked: true }>(API_BASE_URL, `/connected-apps/grants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
