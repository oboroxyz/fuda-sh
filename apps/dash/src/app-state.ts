import type { MembersState } from './members-state.ts'

export interface SessionState {
  authError: 'unauthorized' | null
  members: MembersState
  token: string | null
}

export const unauthorizedSession = (_state: SessionState): SessionState => ({
  authError: 'unauthorized',
  members: { kind: 'idle' },
  token: null,
})
