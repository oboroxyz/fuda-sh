import type { IssuerMeResponse } from '@fuda/sdk'

import type { MembersState } from './members-state.ts'

export interface SessionState {
  authError: 'unauthorized' | null
  members: MembersState
  // The bearer credential for every api call: the admin token when `operator`
  // is null, otherwise the passkey session token from POST /auth/verify.
  token: string | null
  // Non-null only for a passkey session; it carries the venue's own card.
  operator: IssuerMeResponse | null
}

export const signedOutSession = (): SessionState => ({
  authError: null,
  members: { kind: 'idle' },
  operator: null,
  token: null,
})

export const unauthorizedSession = (_state: SessionState): SessionState => ({
  ...signedOutSession(),
  authError: 'unauthorized',
})

export const hasIssuer = (session: SessionState): boolean =>
  session.operator !== null && session.operator.issuer !== null
