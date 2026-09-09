import type { CardView } from '@fuda/sdk'

import { claimStateOf, formatInstant, validityStateOf } from './card-designer.ts'
import type { DashCopy } from './copy.ts'

const instantOrEmpty = (seconds: number | null): string => (seconds === null ? '' : formatInstant(seconds))

export const cardClaimText = (copy: DashCopy['published'], card: CardView, now: number): string => {
  const state = claimStateOf(card, now)
  const key = state === 'closed' && card.claimUntil !== null ? 'closedSince' : state
  return copy.claimStates[key]
    .replace('{from}', instantOrEmpty(card.claimFrom))
    .replace('{until}', instantOrEmpty(card.claimUntil))
}

export const cardValidityText = (copy: DashCopy['published'], card: CardView): string =>
  copy.validityStates[validityStateOf(card)]
    .replace('{days}', String(card.validityDays))
    .replace('{from}', instantOrEmpty(card.validFrom))
    .replace('{until}', instantOrEmpty(card.validUntil))
