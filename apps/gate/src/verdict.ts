import { isUid, parseQr, TIER_LABEL } from '@fuda/sdk'
import type { Hex, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { short } from '@fuda/ui'

export type InputKind = { kind: 'preview'; uid: Hex } | { kind: 'admit'; qr: string } | { kind: 'invalid' }

// A bare uid asks "is this right valid?" (read-only preview); the fuda:v1
// payload asks for admission (docs/specs/pass-types-and-flows.md#gate-protocol).
export const classifyInput = (text: string): InputKind => {
  const t = text.trim()
  if (isUid(t)) {
    return { kind: 'preview', uid: t }
  }
  return parseQr(t) === null ? { kind: 'invalid' } : { kind: 'admit', qr: t }
}

export type ApiResult = Result<VerifyResponse>

// Index is the on-chain usage model value, like TIER_LABEL in the sdk.
const USAGE_LABEL = ['single-use', 'multi-use', 'metered'] as const

// What the screen says about the pass that was just presented. Every field is
// nullable because a verdict can arrive without an entitlement (NOT_FOUND,
// WRONG_SCHEMA) or without a delegation, and a transport failure has neither.
export interface VerdictFacts {
  // The delegation the Right was issued under, which is fuda's own root for
  // every Right this deployment signs — "fuda root", not the venue. The venue
  // is not in a verdict at all: it is a D1 record behind the uid, and the gate
  // does not read it. Named for what it is so the view cannot present it as a
  // venue name.
  delegation: string | null
  tier: string | null
  usage: string | null
  validUntil: string | null
  holder: string | null
}

// The badge as the gate shows it: which verifier attested, and when. `at` is
// already formatted, so the view renders a string rather than a timestamp.
export interface VerdictBadge {
  verifier: string
  at: string
}

export type DisplayState =
  | { tone: 'green'; title: 'ADMIT'; detail: string; facts: VerdictFacts; badge: VerdictBadge | null }
  | {
      tone: 'yellow'
      title: 'VALID — signature required'
      detail: string
      facts: VerdictFacts
      badge: VerdictBadge | null
    }
  | {
      tone: 'red'
      title: 'REJECT'
      detail: string
      banner?: 'network'
      facts: VerdictFacts
      badge: VerdictBadge | null
    }

const NO_FACTS: VerdictFacts = { delegation: null, holder: null, tier: null, usage: null, validUntil: null }

const two = (n: number): string => String(n).padStart(2, '0')

// The api sends unix seconds; both helpers render them in the reader's own
// timezone, because the staff reading the screen stand in the venue.
const localDate = (unix: number): string => {
  const d = new Date(unix * 1000)
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`
}

const localMinute = (unix: number): string => {
  const d = new Date(unix * 1000)
  return `${localDate(unix)} ${two(d.getHours())}:${two(d.getMinutes())}`
}

const factsOf = (body: VerifyResponse): VerdictFacts => {
  const e = body.entitlement
  const name = body.delegation?.name
  const delegation = name === undefined || name === '' ? null : name
  if (e === undefined) {
    return { ...NO_FACTS, delegation }
  }
  return {
    delegation,
    holder: short(e.holder),
    tier: TIER_LABEL[e.tier] ?? `TIER ${e.tier}`,
    usage: USAGE_LABEL[e.usageModel] ?? `usage ${e.usageModel}`,
    // An unset end means "does not expire" (docs/specs/pass-types-and-flows.md#validity-windows), never 1970.
    validUntil: e.validUntil === 0 ? null : localDate(e.validUntil),
  }
}

// Only the kinds the screen can say something about. An unknown kind is skipped
// rather than rendered raw: the chip is read at arm's length, not parsed.
const badgeOf = (body: VerifyResponse): VerdictBadge | null => {
  const human = body.badges?.find((b) => b.kind === 'human')
  return human === undefined ? null : { at: localMinute(human.at), verifier: human.verifier }
}

// Input the scanner could not classify is RED without an api call at all
// (docs/specs/pass-types-and-flows.md#gate-protocol), so it is built here beside the verdicts rather than in the view.
export const unreadableInput = (): DisplayState => ({
  badge: null,
  detail: 'not a fuda pass',
  facts: NO_FACTS,
  title: 'REJECT',
  tone: 'red',
})

// Three states, not two (docs/specs/pass-types-and-flows.md#gate-protocol): a preview ADMIT of a Signed/+Private right
// is valid but may not enter by QR, and staff must not read it as an admit.
export const displayState = (kind: 'preview' | 'admit', result: ApiResult): DisplayState => {
  if (!result.ok) {
    return {
      badge: null,
      banner: result.network ? 'network' : undefined,
      detail: result.error,
      facts: NO_FACTS,
      title: 'REJECT',
      tone: 'red',
    }
  }
  const { body } = result
  const facts = factsOf(body)
  const badge = badgeOf(body)
  if (body.decision === 'REJECT') {
    return { badge, detail: body.reason, facts, title: 'REJECT', tone: 'red' }
  }
  // Fail closed on a preview whose entitlement the api did not report: an
  // unknown level may be Signed/+Private, and green would wave it through.
  const e = body.entitlement
  if (kind === 'preview' && (e === undefined || e.level >= 1)) {
    return {
      badge,
      detail: e === undefined ? 'level unknown — signature required' : '',
      facts,
      title: 'VALID — signature required',
      tone: 'yellow',
    }
  }
  return { badge, detail: '', facts, title: 'ADMIT', tone: 'green' }
}
