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
