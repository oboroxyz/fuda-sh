import type { CardView, IssuerPassesResponse } from '@fuda/sdk'

export const membershipCard: CardView = {
  category: 'membership',
  claimFrom: null,
  claimUntil: null,
  claimable: true,
  description: 'Coffee and community.',
  id: 'card-1',
  slug: 'membership',
  title: 'Coffee membership',
  validFrom: null,
  validUntil: null,
  validityDays: null,
}
export const ticketCard: CardView = {
  ...membershipCard,
  category: 'ticket',
  id: 'card-2',
  slug: 'summer',
  title: 'Summer event',
  validityDays: 30,
}
export const passesResponse: IssuerPassesResponse = {
  cardStats: [
    { active: 30, cardId: 'card-1', issued: 40, unknown: 3 },
    { active: 1, cardId: 'card-2', issued: 3, unknown: 0 },
  ],
  page: { number: 1, size: 25, total: 43 },
  passes: [
    {
      card: { category: 'membership', id: 'card-1', slug: 'membership', title: 'Coffee membership' },
      claimedAt: 1_780_000_000,
      holder: `0x${'12'.repeat(20)}`,
      memberNumber: 'ABCDEFGHJKLM',
      stamps: 3,
      status: 'active',
      uid: `0x${'ab'.repeat(32)}`,
      validFrom: 0,
      validUntil: 0,
    },
  ],
  summary: { active: 31, claimedLast30Days: 7, stamps: 108, total: 43, unknown: 3 },
}
