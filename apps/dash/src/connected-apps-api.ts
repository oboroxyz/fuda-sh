import type {
  AuthorizeApprovalRequest,
  AuthorizeApprovalResponse,
  AuthorizePreviewResponse,
  ConnectedAppGrantsResponse,
  ConnectedAppRequest,
  ConnectedAppResponse,
  ConnectedAppsResponse,
} from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

// docs/specs/connected-apps.md — the dashboard's half of connected apps:
// registering apps, approving one for an issuer, and ending approvals.

export const authorizePreview = async (
  token: string,
  params: URLSearchParams,
): Promise<Result<AuthorizePreviewResponse>> =>
  await apiFetch<AuthorizePreviewResponse>(API_BASE_URL, `/oauth/authorize?${params.toString()}`, { token })

export const approveAuthorization = async (
  token: string,
  body: AuthorizeApprovalRequest,
): Promise<Result<AuthorizeApprovalResponse>> =>
  await apiFetch<AuthorizeApprovalResponse>(API_BASE_URL, '/oauth/authorize', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })

export const listConnectedApps = async (token: string): Promise<Result<ConnectedAppsResponse>> =>
  await apiFetch<ConnectedAppsResponse>(API_BASE_URL, '/connected-apps', { token })

export const registerConnectedApp = async (
  token: string,
  body: ConnectedAppRequest,
): Promise<Result<ConnectedAppResponse>> =>
  await apiFetch<ConnectedAppResponse>(API_BASE_URL, '/connected-apps', {
    body: JSON.stringify(body),
    method: 'POST',
    token,
  })

export const deleteConnectedApp = async (
  token: string,
  clientId: string,
): Promise<Result<{ deleted: true }>> =>
  await apiFetch<{ deleted: true }>(API_BASE_URL, `/connected-apps/${encodeURIComponent(clientId)}`, {
    method: 'DELETE',
    token,
  })

export const listGrants = async (token: string): Promise<Result<ConnectedAppGrantsResponse>> =>
  await apiFetch<ConnectedAppGrantsResponse>(API_BASE_URL, '/connected-apps/grants', { token })

export const revokeGrant = async (token: string, id: string): Promise<Result<{ revoked: true }>> =>
  await apiFetch<{ revoked: true }>(API_BASE_URL, `/connected-apps/grants/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    token,
  })
