import type { ensNames } from './schema.ts'

type ClaimState = Pick<typeof ensNames.$inferSelect, 'status' | 'expiry'>

export const isCurrentlyClaimed = (row: ClaimState | undefined, now: number): boolean =>
  row?.status === 'claimed' && (row.expiry === null || now < row.expiry)
