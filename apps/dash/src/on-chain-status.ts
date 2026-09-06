import { fetchAttendancesByRight, fetchDelegationsByIssuer, fetchRightsByHolder } from '@fuda/sdk'
import type { GraphAttendance, GraphDelegation, GraphRight, Hex } from '@fuda/sdk'

export interface OnChainStatusData {
  attendances: Record<string, GraphAttendance[]>
  delegations: GraphDelegation[]
  rights: GraphRight[]
}

export interface OnChainStatusIo {
  attendancesByRight: (endpoint: string, right: Hex) => Promise<GraphAttendance[]>
  delegationsByIssuer: (endpoint: string, issuer: string) => Promise<GraphDelegation[]>
  rightsByHolder: (endpoint: string, holder: string) => Promise<GraphRight[]>
}

export const graphOnChainStatusIo: OnChainStatusIo = {
  attendancesByRight: fetchAttendancesByRight,
  delegationsByIssuer: fetchDelegationsByIssuer,
  rightsByHolder: fetchRightsByHolder,
}

export const loadOnChainStatus = async (
  io: OnChainStatusIo,
  endpoint: string,
  holder: string,
): Promise<OnChainStatusData> => {
  const rights = await io.rightsByHolder(endpoint, holder)
  const issuers = [...new Set(rights.map(({ issuer }) => issuer))]
  const [attendanceLists, delegationLists] = await Promise.all([
    Promise.all(rights.map(async ({ id }) => await io.attendancesByRight(endpoint, id))),
    Promise.all(issuers.map(async (issuer) => await io.delegationsByIssuer(endpoint, issuer))),
  ])
  return {
    attendances: Object.fromEntries(rights.map(({ id }, index) => [id, attendanceLists[index] ?? []])),
    delegations: delegationLists.flat(),
    rights,
  }
}
