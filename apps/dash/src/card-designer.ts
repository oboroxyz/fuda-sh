import {
  CardBody,
  CardUpdateBody,
  cardSlugProblem,
  defaultAttendance,
  hasSingleValidityRule,
  isClaimable,
  issuerHandleProblem,
  isOrderedWindow,
  slugFromTitle,
} from '@fuda/sdk'
import type {
  CardCategory,
  CardIdentity,
  CardRecord,
  CardRequest,
  CardUpdateRequest,
  CardValidity,
  CardView,
  ClaimWindow,
  OperatorCardView,
} from '@fuda/sdk'
import * as v from 'valibot'

import { DEFAULT_BRAND_COLOR } from './brand-colors.ts'

// The relative rule is a product choice, not a date picker: a number of days
// counted from the moment each member claims the card.
export const EXPIRY_DAY_CHOICES = [30, 90, 365] as const
export type ExpiryChoice = number | null

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
export const localFromUnix = (seconds: number | null, includeSeconds = false): string => {
  if (seconds === null) {
    return ''
  }
  const at = new Date(seconds * MS_PER_SECOND)
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}${includeSeconds ? `:${pad(at.getSeconds())}` : ''}`
}

// One instant as the published screen prints it: the same wall clock, no `T`.
export const formatInstant = (seconds: number): string => localFromUnix(seconds).replace('T', ' ')

export interface DesignerForm {
  // Whether a scan writes a public Attendance; sent for an on-chain card only.
  attendance: boolean
  // True once the operator flipped the switch; the card type stops choosing it.
  attendanceEdited: boolean
  brandColor: string
  category: CardCategory
  identity: CardIdentity
  record: CardRecord
  // The four window fields hold `datetime-local` text; '' means unbounded.
  claimFrom: string
  claimUntil: string
  // True once the operator gave the claim end its own value; a ticket's
  // validity end stops filling it in.
  claimUntilEdited: boolean
  handle: string
  lockScreen: boolean
  name: string
  description: string
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

const DEFAULT_TITLE = 'Membership'
const DEFAULT_DAYS = 30

// What each card type means before the operator says otherwise: a membership
// is handed out forever and does not expire; a ticket is for one occasion, so
// it carries fixed instants and stops being handed out when they pass.
type CategoryWindows = Pick<
  DesignerForm,
  'claimFrom' | 'claimUntil' | 'validFrom' | 'validUntil' | 'validityDays' | 'validityMode'
>

// Only the validity mode differs: both types start with every window empty.
const categoryWindows = (category: CardCategory): CategoryWindows => ({
  claimFrom: '',
  claimUntil: '',
  validFrom: '',
  validUntil: '',
  validityDays: null,
  validityMode: category === 'ticket' ? 'fixed' : 'none',
})

export const EMPTY_FORM: DesignerForm = {
  attendance: false,
  attendanceEdited: false,
  brandColor: DEFAULT_BRAND_COLOR,
  category: 'membership',
  claimFrom: '',
  claimUntil: '',
  claimUntilEdited: false,
  description: '',
  handle: '',
  identity: 'none',
  lockScreen: false,
  name: '',
  record: 'offchain',
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
export const withCategory = (form: DesignerForm, category: CardCategory): DesignerForm => {
  const attendance = form.attendanceEdited ? {} : { attendance: defaultAttendance(category, 'onchain') }
  return form.windowEdited
    ? { ...form, ...attendance, category }
    : { ...form, ...attendance, ...categoryWindows(category), category }
}

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
const windowsOf = (form: DesignerForm): CardValidity & ClaimWindow => ({
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
  const attendance = form.record === 'onchain' ? { attendance: form.attendance } : {}
  const parsed = v.safeParse(CardBody, {
    ...attendance,
    category: form.category,
    description: form.description,
    identity: form.identity,
    lockScreen: form.lockScreen && form.venue !== null,
    record: form.record,
    slug: form.slug,
    title: form.title,
    ...windowsOf(form),
    ...venue,
  })
  return parsed.success ? parsed.output : null
}

export const cardUpdateBodyFrom = (form: DesignerForm): CardUpdateRequest | null => {
  const input: CardUpdateRequest = {
    category: form.category,
    description: form.description,
    lockScreen: form.lockScreen,
    title: form.title,
    ...windowsOf(form),
  }
  if (form.venue !== null) {
    input.venue = form.venue
  }
  if (form.record === 'onchain') {
    input.attendance = form.attendance
  }
  const parsed = v.safeParse(CardUpdateBody, input)
  return parsed.success ? parsed.output : null
}

const validityModeOf = (card: CardView): ValidityMode => {
  if (card.validityDays !== null) {
    return 'days'
  }
  return card.validFrom !== null || card.validUntil !== null ? 'fixed' : 'none'
}

// Issuance templates may have settings outside the creation form's presets.
// Preserve them, and never regenerate an existing public slug from its title.
export const formFromCard = (card: OperatorCardView): DesignerForm => ({
  ...EMPTY_FORM,
  attendance: card.attendance,
  attendanceEdited: true,
  category: card.category,
  claimFrom: localFromUnix(card.claimFrom, true),
  claimUntil: localFromUnix(card.claimUntil, true),
  claimUntilEdited: true,
  description: card.description,
  identity: card.identity,
  lockScreen: card.lockScreen,
  record: card.record,
  slug: card.slug,
  slugEdited: true,
  title: card.title,
  validFrom: localFromUnix(card.validFrom, true),
  validUntil: localFromUnix(card.validUntil, true),
  validityDays: card.validityDays,
  validityMode: validityModeOf(card),
  venue: card.venue,
  windowEdited: true,
})

// The api validates the same schema, so a disabled submit and a 400 agree.
const blocks = (status: FieldStatus): boolean =>
  status === 'format' || status === 'reserved' || status === 'taken'

export const canSubmit = (
  form: DesignerForm,
  slugStatus: FieldStatus,
  busy: boolean,
  editing = false,
): boolean => {
  if (busy || (!editing && blocks(slugStatus))) {
    return false
  }
  if (windowProblemOf(form) !== null) {
    return false
  }
  return (editing ? cardUpdateBodyFrom(form) : cardBodyFrom(form)) !== null
}

// Why a create failed, in the terms the form explains it.
export type CreateFailure =
  | 'input'
  | 'issuerLimit'
  | 'network'
  | 'session'
  | 'slugInvalid'
  | 'slugTaken'
  | 'taken'

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
    if (error === 'issuer_limit') {
      return 'issuerLimit'
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

// One card's own link under the venue page. `home` predates the store display,
// so its explicit compatibility route keeps that Card reachable.
export const cardUrl = (publicUrl: string, slug: string): string =>
  `${publicUrl.replace(/\/$/u, '')}/${slug === 'home' ? 'card/home' : slug}`

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
