/** @jsxImportSource hono/jsx/dom */
import { normalizeUid, parseQr } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { Scanner, short } from '@fuda/ui'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { challenge, verifySigned } from './api.ts'
import { displayOf, enterSigned } from './signed-gate.ts'
import type { SignedDisplay } from './signed-gate.ts'
import { Verdict } from './Verdict.tsx'
import { injectedProvider, personalSign, requestAccount } from './wallet.ts'
import type { Eip1193Provider } from './wallet.ts'

const uidOf = (text: string): Hex | null => {
  const t = text.trim()
  return normalizeUid(t) ?? parseQr(t)
}

// The passkey rail is a ~600 kB dependency and the same Worker serves the public
// apex landing, so the SDK is fetched only once the member picks that rail — the
// landing bundle never carries it.
const passkeyRail = async (): Promise<Eip1193Provider> => {
  const { baseAccountProvider } = await import('./base-account.ts')
  return baseAccountProvider()
}

// docs/specs/pass-types-and-flows.md#gate-protocol: enter or scan the pass uid → challenge → sign with the connected
// wallet → verify → full-screen verdict. The rail is any EIP-1193 provider —
// either a browser-injected wallet or the Base Account passkey wallet, which
// the member picks once a pass uid is on screen.
export const SignedGate = ({ provider }: { provider?: Eip1193Provider | null }): JSX.Element => {
  const [uid, setUid] = useState<Hex | null>(null)
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)
  const injected = provider === undefined ? injectedProvider() : provider

  // The rail arrives as a thunk so a lazily-loaded one is resolved inside the
  // try: a failed chunk fetch reads as a REJECT verdict, not an unhandled throw.
  const enter = async (target: Hex, openRail: () => Promise<Eip1193Provider>): Promise<void> => {
    setBusy(true)
    try {
      const rail = await openRail()
      const address = await requestAccount(rail)
      const outcome = await enterSigned(
        { challenge, sign: async (m) => await personalSign(rail, address, m), verify: verifySigned },
        target,
      )
      setState(displayOf(outcome))
    } catch (error) {
      setState({
        detail: error instanceof Error ? error.message : 'wallet error',
        title: 'REJECT',
        tone: 'red',
      })
    } finally {
      setBusy(false)
    }
  }

  if (state !== null) {
    return (
      <Verdict
        state={state}
        onDone={() => {
          setState(null)
        }}
      />
    )
  }
  return (
    <main class="member-page member-page-narrow flex flex-col items-center gap-6">
      <h1 class="member-heading text-center">Enter with your wallet</h1>
      <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">
        Scan or paste your pass, then sign the one-time challenge from the Venue's gate.
      </p>
      <Scanner
        onInput={(text) => {
          const u = uidOf(text)
          if (u !== null) {
            setUid(u)
          }
        }}
      />
      {uid === null ? null : (
        <div class="flex flex-col items-center gap-2">
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy || injected === null}
            onClick={() => {
              if (injected !== null) {
                void enter(uid, async () => await Promise.resolve(injected))
              }
            }}
          >
            {busy ? 'Signing…' : `Browser wallet: sign for ${short(uid)}`}
          </button>
          {injected === null ? (
            <p class="text-center text-xs opacity-70">
              No browser wallet found — install one, or use a passkey.
            </p>
          ) : null}
          <button
            type="button"
            class="btn btn-secondary"
            disabled={busy}
            onClick={() => {
              void enter(uid, passkeyRail)
            }}
          >
            {busy ? 'Signing…' : `Passkey wallet (Base Account): sign for ${short(uid)}`}
          </button>
        </div>
      )}
    </main>
  )
}
