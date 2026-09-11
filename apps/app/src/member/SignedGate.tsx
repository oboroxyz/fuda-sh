/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { normalizeUid, parseQr } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { Scanner, short } from '@fuda/ui'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { challenge, verifySigned } from '../api.ts'
import { displayOf, enterSigned } from '../signed-gate.ts'
import type { SignedDisplay } from '../signed-gate.ts'
import { injectedProvider, personalSign, requestAccount } from '../wallet.ts'
import type { Eip1193Provider } from '../wallet.ts'
import { ENTRY_COPY } from './entry-copy.ts'
import { Verdict } from './Verdict.tsx'

const uidOf = (text: string): Hex | null => {
  const t = text.trim()
  return normalizeUid(t) ?? parseQr(t)
}

// The passkey rail is a ~600 kB dependency, so the SDK is fetched only once the
// member picks that rail.
const passkeyRail = async (): Promise<Eip1193Provider> => {
  const { baseAccountProvider } = await import('../base-account.ts')
  return await baseAccountProvider()
}

// docs/specs/pass-types-and-flows.md#gate-protocol: enter or scan the pass uid → challenge → sign with the connected
// wallet → verify → full-screen verdict. The rail is any EIP-1193 provider —
// either a browser-injected wallet or the Base Account passkey wallet, which
// the member picks once a pass uid is on screen.
export const SignedGate = ({
  provider,
  locale = DEFAULT_LOCALE,
}: {
  provider?: Eip1193Provider | null
  locale?: Locale
}): JSX.Element => {
  const c = pick(ENTRY_COPY, locale)
  const [uid, setUid] = useState<Hex | null>(null)
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)
  const [lifetime] = useState(() => new AbortController())
  const injected = provider === undefined ? injectedProvider() : provider

  useEffect(
    () => () => {
      lifetime.abort()
    },
    [lifetime],
  )

  // The rail arrives as a thunk so a lazily-loaded one is resolved inside the
  // try: a failed chunk fetch reads as a REJECT verdict, not an unhandled throw.
  const enter = async (target: Hex, openRail: () => Promise<Eip1193Provider>): Promise<void> => {
    setBusy(true)
    try {
      const rail = await openRail()
      lifetime.signal.throwIfAborted()
      const address = await requestAccount(rail)
      lifetime.signal.throwIfAborted()
      const outcome = await enterSigned(
        { challenge, sign: async (m) => await personalSign(rail, address, m), verify: verifySigned },
        target,
        lifetime.signal,
      )
      lifetime.signal.throwIfAborted()
      setState(displayOf(outcome))
    } catch (error) {
      if (lifetime.signal.aborted) {
        return
      }
      setState({
        detail: error instanceof Error ? error.message : 'wallet error',
        title: 'REJECT',
        tone: 'red',
      })
    } finally {
      if (!lifetime.signal.aborted) {
        setBusy(false)
      }
    }
  }

  if (state !== null) {
    return (
      <Verdict
        locale={locale}
        state={state}
        onDone={() => {
          setState(null)
        }}
      />
    )
  }
  return (
    <main class="member-page member-page-narrow flex flex-col items-center gap-6">
      <h1 class="member-heading text-center">{c.signedTitle}</h1>
      <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">{c.signedIntro}</p>
      <Scanner
        labels={c.scanner}
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
            disabled={busy}
            onClick={() => {
              void enter(uid, passkeyRail)
            }}
          >
            {busy ? c.signing : c.passkeyWallet(short(uid))}
          </button>
          {injected === null ? null : (
            <button
              type="button"
              class="btn btn-ghost"
              disabled={busy}
              onClick={() => {
                void enter(uid, async () => await Promise.resolve(injected))
              }}
            >
              {busy ? c.signing : c.browserWallet(short(uid))}
            </button>
          )}
        </div>
      )}
    </main>
  )
}
