import * as v from 'valibot'

import type { Hex } from './constants.ts'
import type { VerifyResponse } from './types.ts'

export const StampSettingsBody = v.object({
  dailyLimit: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(100)),
  enabled: v.boolean(),
  goal: v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(1000)),
})

export type StampSettings = v.InferOutput<typeof StampSettingsBody>

export interface StampSummary extends StampSettings {
  total: number
  today: number
}

export const ReceptionBody = v.object({
  qr: v.pipe(v.string(), v.maxLength(256)),
  requestId: v.pipe(v.string(), v.uuid()),
})

export interface ReceptionResponse extends VerifyResponse {
  uid: Hex
  stamp: {
    status: 'awarded' | 'daily_limit' | 'disabled' | 'not_admitted'
    summary: StampSummary | null
  }
}

// A shop fixes a miscount by a few stamps; a larger correction is several of them.
export const STAMP_ADJUST_MAX = 50
export const STAMP_NOTE_MAX = 200

const StampTarget = {
  qr: v.optional(v.pipe(v.string(), v.maxLength(256))),
  requestId: v.pipe(v.string(), v.uuid()),
  uid: v.optional(v.pipe(v.string(), v.maxLength(66))),
}

const exactlyOneTarget = (body: { qr?: string | undefined; uid?: string | undefined }): boolean =>
  (body.qr === undefined) !== (body.uid === undefined)

export const StampRedeemBody = v.pipe(v.object(StampTarget), v.check(exactlyOneTarget))

export const StampAdjustBody = v.pipe(
  v.object({
    ...StampTarget,
    delta: v.pipe(
      v.number(),
      v.integer(),
      v.minValue(-STAMP_ADJUST_MAX),
      v.maxValue(STAMP_ADJUST_MAX),
      v.notValue(0),
    ),
    note: v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(STAMP_NOTE_MAX)),
  }),
  v.check(exactlyOneTarget),
)

export type StampRedeemInput = v.InferInput<typeof StampRedeemBody>
export type StampAdjustInput = v.InferInput<typeof StampAdjustBody>

export interface StampLedgerEntry {
  kind: 'adjust' | 'redeem'
  delta: number
  note: string
  at: number
}

export interface StampLedger {
  entries: StampLedgerEntry[]
  summary: StampSummary
}

export interface StampActionResponse extends StampLedger {
  entry: StampLedgerEntry
}
