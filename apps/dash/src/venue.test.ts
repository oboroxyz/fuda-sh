import { describe, expect, it } from 'vitest'

import { EMPTY_VENUE_FORM, venueBodyFrom } from './venue.ts'

describe(venueBodyFrom, () => {
  it('creates a venue request without card fields', () => {
    expect(
      venueBodyFrom({
        ...EMPTY_VENUE_FORM,
        handle: 'wassie-coffee',
        name: 'Wassie Coffee',
        tagline: 'Omotesando',
      }),
    ).toStrictEqual({
      brandColor: '#0073EB',
      handle: 'wassie-coffee',
      logoUploadId: null,
      name: 'Wassie Coffee',
      tagline: 'Omotesando',
    })
  })

  it('rejects an invalid venue without depending on card validity', () => {
    expect(venueBodyFrom({ ...EMPTY_VENUE_FORM, handle: 'Bad Handle', name: 'Venue' })).toBeNull()
    expect(venueBodyFrom({ ...EMPTY_VENUE_FORM, handle: 'ab--cd', name: 'Venue' })).toBeNull()
  })
})
