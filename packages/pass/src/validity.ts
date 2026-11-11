import type { IssuerPassStatus } from '@fuda/sdk'

export interface PassValidity {
  status: IssuerPassStatus
  validFrom: number | null
  validUntil: number | null
}

export const passDate = (seconds: number | null): string | undefined =>
  seconds === null || seconds === 0 ? undefined : new Date(seconds * 1000).toISOString()
