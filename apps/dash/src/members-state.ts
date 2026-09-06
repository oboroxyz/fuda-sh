import type { MemberRowView } from './members-view.ts'

export type MembersState<Row extends MemberRowView = MemberRowView> =
  | { kind: 'idle' }
  | { kind: 'loading'; previousRows: readonly Row[] | null }
  | { kind: 'ready'; rows: readonly Row[] }
  | { kind: 'error'; message: string; previousRows: readonly Row[] | null }

export interface MemberCounts {
  active: number
  revoked: number
  total: number
}

export interface MemberSnapshot<Row extends MemberRowView = MemberRowView> {
  refreshing: boolean
  rows: readonly Row[]
  stale: boolean
}

export type ApiConnectionStatus = 'checking' | 'connected' | 'unavailable'

const retainedRows = <Row extends MemberRowView>(state: MembersState<Row>): readonly Row[] | null => {
  if (state.kind === 'ready') {
    return state.rows
  }
  if (state.kind === 'loading' || state.kind === 'error') {
    return state.previousRows
  }
  return null
}

export const beginMembersLoad = <Row extends MemberRowView>(state: MembersState<Row>): MembersState<Row> => ({
  kind: 'loading',
  previousRows: retainedRows(state),
})

export const completeMembersLoad = <Row extends MemberRowView>(rows: readonly Row[]): MembersState<Row> => ({
  kind: 'ready',
  rows,
})

export const failMembersLoad = <Row extends MemberRowView>(
  state: MembersState<Row>,
  message: string,
): MembersState<Row> => ({
  kind: 'error',
  message,
  previousRows: retainedRows(state),
})

export const memberSnapshot = <Row extends MemberRowView>(
  state: MembersState<Row>,
): MemberSnapshot<Row> | null => {
  if (state.kind === 'ready') {
    return { refreshing: false, rows: state.rows, stale: false }
  }
  if (state.kind === 'loading' && state.previousRows !== null) {
    return { refreshing: true, rows: state.previousRows, stale: false }
  }
  if (state.kind === 'error' && state.previousRows !== null) {
    return { refreshing: false, rows: state.previousRows, stale: true }
  }
  return null
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

export const apiConnectionStatus = (state: MembersState): ApiConnectionStatus => {
  if (state.kind === 'ready') {
    return 'connected'
  }
  if (state.kind === 'error') {
    return 'unavailable'
  }
  return 'checking'
}

export const graphIsConfigured = (endpoint: string): boolean => endpoint.trim() !== ''
