import type { IssueResponse, IssuerCreateResponse, RevokeResponse } from '@fuda/sdk'

import { commitLogo, createCard, createIssuer, uploadLogo } from './api.ts'
import type { issueRight, listMembers, Result, revokeRight } from './api.ts'
import { cardBodyFrom, createBodyFrom, createFailureOf } from './card-designer.ts'
import type { CreateFailure, DesignerForm, DesignerMode } from './card-designer.ts'
import type { LogoSet } from './logo.ts'

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

// The designer's writes, injectable so the submit path is exercised without a
// network.
export interface DesignIo {
  commitLogo: typeof commitLogo
  createCard: typeof createCard
  createIssuer: typeof createIssuer
  uploadLogo: typeof uploadLogo
}

export const DEFAULT_DESIGN_IO: DesignIo = { commitLogo, createCard, createIssuer, uploadLogo }

export interface LogoFailure {
  ok: false
  session: boolean
}

export type StagedLogo = { ok: true; logoUploadId: string | null } | LogoFailure

// A staged upload is spendable once and expires after 15 minutes, so the picked
// blobs are uploaded on each attempt rather than an id being kept across them.
export const stageLogo = async (io: DesignIo, token: string, logo: LogoSet | null): Promise<StagedLogo> => {
  if (logo === null) {
    return { logoUploadId: null, ok: true }
  }
  const result = await io.uploadLogo(token, logo)
  return result.ok
    ? { logoUploadId: result.body.logoUploadId, ok: true }
    : { ok: false, session: result.status === 401 }
}

// A venue that already exists binds a new mark with the commit route; the
// create body carries the id only when the venue is being created.
export const applyLogo = async (
  io: DesignIo,
  token: string,
  logo: LogoSet,
): Promise<{ ok: true } | LogoFailure> => {
  const staged = await stageLogo(io, token, logo)
  if (!staged.ok) {
    return staged
  }
  if (staged.logoUploadId === null) {
    return { ok: true }
  }
  const committed = await io.commitLogo(token, staged.logoUploadId)
  return committed.ok ? { ok: true } : { ok: false, session: committed.status === 401 }
}

export type CreateOutcome = { ok: true; body: IssuerCreateResponse } | { ok: false; failure: CreateFailure }

const outcomeOf = (result: Result<IssuerCreateResponse>): CreateOutcome =>
  result.ok
    ? { body: result.body, ok: true }
    : { failure: createFailureOf(result.status, result.network, result.error), ok: false }

// The designer's submit. A picked logo is uploaded first, so a new venue is
// created already wearing its mark and an existing one commits the upload
// alongside the new card. A failed upload returns a failure and writes nothing,
// which leaves the operator's form exactly as they left it.
export const submitDesign = async (
  io: DesignIo,
  token: string,
  mode: DesignerMode,
  form: DesignerForm,
  logo: LogoSet | null,
): Promise<CreateOutcome> => {
  const staged = await stageLogo(io, token, logo)
  if (!staged.ok) {
    return { failure: staged.session ? 'session' : 'logo', ok: false }
  }
  const { logoUploadId } = staged
  if (mode === 'card') {
    const body = cardBodyFrom(form)
    if (body === null) {
      return { failure: 'input', ok: false }
    }
    if (logoUploadId !== null) {
      const committed = await io.commitLogo(token, logoUploadId)
      if (!committed.ok) {
        return { failure: committed.status === 401 ? 'session' : 'logo', ok: false }
      }
    }
    return outcomeOf(await io.createCard(token, body))
  }
  const body = createBodyFrom(form, logoUploadId)
  return body === null ? { failure: 'input', ok: false } : outcomeOf(await io.createIssuer(token, body))
}
