import type { MemberRowView } from './members-view.ts'

export type RightStatusFilter = 'all' | MemberRowView['status']
export type RightLevelFilter = 'all' | MemberRowView['level']

export interface RightsFilters {
  level: RightLevelFilter
  query: string
  status: RightStatusFilter
}

export const DEFAULT_RIGHTS_FILTERS: RightsFilters = { level: 'all', query: '', status: 'all' }

export const filterRights = (rows: readonly MemberRowView[], filters: RightsFilters): MemberRowView[] => {
  const query = filters.query.trim().toLocaleLowerCase('en-US')
  return rows.filter((row) => {
    const statusMatches = filters.status === 'all' || row.status === filters.status
    const levelMatches = filters.level === 'all' || row.level === filters.level
    const queryMatches =
      query === '' ||
      [row.memberId, row.holder ?? '', row.uid].some((value) =>
        value.toLocaleLowerCase('en-US').includes(query),
      )
    return statusMatches && levelMatches && queryMatches
  })
}

export const hasRightsFilters = (filters: RightsFilters): boolean =>
  filters.query.trim() !== '' || filters.status !== 'all' || filters.level !== 'all'
