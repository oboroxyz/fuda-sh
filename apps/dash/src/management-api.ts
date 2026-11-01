import type { CardUpdateRequest, IssuerPassesResponse, IssuerPassStatus, OperatorCardView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'

import { API_BASE_URL } from './config.ts'
import { apiFetch } from './session-request.ts'

export interface PassQuery {
  page: number
  pageSize: number
  q?: string
  cardId?: string
  status?: IssuerPassStatus
}

export const readOperatorCard = async (cardId: string): Promise<Result<{ card: OperatorCardView }>> =>
  await apiFetch(API_BASE_URL, `/issuers/me/cards/${encodeURIComponent(cardId)}`)

export const updateOperatorCard = async (
  cardId: string,
  body: CardUpdateRequest,
): Promise<Result<{ card: OperatorCardView }>> =>
  await apiFetch(API_BASE_URL, `/issuers/me/cards/${encodeURIComponent(cardId)}`, {
    body: JSON.stringify(body),
    method: 'PUT',
  })

export const listIssuerPasses = async (query: PassQuery): Promise<Result<IssuerPassesResponse>> => {
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
  return await apiFetch(API_BASE_URL, `/issuers/me/passes?${params}`)
}
