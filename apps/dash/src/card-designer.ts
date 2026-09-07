import { issuerHandleProblem, IssuerCreateBody, normalizeBrandColor } from '@fuda/sdk'
import type { CardCategory, IssuerCreateRequest } from '@fuda/sdk'
import * as v from 'valibot'

// The four presets the designer offers; any `#RRGGBB` may be typed instead.
export const BRAND_SWATCHES = ['#6F4320', '#1F513F', '#1D3A6E', '#7A1F2B'] as const

// Expiry is a product choice, not a date picker: none, or a number of days
// from issuance, which the api turns into the Entitlement's validUntil.
export const EXPIRY_CHOICES = [null, 30, 90, 365] as const
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]

export interface DesignerForm {
  brandColor: string
  category: CardCategory
  handle: string
  lockScreen: boolean
  name: string
  perk: string
  reward: string
  tagline: string
  title: string
  validityDays: ExpiryChoice
  venue: { lat: number; lng: number } | null
}

export const EMPTY_FORM: DesignerForm = {
  brandColor: '#6F4320',
  category: 'membership',
  handle: '',
  lockScreen: false,
  name: '',
  perk: '',
  reward: '',
  tagline: '',
  title: 'Membership Card',
  validityDays: null,
  venue: null,
}

// What the operator's typing means for the handle, before the api is asked.
export type HandleStatus = 'available' | 'checking' | 'format' | 'idle' | 'reserved' | 'taken' | 'unknown'

export const handleStatusOf = (handle: string): HandleStatus => {
  const problem = issuerHandleProblem(handle)
  if (problem === 'empty') {
    return 'idle'
  }
  if (problem === 'format') {
    return 'format'
  }
  return problem === 'reserved' ? 'reserved' : 'checking'
}

// The request body, or null when the form is not yet a valid one. The api
// validates the same schema, so a disabled submit and a 400 agree.
export const createBodyFrom = (form: DesignerForm): IssuerCreateRequest | null => {
  const brandColor = normalizeBrandColor(form.brandColor)
  if (brandColor === null) {
    return null
  }
  const venue = form.lockScreen && form.venue !== null ? { venue: form.venue } : {}
  const parsed = v.safeParse(IssuerCreateBody, {
    brandColor,
    card: {
      category: form.category,
      lockScreen: form.lockScreen && form.venue !== null,
      perk: form.perk,
      reward: form.reward,
      title: form.title,
      validityDays: form.validityDays,
      ...venue,
    },
    handle: form.handle,
    name: form.name,
    tagline: form.tagline,
  })
  return parsed.success ? parsed.output : null
}

export const canSubmit = (form: DesignerForm, status: HandleStatus, busy: boolean): boolean =>
  !busy && status !== 'taken' && status !== 'format' && status !== 'reserved' && createBodyFrom(form) !== null

// Why a create failed, in the terms the form explains it.
export type CreateFailure = 'input' | 'network' | 'session' | 'taken'

export const createFailureOf = (status: number, network: boolean, error: string): CreateFailure => {
  if (network) {
    return 'network'
  }
  if (status === 401) {
    return 'session'
  }
  if (status === 409) {
    return error === 'issuer_exists' ? 'input' : 'taken'
  }
  return status === 400 ? 'input' : 'network'
}

// The link as a poster or a message shows it: no scheme, no trailing slash.
export const displayUrl = (publicUrl: string): string =>
  publicUrl.replace(/^https?:\/\//u, '').replace(/\/$/u, '')
