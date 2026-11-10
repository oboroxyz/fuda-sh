import type { CardCreateResponse, IssuerCreateResponse, IssuerView } from '@fuda/sdk'

import { commitLogo, createCard, createIssuer, uploadLogo } from './api.ts'
import type { Result } from './api.ts'
import { cardBodyFrom, createFailureOf } from './card-designer.ts'
import type { CreateFailure, DesignerForm } from './card-designer.ts'
import type { LogoSet } from './logo.ts'
import { venueBodyFrom } from './venue.ts'
import type { VenueForm } from './venue.ts'

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

// A venue that already exists binds a new mark with the commit route; the
// create body carries the id only when the venue is being created.
// The commit answers the updated issuer, whose `logoUrl` carries the new
// version. Handing it back lets the screen show the fresh mark without
// guessing at a cache-busting value of its own.
export const applyLogo = async (
  io: DesignIo,
  logo: LogoSet,
): Promise<{ ok: true; issuer: IssuerView } | LogoFailure> => {
  const staged = await io.uploadLogo(logo)
  if (!staged.ok) {
    return { ok: false, session: staged.status === 401 }
  }
  const committed = await io.commitLogo(staged.body.logoUploadId)
  if (!committed.ok) {
    return { ok: false, session: committed.status === 401 }
  }
  return { issuer: committed.body.issuer, ok: true }
}

export type VenueCreateOutcome =
  | { ok: true; body: IssuerCreateResponse }
  | { ok: false; failure: CreateFailure }
export type CardCreateOutcome = { ok: true; body: CardCreateResponse } | { ok: false; failure: CreateFailure }

const outcomeOf = <T>(result: Result<T>): { ok: true; body: T } | { ok: false; failure: CreateFailure } =>
  result.ok
    ? { body: result.body, ok: true }
    : { failure: createFailureOf(result.status, result.network, result.error), ok: false }

export const submitVenue = async (io: DesignIo, form: VenueForm): Promise<VenueCreateOutcome> => {
  const body = venueBodyFrom(form)
  return body === null ? { failure: 'input', ok: false } : outcomeOf(await io.createIssuer(body))
}

export const submitCard = async (io: DesignIo, form: DesignerForm): Promise<CardCreateOutcome> => {
  const body = cardBodyFrom(form)
  return body === null ? { failure: 'input', ok: false } : outcomeOf(await io.createCard(body))
}
