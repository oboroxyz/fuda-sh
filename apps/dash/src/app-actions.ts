import type { IssueResponse, RevokeResponse } from '@fuda/sdk'

import type { issueRight, listMembers, Result, revokeRight } from './api.ts'

export interface DashIo {
  issueRight: typeof issueRight
  listMembers: typeof listMembers
  revokeRight: typeof revokeRight
}

export interface ActionContext {
  io: DashIo
  onUnauthorized: () => void
  reload: (token: string) => Promise<void>
  token: string
}

export const issueAndReload = async (
  context: ActionContext,
  body: Record<string, string | number>,
): Promise<Result<IssueResponse>> => {
  const result = await context.io.issueRight(context.token, body)
  if (!result.ok) {
    if (result.status === 401) {
      context.onUnauthorized()
    }
    return result
  }
  await context.reload(context.token)
  return result
}

export const revokeAndReload = async (
  context: ActionContext,
  uid: string,
): Promise<Result<RevokeResponse>> => {
  const result = await context.io.revokeRight(context.token, uid)
  if (!result.ok) {
    if (result.status === 401) {
      context.onUnauthorized()
    }
    return result
  }
  await context.reload(context.token)
  return result
}
