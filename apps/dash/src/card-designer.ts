import {
  CardBody,
  cardSlugProblem,
  hasSingleValidityRule,
  isClaimable,
  issuerHandleProblem,
  IssuerCreateBody,
  isOrderedWindow,
  normalizeBrandColor,
  slugFromTitle,
} from '@fuda/sdk'
import type {
  CardCategory,
  CardRequest,
  CardValidity,
  CardView,
  ClaimWindow,
  IssuerCreateRequest,
} from '@fuda/sdk'
import * as v from 'valibot'

// The four presets the designer offers; any `#RRGGBB` may be typed instead.
export const BRAND_SWATCHES = ['#6F4320', '#1F513F', '#1D3A6E', '#7A1F2B'] as const

// The relative rule is a product choice, not a date picker: a number of days
// counted from the moment each member claims the card.
export const EXPIRY_DAY_CHOICES = [30, 90, 365] as const
export type ExpiryChoice = (typeof EXPIRY_DAY_CHOICES)[number] | null

// How long the issued right lasts: never, N days from each claim, or between
// two fixed instants. Exactly one rule reaches the api.
export type ValidityMode = 'days' | 'fixed' | 'none'

// `datetime-local` carries no timezone, so its text is read and written through
// the local `Date`: what the operator sees is the venue's own wall clock, and
// the unix seconds the api stores are that instant.
const MS_PER_SECOND = 1000

const pad = (value: number): string => String(value).padStart(2, '0')

// '' (or an unparseable draft, which a half-typed field produces) means the end
// is unbounded, not that it is zero.
export const unixFromLocal = (local: string): number | null => {
  if (local === '') {
    return null
  }
  const ms = new Date(local).getTime()
  return Number.isNaN(ms) ? null : Math.floor(ms / MS_PER_SECOND)
}

// The inverse, to the minute `datetime-local` shows; seconds are dropped.
export const localFromUnix = (seconds: number | null): string => {
  if (seconds === null) {
    return ''
  }
  const at = new Date(seconds * MS_PER_SECOND)
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

// One instant as the published screen prints it: the same wall clock, no `T`.
export const formatInstant = (seconds: number): string => localFromUnix(seconds).replace('T', ' ')

// The designer collects the venue and its first card together, or one more
// card for a venue that already exists. Only the submitted body differs.
export type DesignerMode = 'card' | 'venue'

export interface DesignerForm {
  brandColor: string
  category: CardCategory
  // The four window fields hold `datetime-local` text; '' means unbounded.
  claimFrom: string
  claimUntil: string
  // True once the operator gave the claim end its own value; a ticket's
  // validity end stops filling it in.
  claimUntilEdited: boolean
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
  validFrom: string
  validUntil: string
  validityDays: ExpiryChoice
  validityMode: ValidityMode
  venue: { lat: number; lng: number } | null
  // True once the operator touched any window field; the card type stops
  // applying its defaults, the same way `slugEdited` frees the slug.
  windowEdited: boolean
}

const DEFAULT_TITLE = 'Membership Card'
const DEFAULT_DAYS = 30

// What each card type means before the operator says otherwise: a membership
// is handed out forever and does not expire; a ticket is for one occasion, so
// it carries fixed instants and stops being handed out when they pass.
type CategoryWindows = Pick<
  DesignerForm,
  'claimFrom' | 'claimUntil' | 'validFrom' | 'validUntil' | 'validityDays' | 'validityMode'
>

const CATEGORY_WINDOWS = {
  membership: {
    claimFrom: '',
    claimUntil: '',
    validFrom: '',
    validUntil: '',
    validityDays: null,
    validityMode: 'none',
  },
  ticket: {
    claimFrom: '',
    claimUntil: '',
    validFrom: '',
    validUntil: '',
    validityDays: null,
    validityMode: 'fixed',
  },
} satisfies Record<CardCategory, CategoryWindows>

export const EMPTY_FORM: DesignerForm = {
  brandColor: '#6F4320',
  category: 'membership',
  claimFrom: '',
  claimUntil: '',
  claimUntilEdited: false,
  handle: '',
  lockScreen: false,
  name: '',
  perk: '',
  reward: '',
  slug: slugFromTitle(DEFAULT_TITLE),
  slugEdited: false,
  tagline: '',
  title: DEFAULT_TITLE,
  validFrom: '',
  validUntil: '',
  validityDays: null,
  validityMode: 'none',
  venue: null,
  windowEdited: false,
}

// Switching the card type carries its defaults in, until the operator has set
// a window by hand; after that the type never overwrites the operator.
export const withCategory = (form: DesignerForm, category: CardCategory): DesignerForm =>
  form.windowEdited ? { ...form, category } : { ...form, ...CATEGORY_WINDOWS[category], category }

// The three modes are exclusive, so choosing one clears the other's fields and
// the submitted body can never carry two rules.
export const withValidityMode = (form: DesignerForm, validityMode: ValidityMode): DesignerForm => ({
  ...form,
  validFrom: validityMode === 'fixed' ? form.validFrom : '',
  validUntil: validityMode === 'fixed' ? form.validUntil : '',
  validityDays: validityMode === 'days' ? (form.validityDays ?? DEFAULT_DAYS) : null,
  validityMode,
  windowEdited: true,
})

export type WindowField = 'claimFrom' | 'claimUntil' | 'validFrom' | 'validUntil'

// A ticket's doors close when the event ends, so its validity end fills the
// claim end in — until the operator gives that field a value of its own.
export const withWindow = (form: DesignerForm, field: WindowField, value: string): DesignerForm => {
  const next: DesignerForm = {
    ...form,
    claimUntilEdited: form.claimUntilEdited || field === 'claimUntil',
    windowEdited: true,
  }
  next[field] = value
  if (field === 'validUntil' && form.category === 'ticket' && !form.claimUntilEdited) {
    next.claimUntil = value
  }
  return next
}

export const withValidityDays = (form: DesignerForm, validityDays: ExpiryChoice): DesignerForm => ({
  ...form,
  validityDays,
  windowEdited: true,
})

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

// The two windows as the api reads them: unix seconds, or null for unbounded.
export const windowsOf = (form: DesignerForm): CardValidity & ClaimWindow => ({
  claimFrom: unixFromLocal(form.claimFrom),
  claimUntil: unixFromLocal(form.claimUntil),
  validFrom: unixFromLocal(form.validFrom),
  validUntil: unixFromLocal(form.validUntil),
  validityDays: form.validityDays,
})

// What the schema would reject, in the terms the form explains it. The sdk
// predicates decide, so a disabled submit and a 400 always agree.
export type WindowProblem = 'bothRules' | 'claimOrder' | 'validOrder'

export const windowProblemOf = (form: DesignerForm): WindowProblem | null => {
  const windows = windowsOf(form)
  if (!hasSingleValidityRule(windows)) {
    return 'bothRules'
  }
  if (!isOrderedWindow(windows.claimFrom, windows.claimUntil)) {
    return 'claimOrder'
  }
  return isOrderedWindow(windows.validFrom, windows.validUntil) ? null : 'validOrder'
}

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
    ...windowsOf(form),
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
  if (windowProblemOf(form) !== null) {
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

// How a published card reads to a member right now. `claimable` is the api's
// answer against its own clock and is never second-guessed here; the local
// clock only picks the wording between "not open yet" and "closed".
export type ClaimState = 'closed' | 'notYet' | 'open' | 'openUntil'

export const claimStateOf = (card: CardView, now: number): ClaimState => {
  if (!card.claimable) {
    return isClaimable({ claimFrom: card.claimFrom, claimUntil: null }, now) ? 'closed' : 'notYet'
  }
  return card.claimUntil === null ? 'open' : 'openUntil'
}

// Which of the validity rules a published card carries.
export type ValidityState = 'days' | 'fixed' | 'from' | 'never' | 'until'

export const validityStateOf = (card: CardValidity): ValidityState => {
  if (card.validityDays !== null) {
    return 'days'
  }
  if (card.validFrom !== null) {
    return card.validUntil === null ? 'from' : 'fixed'
  }
  return card.validUntil === null ? 'never' : 'until'
}
