import { isUid, parseQr, TIER_LABEL } from '@fuda/sdk'
import type { Hex, VerifyResponse } from '@fuda/sdk'

export type InputKind = { kind: 'preview'; uid: Hex } | { kind: 'admit'; qr: string } | { kind: 'invalid' }

// A bare uid asks "is this right valid?" (read-only preview); the fuda:v1
// payload asks for admission (spec §10).
export const classifyInput = (text: string): InputKind => {
  const t = text.trim()
  if (isUid(t)) {
    return { kind: 'preview', uid: t }
  }
  return parseQr(t) === null ? { kind: 'invalid' } : { kind: 'admit', qr: t }
}

export type ApiResult = { ok: true; body: VerifyResponse } | { ok: false; error: string; network: boolean }

export type DisplayState =
  | { tone: 'green'; title: 'ADMIT'; detail: string }
  | { tone: 'yellow'; title: 'VALID — signature required'; detail: string }
  | { tone: 'red'; title: 'REJECT'; detail: string; banner?: 'network' }

const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`

const summary = (body: VerifyResponse): string => {
  const e = body.entitlement
  return e === undefined ? '' : `${TIER_LABEL[e.tier] ?? `TIER ${e.tier}`} · ${short(e.holder)}`
}

// Three states, not two (spec §10): a preview ADMIT of a Signed/+Private right
// is valid but may not enter by QR, and staff must not read it as an admit.
export const displayState = (kind: 'preview' | 'admit', result: ApiResult): DisplayState => {
  if (!result.ok) {
    return {
      banner: result.network ? 'network' : undefined,
      detail: result.error,
      title: 'REJECT',
      tone: 'red',
    }
  }
  const { body } = result
  if (body.decision === 'REJECT') {
    return { detail: body.reason, title: 'REJECT', tone: 'red' }
  }
  if (kind === 'preview' && (body.entitlement?.level ?? 0) >= 1) {
    return { detail: summary(body), title: 'VALID — signature required', tone: 'yellow' }
  }
  return { detail: summary(body), title: 'ADMIT', tone: 'green' }
}
