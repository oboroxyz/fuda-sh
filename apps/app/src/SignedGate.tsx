/** @jsxImportSource hono/jsx/dom */
import { normalizeUid, parseQr } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { Scanner, short } from '@fuda/web-kit'
import { useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { challenge, verifySigned } from './api.ts'
import { baseAccountProvider } from './base-account.ts'
import { displayOf, enterSigned } from './signed-gate.ts'
import type { SignedDisplay } from './signed-gate.ts'
import { Verdict } from './Verdict.tsx'
import { injectedProvider, personalSign, requestAccount } from './wallet.ts'
import type { Eip1193Provider } from './wallet.ts'

const uidOf = (text: string): Hex | null => {
  const t = text.trim()
  return normalizeUid(t) ?? parseQr(t)
}

// Spec §10.1: enter or scan the pass uid → challenge → sign with the connected
// wallet → verify → full-screen verdict. The rail is any EIP-1193 provider —
// either a browser-injected wallet or the Base Account passkey wallet, which
// the member picks once a pass uid is on screen.
export const SignedGate = ({ provider }: { provider?: Eip1193Provider | null }): JSX.Element => {
  const [uid, setUid] = useState<Hex | null>(null)
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)
  const injected = provider === undefined ? injectedProvider() : provider

  const enter = async (target: Hex, rail: Eip1193Provider): Promise<void> => {
    setBusy(true)
    try {
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
    <main class="flex min-h-screen flex-col items-center gap-4 p-4">
      <h1 class="text-xl font-bold">Enter with your wallet</h1>
      <p class="text-center text-sm opacity-70">
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
                void enter(uid, injected)
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
              void enter(uid, baseAccountProvider())
            }}
          >
            {busy ? 'Signing…' : `Passkey wallet (Base Account): sign for ${short(uid)}`}
          </button>
        </div>
      )}
    </main>
  )
}
