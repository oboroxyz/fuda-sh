import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { normalizeUid, parseQr } from '@fuda/sdk'
import type { Hex } from '@fuda/sdk'
import { Scanner, short } from '@fuda/ui'
import { createSignal, onCleanup, Show } from 'solid-js'
import type { JSX } from 'solid-js'

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
export const SignedGate = (props: { provider?: Eip1193Provider | null; locale?: Locale }): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, locale())
  const [uid, setUid] = createSignal<Hex | null>(null)
  const [state, setState] = createSignal<SignedDisplay | null>(null)
  const [busy, setBusy] = createSignal(false)
  const lifetime = new AbortController()
  const injected = (): Eip1193Provider | null =>
    props.provider === undefined ? injectedProvider() : props.provider

  onCleanup(() => {
    lifetime.abort()
  })

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

  return (
    <Show
      when={state()}
      fallback={
        <main class="member-page member-page-narrow flex flex-col items-center gap-6">
          <h1 class="member-heading text-center">{c().signedTitle}</h1>
          <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">{c().signedIntro}</p>
          <Scanner
            labels={c().scanner}
            onInput={(text) => {
              const u = uidOf(text)
              if (u === null) {
                // The camera stops at the first code it reads; dismissing this
                // brings the scanner back for another try.
                setState({ detail: c().signedUnreadable, title: 'REJECT', tone: 'red' })
                return
              }
              setUid(u)
            }}
          />
          <Show when={uid()}>
            {(target) => (
              <div class="flex flex-col items-center gap-2">
                <button
                  type="button"
                  class="btn btn-primary"
                  disabled={busy()}
                  onClick={() => {
                    void enter(target(), passkeyRail)
                  }}
                >
                  {busy() ? c().signing : c().passkeyWallet(short(target()))}
                </button>
                <Show when={injected()}>
                  {(wallet) => (
                    <button
                      type="button"
                      class="btn btn-ghost"
                      disabled={busy()}
                      onClick={() => {
                        const rail = wallet()
                        void enter(target(), async () => await Promise.resolve(rail))
                      }}
                    >
                      {busy() ? c().signing : c().browserWallet(short(target()))}
                    </button>
                  )}
                </Show>
              </div>
            )}
          </Show>
        </main>
      }
    >
      {(verdict) => (
        <Verdict
          locale={locale()}
          state={verdict()}
          onDone={() => {
            setState(null)
          }}
        />
      )}
    </Show>
  )
}
