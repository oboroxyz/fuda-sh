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

export type DisplayState =
  | { tone: 'green'; title: 'ADMIT'; detail: string; human: boolean }
  | { tone: 'yellow'; title: 'VALID — signature required'; detail: string; human: boolean }
  | { tone: 'red'; title: 'REJECT'; detail: string; banner?: 'network'; human: boolean }

const summary = (body: VerifyResponse): string => {
  const e = body.entitlement
  return e === undefined ? '' : `${TIER_LABEL[e.tier] ?? `TIER ${e.tier}`} · ${short(e.holder)}`
}

// Three states, not two (docs/specs/pass-types-and-flows.md#gate-protocol): a preview ADMIT of a Signed/+Private right
// is valid but may not enter by QR, and staff must not read it as an admit.
export const displayState = (kind: 'preview' | 'admit', result: ApiResult): DisplayState => {
  if (!result.ok) {
    return {
      banner: result.network ? 'network' : undefined,
      detail: result.error,
      human: false,
      title: 'REJECT',
      tone: 'red',
    }
  }
  const { body } = result
  const human = body.badges?.some((b) => b.kind === 'human') ?? false
  if (body.decision === 'REJECT') {
    return { detail: body.reason, human, title: 'REJECT', tone: 'red' }
  }
  // Fail closed on a preview whose entitlement the api did not report: an
  // unknown level may be Signed/+Private, and green would wave it through.
  const e = body.entitlement
  if (kind === 'preview' && (e === undefined || e.level >= 1)) {
    return {
      detail: e === undefined ? 'level unknown — signature required' : summary(body),
      human,
      title: 'VALID — signature required',
      tone: 'yellow',
    }
  }
  return { detail: summary(body), human, title: 'ADMIT', tone: 'green' }
}
