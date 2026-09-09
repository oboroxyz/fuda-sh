import { IssuerCreateBody, IssuerUpdateBody, normalizeBrandColor } from '@fuda/sdk'
import type { IssuerCreateRequest, IssuerUpdateRequest } from '@fuda/sdk'
import * as v from 'valibot'

import { DEFAULT_BRAND_COLOR } from './brand-colors.ts'

export interface VenueForm {
  brandColor: string
  handle: string
  name: string
  tagline: string
}

export const EMPTY_VENUE_FORM: VenueForm = {
  brandColor: DEFAULT_BRAND_COLOR,
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

export const venueUpdateBodyFrom = (form: IssuerUpdateRequest): IssuerUpdateRequest | null => {
  const parsed = v.safeParse(IssuerUpdateBody, form)
  return parsed.success ? parsed.output : null
}
