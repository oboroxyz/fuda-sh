import type { IssuerUpdateRequest } from '@fuda/sdk'

import { checkCardSlug, checkHandle, updateIssuer } from './api.ts'
import type { Result } from './api.ts'
import { applyLogo, DEFAULT_DESIGN_IO } from './design-actions.ts'
import type { LogoSet } from './logo.ts'

export type NameCheckOutcome = 'available' | 'taken' | 'unknown'

const nameCheck = async (
  check: () => Promise<Result<{ available: boolean }>>,
  onUnauthorized: () => void,
): Promise<NameCheckOutcome> => {
  let result: Result<{ available: boolean }>
  try {
    result = await check()
  } catch {
    return 'unknown'
  }
  if (!result.ok) {
    if (result.status === 401) {
      onUnauthorized()
    }
    return 'unknown'
  }
  return result.body.available ? 'available' : 'taken'
}

export const handleCheck =
  (onUnauthorized: () => void) =>
  async (handle: string): Promise<NameCheckOutcome> =>
    await nameCheck(async () => await checkHandle(handle), onUnauthorized)

export const slugCheck =
  (onUnauthorized: () => void) =>
  async (slug: string): Promise<NameCheckOutcome> =>
    await nameCheck(async () => await checkCardSlug(slug), onUnauthorized)

// The published profile's two writes. Each answers whether it saved; the page
// then re-reads the venue from the server, which is the only copy.
export const commitVenueLogo = async (variants: LogoSet, onUnauthorized: () => void): Promise<boolean> => {
  const outcome = await applyLogo(DEFAULT_DESIGN_IO, variants).catch(() => ({
    ok: false as const,
    session: false,
  }))
  if (!outcome.ok && outcome.session) {
    onUnauthorized()
  }
  return outcome.ok
}

export const saveVenue = async (body: IssuerUpdateRequest, onUnauthorized: () => void): Promise<boolean> => {
  const result = await updateIssuer(body).catch(() => null)
  if (result === null) {
    return false
  }
  if (!result.ok && result.status === 401) {
    onUnauthorized()
  }
  return result.ok
}
