import type { CardUpdateRequest, IssuerPassesResponse, IssuerPassStatus, OperatorCardView } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'

export interface PassQuery {
  page: number
  pageSize: number
  q?: string
  cardId?: string
  status?: IssuerPassStatus
}

export const readOperatorCard = async (
  token: string,
  cardId: string,
): Promise<Result<{ card: OperatorCardView }>> =>
  await apiFetch(API_BASE_URL, `/issuers/me/cards/${encodeURIComponent(cardId)}`, { token })

export const updateOperatorCard = async (
  token: string,
  cardId: string,
  body: CardUpdateRequest,
): Promise<Result<{ card: OperatorCardView }>> =>
  await apiFetch(API_BASE_URL, `/issuers/me/cards/${encodeURIComponent(cardId)}`, {
    body: JSON.stringify(body),
    method: 'PUT',
    token,
  })

export const listIssuerPasses = async (
  token: string,
  query: PassQuery,
): Promise<Result<IssuerPassesResponse>> => {
  const params = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize) })
  if (query.q !== undefined && query.q !== '') {
    params.set('q', query.q)
  }
  if (query.cardId !== undefined && query.cardId !== '') {
    params.set('cardId', query.cardId)
  }
  if (query.status !== undefined) {
    params.set('status', query.status)
  }
  return await apiFetch(API_BASE_URL, `/issuers/me/passes?${params}`, { token })
}
