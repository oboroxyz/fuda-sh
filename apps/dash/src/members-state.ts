import type { MemberRowView } from './members-view.ts'

// The page's loader answers once: the rows, or why it could not read them.
export type MembersState<Row extends MemberRowView = MemberRowView> =
  | { kind: 'ready'; rows: readonly Row[] }
  | { kind: 'error'; message: string }

export interface MemberCounts {
  active: number
  revoked: number
  total: number
}

export const countMembers = (rows: readonly Pick<MemberRowView, 'status'>[]): MemberCounts => {
  let active = 0
  let revoked = 0
  for (const row of rows) {
    if (row.status === 'active') {
      active += 1
    } else if (row.status === 'revoked') {
      revoked += 1
    }
  }
  return { active, revoked, total: rows.length }
}

export const graphIsConfigured = (endpoint: string): boolean => endpoint.trim() !== ''
