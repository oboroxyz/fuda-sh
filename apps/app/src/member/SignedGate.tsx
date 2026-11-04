import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { isPasskeyPass, normalizeUid, parseQr } from '@fuda/sdk'
import type { Hex, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { Scanner, short } from '@fuda/ui'
import { startAuthentication } from '@simplewebauthn/browser'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { challenge, verifySigned, verifyUid } from '../api.ts'
import { displayOf, enterSigned, enterWithPasskey } from '../signed-gate.ts'
import type { PasskeyGateIo, SignedDisplay } from '../signed-gate.ts'
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

export interface SignedGateScreenIo extends PasskeyGateIo {
  preview: (uid: Hex) => Promise<Result<VerifyResponse>>
}

// The browser will not say whether the prompt was dismissed or this device lacks the
// passkey, and its own text is written for developers.
const PASSKEY_NOT_USED = 'The passkey for this pass was not used. Try again on a device that has it.'

const assertPasskey: SignedGateScreenIo['assert'] = async (options) => {
  try {
    return await startAuthentication({ optionsJSON: options })
  } catch {
    throw new Error(PASSKEY_NOT_USED)
  }
}

const defaultIo: SignedGateScreenIo = {
  assert: assertPasskey,
  challenge,
  preview: verifyUid,
  verify: verifySigned,
}

const uidFromLocation = (): Hex | null =>
  normalizeUid(new URLSearchParams(globalThis.location?.search ?? '').get('uid') ?? '')

// What a pass answers to decides what the screen offers. If that cannot be read, the
// wallet buttons stay as they were, and a wrong proof is refused at the gate.
type Answer = 'checking' | 'passkey' | 'wallet'

// docs/specs/pass-types-and-flows.md#gate-protocol: enter or scan the pass uid, or arrive
// with it in the address → challenge → answer it → verify → full-screen verdict. An
// Identified pass answers with its passkey. Anything else answers through any EIP-1193
// provider, either a browser-injected wallet or the Base Account passkey wallet, which the
// member picks once a pass uid is on screen.
export const SignedGate = (props: {
  io?: SignedGateScreenIo
  provider?: Eip1193Provider | null
  locale?: Locale
}): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, locale())
  const io = props.io ?? defaultIo
  const [uid, setUid] = createSignal<Hex | null>(uidFromLocation())
  const [answer, setAnswer] = createSignal<Answer>('wallet')
  const [state, setState] = createSignal<SignedDisplay | null>(null)
  const [busy, setBusy] = createSignal(false)
  const lifetime = new AbortController()
  const injected = (): Eip1193Provider | null =>
    props.provider === undefined ? injectedProvider() : props.provider

  onCleanup(() => {
    lifetime.abort()
  })

  createEffect(
    on(uid, (target) => {
      if (target === null) {
        return
      }
      let current = true
      onCleanup(() => {
        current = false
      })
      setAnswer('checking')
      const check = async (): Promise<void> => {
        const preview = await io.preview(target)
        const entitlement = preview.ok ? preview.body.entitlement : undefined
        if (current) {
          setAnswer(entitlement !== undefined && isPasskeyPass(entitlement) ? 'passkey' : 'wallet')
        }
      }
      void check()
    }),
  )

  const enterByPasskey = async (target: Hex): Promise<void> => {
    setBusy(true)
    try {
      const outcome = await enterWithPasskey(io, target, lifetime.signal)
      lifetime.signal.throwIfAborted()
      setState(displayOf(outcome))
    } catch (error) {
      if (!lifetime.signal.aborted) {
        setState({
          detail: error instanceof Error ? error.message : 'passkey error',
          title: 'REJECT',
          tone: 'red',
        })
      }
    } finally {
      if (!lifetime.signal.aborted) {
        setBusy(false)
      }
    }
  }

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
          <h1 class="member-heading text-center">
            {answer() === 'passkey' ? c().passkeyEntryTitle : c().signedTitle}
          </h1>
          <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">
            {answer() === 'passkey' ? c().passkeyEntryIntro : c().signedIntro}
          </p>
          <Show when={answer() !== 'passkey'}>
            <Scanner
              labels={c().scanner}
              onInput={(text) => {
                const u = uidOf(text)
                if (u !== null) {
                  setUid(u)
                }
              }}
            />
          </Show>
          <Show when={answer() === 'passkey' ? uid() : null}>
            {(target) => (
              <button
                type="button"
                class="btn btn-primary"
                disabled={busy()}
                onClick={() => {
                  void enterByPasskey(target())
                }}
              >
                {busy() ? c().signing : c().enterWithPasskey}
              </button>
            )}
          </Show>
          <Show when={answer() === 'wallet' ? uid() : null}>
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
