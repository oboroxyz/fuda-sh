import {
  CardBody,
  cardSlugProblem,
  issuerHandleProblem,
  IssuerCreateBody,
  normalizeBrandColor,
  slugFromTitle,
} from '@fuda/sdk'
import type { CardCategory, CardRequest, IssuerCreateRequest } from '@fuda/sdk'
import * as v from 'valibot'

// The four presets the designer offers; any `#RRGGBB` may be typed instead.
export const BRAND_SWATCHES = ['#6F4320', '#1F513F', '#1D3A6E', '#7A1F2B'] as const

// Expiry is a product choice, not a date picker: none, or a number of days
// from issuance, which the api turns into the Entitlement's validUntil.
export const EXPIRY_CHOICES = [null, 30, 90, 365] as const
export type ExpiryChoice = (typeof EXPIRY_CHOICES)[number]

// The designer collects the venue and its first card together, or one more
// card for a venue that already exists. Only the submitted body differs.
export type DesignerMode = 'card' | 'venue'

export interface DesignerForm {
  brandColor: string
  category: CardCategory
  handle: string
  lockScreen: boolean
  name: string
  perk: string
  reward: string
  slug: string
  // True once the operator typed a slug themselves; the title stops driving it.
  slugEdited: boolean
  tagline: string
  title: string
  validityDays: ExpiryChoice
  venue: { lat: number; lng: number } | null
}

const DEFAULT_TITLE = 'Membership Card'

export const EMPTY_FORM: DesignerForm = {
  brandColor: '#6F4320',
  category: 'membership',
  handle: '',
  lockScreen: false,
  name: '',
  perk: '',
  reward: '',
  slug: slugFromTitle(DEFAULT_TITLE),
  slugEdited: false,
  tagline: '',
  title: DEFAULT_TITLE,
  validityDays: null,
  venue: null,
}

// The card link follows the title until the operator takes it over, so most
// venues never type a slug; a title with no usable ASCII leaves it empty and
// the field then asks for one.
export const withTitle = (form: DesignerForm, title: string): DesignerForm => ({
  ...form,
  slug: form.slugEdited ? form.slug : slugFromTitle(title),
  title,
})

export const withSlug = (form: DesignerForm, slug: string): DesignerForm => ({
  ...form,
  slug,
  slugEdited: true,
})

// What the operator's typing means for a name, before the api is asked.
export type FieldStatus = 'available' | 'checking' | 'format' | 'idle' | 'reserved' | 'taken' | 'unknown'

export interface DesignerStatus {
  handle: FieldStatus
  slug: FieldStatus
}

const statusOf = (problem: 'empty' | 'format' | 'reserved' | null): FieldStatus => {
  if (problem === 'empty') {
    return 'idle'
  }
  if (problem === 'format') {
    return 'format'
  }
  return problem === 'reserved' ? 'reserved' : 'checking'
}

export const handleStatusOf = (handle: string): FieldStatus => statusOf(issuerHandleProblem(handle))

export const slugStatusOf = (slug: string): FieldStatus => statusOf(cardSlugProblem(slug))

// One card's request body, or null while the form is not yet a valid one.
export const cardBodyFrom = (form: DesignerForm): CardRequest | null => {
  const venue = form.lockScreen && form.venue !== null ? { venue: form.venue } : {}
  const parsed = v.safeParse(CardBody, {
    category: form.category,
    lockScreen: form.lockScreen && form.venue !== null,
    perk: form.perk,
    reward: form.reward,
    slug: form.slug,
    title: form.title,
    validityDays: form.validityDays,
    ...venue,
  })
  return parsed.success ? parsed.output : null
}

// The venue-and-first-card body. The api validates the same schema, so a
// disabled submit and a 400 agree.
export const createBodyFrom = (form: DesignerForm): IssuerCreateRequest | null => {
  const brandColor = normalizeBrandColor(form.brandColor)
  const card = cardBodyFrom(form)
  if (brandColor === null || card === null) {
    return null
  }
  const parsed = v.safeParse(IssuerCreateBody, {
    brandColor,
    card,
    handle: form.handle,
    name: form.name,
    tagline: form.tagline,
  })
  return parsed.success ? parsed.output : null
}

const blocks = (status: FieldStatus): boolean =>
  status === 'format' || status === 'reserved' || status === 'taken'

export const canSubmit = (
  mode: DesignerMode,
  form: DesignerForm,
  status: DesignerStatus,
  busy: boolean,
): boolean => {
  if (busy || blocks(status.slug)) {
    return false
  }
  if (mode === 'card') {
    return cardBodyFrom(form) !== null
  }
  return !blocks(status.handle) && createBodyFrom(form) !== null
}

// Why a create failed, in the terms the form explains it.
export type CreateFailure = 'input' | 'network' | 'session' | 'slugInvalid' | 'slugTaken' | 'taken'

export const createFailureOf = (status: number, network: boolean, error: string): CreateFailure => {
  if (network) {
    return 'network'
  }
  if (status === 401) {
    return 'session'
  }
  if (status === 409) {
    if (error === 'issuer_exists') {
      return 'input'
    }
    return error === 'slug_taken' ? 'slugTaken' : 'taken'
  }
  if (status === 400) {
    return error === 'bad_slug' ? 'slugInvalid' : 'input'
  }
  return 'network'
}

// The link as a poster or a message shows it: no scheme, no trailing slash.
export const displayUrl = (publicUrl: string): string =>
  publicUrl.replace(/^https?:\/\//u, '').replace(/\/$/u, '')

// One card's own link under the venue page.
export const cardUrl = (publicUrl: string, slug: string): string => `${publicUrl.replace(/\/$/u, '')}/${slug}`
