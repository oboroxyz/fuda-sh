import { IssuerCreateBody, normalizeBrandColor } from '@fuda/sdk'
import type { IssuerCreateRequest } from '@fuda/sdk'
import * as v from 'valibot'

export interface VenueForm {
  brandColor: string
  handle: string
  name: string
  tagline: string
}

export const EMPTY_VENUE_FORM: VenueForm = {
  brandColor: '#6F4320',
  handle: '',
  name: '',
  tagline: '',
}

export const venueBodyFrom = (
  form: VenueForm,
  logoUploadId: string | null = null,
): IssuerCreateRequest | null => {
  const brandColor = normalizeBrandColor(form.brandColor)
  if (brandColor === null) {
    return null
  }
  const parsed = v.safeParse(IssuerCreateBody, { ...form, brandColor, logoUploadId })
  return parsed.success ? parsed.output : null
}
