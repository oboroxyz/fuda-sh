import type { BadgeView } from '@fuda/sdk'

// The one fact an operator surface shows about a Badge: whether this Right
// carries a `human` one. Asked of the Badge list rather than read off the wire
// as a flag, so a second kind arrives without a protocol change.
export const hasHumanBadge = (badges: readonly BadgeView[] | undefined): boolean =>
  badges?.some((badge) => badge.kind === 'human') ?? false
