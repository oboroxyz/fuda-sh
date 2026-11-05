import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { isPasskeyPass, normalizeUid, parseQr } from '@fuda/sdk'
import type { Hex, VerifyResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { Scanner } from '@fuda/ui-preact'
import { short } from '@fuda/ui/short'
import { startAuthentication } from '@simplewebauthn/browser'
import type { JSX, RefObject } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { challenge, verifySigned, verifyUid } from '../api.ts'
import { displayOf, enterSigned, enterWithPasskey } from '../signed-gate.ts'
import type { PasskeyGateIo, SignedDisplay, SignedOutcome } from '../signed-gate.ts'
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
  preview: (uid: Hex, signal?: AbortSignal) => Promise<Result<VerifyResponse>>
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
  // Lazy: only a Sensitive pass needs the key code, and this page opens for every Signed pass.
  signForPass: async (uid, message) => {
    const { defaultSensitiveIo, signForPass } = await import('./sensitive.ts')
    return await signForPass(defaultSensitiveIo, uid, message)
  },
  verify: verifySigned,
}

const uidFromLocation = (): Hex | null =>
  import.meta.env.SSR ? null : normalizeUid(new URLSearchParams(location.search).get('uid') ?? '')

// What a pass answers to decides what the screen offers. If that cannot be read, the
// wallet buttons stay as they were, and a wrong proof is refused at the gate.
type Answer = 'checking' | 'passkey' | 'wallet'

interface EntryOwner {
  busy: RefObject<boolean>
  controller: AbortController
  setBusy: (value: boolean) => void
  setState: (value: SignedDisplay | null) => void
}

const runEntry = async (owner: EntryOwner, work: () => Promise<SignedOutcome>): Promise<void> => {
  if (owner.busy.current) {
    return
  }
  owner.busy.current = true
  owner.setBusy(true)
  try {
    const outcome = await work()
    owner.controller.signal.throwIfAborted()
    owner.setState(displayOf(outcome))
  } catch (error) {
    if (!owner.controller.signal.aborted) {
      owner.setState({
        detail: error instanceof Error ? error.message : 'signing error',
        title: 'REJECT',
        tone: 'red',
      })
    }
  } finally {
    owner.busy.current = false
    if (!owner.controller.signal.aborted) {
      owner.setBusy(false)
    }
  }
}

const usePassAnswer = (uid: Hex | null, io: SignedGateScreenIo): Answer => {
  const [known, setKnown] = useState<{ answer: Answer; uid: Hex } | null>(null)
  useEffect(() => {
    if (uid === null) {
      return
    }
    const previewController = new AbortController()
    void (async () => {
      const preview = await io.preview(uid, previewController.signal)
      const entitlement = preview.ok ? preview.body.entitlement : undefined
      if (!previewController.signal.aborted) {
        setKnown({
          answer: entitlement !== undefined && isPasskeyPass(entitlement) ? 'passkey' : 'wallet',
          uid,
        })
      }
    })()
    return () => {
      previewController.abort()
    }
  }, [uid, io])

  if (uid === null) {
    return 'wallet'
  }
  // Compared in render, not reset in the effect: an effect runs after paint, and an
  // entry chosen before then would use the previous pass's answer.
  return known?.uid === uid ? known.answer : 'checking'
}

// docs/specs/pass-types-and-flows.md#gate-protocol: enter or scan the pass uid, or arrive
// with it in the address → challenge → answer it → verify → full-screen verdict. An
// Identified pass answers with its passkey. Anything else answers through any EIP-1193
// provider, either a browser-injected wallet or the Base Account passkey wallet, which the
// member picks once a pass uid is on screen.
const EntryActions = (props: {
  answer: Answer
  busy: boolean
  copy: (typeof ENTRY_COPY)['en']
  onPasskey: (uid: Hex) => Promise<void>
  onWallet: (uid: Hex, rail: () => Promise<Eip1193Provider>) => Promise<void>
  uid: Hex | null
  wallet: Eip1193Provider | null
}): JSX.Element | null => {
  const { uid, wallet } = props
  if (uid === null || props.answer === 'checking') {
    return null
  }
  if (props.answer === 'passkey') {
    return (
      <button
        type="button"
        class="btn btn-primary"
        disabled={props.busy}
        onClick={() => {
          void props.onPasskey(uid)
        }}
      >
        {props.busy ? props.copy.signing : props.copy.enterWithPasskey}
      </button>
    )
  }
  return (
    <div class="flex flex-col items-center gap-2">
      <button
        type="button"
        class="btn btn-primary"
        disabled={props.busy}
        onClick={() => {
          void props.onWallet(uid, passkeyRail)
        }}
      >
        {props.busy ? props.copy.signing : props.copy.passkeyWallet(short(uid))}
      </button>
      {wallet === null ? null : (
        <button
          type="button"
          class="btn btn-ghost"
          disabled={props.busy}
          onClick={() => {
            void props.onWallet(uid, async () => await Promise.resolve(wallet))
          }}
        >
          {props.busy ? props.copy.signing : props.copy.browserWallet(short(uid))}
        </button>
      )}
    </div>
  )
}

export const SignedGate = (props: {
  io?: SignedGateScreenIo
  provider?: Eip1193Provider | null
  locale?: Locale
}): JSX.Element => {
  const locale = (): Locale => props.locale ?? DEFAULT_LOCALE
  const c = (): (typeof ENTRY_COPY)[Locale] => pick(ENTRY_COPY, locale())
  const io = props.io ?? defaultIo
  const [venue] = useState(() =>
    import.meta.env.SSR ? undefined : (new URLSearchParams(location.search).get('venue') ?? undefined),
  )
  const [uid, setUid] = useState<Hex | null>(() => uidFromLocation())
  const [state, setState] = useState<SignedDisplay | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [lifetime] = useState(() => new AbortController())
  const busyRef = useRef(false)
  const injected = (): Eip1193Provider | null =>
    props.provider === undefined ? injectedProvider() : props.provider

  useEffect(() => {
    setReady(true)
    return () => {
      lifetime.abort()
    }
  }, [lifetime])
  const answer = usePassAnswer(uid, io)

  const owner: EntryOwner = { busy: busyRef, controller: lifetime, setBusy, setState }
  const enterByPasskey = async (target: Hex): Promise<void> => {
    await runEntry(owner, async () => await enterWithPasskey(io, target, lifetime.signal, venue))
  }

  // Resolve the chunk inside run so a failed fetch becomes a REJECT verdict.
  const enter = async (target: Hex, openRail: () => Promise<Eip1193Provider>): Promise<void> => {
    await runEntry(owner, async () => {
      const rail = await openRail()
      lifetime.signal.throwIfAborted()
      const address = await requestAccount(rail)
      lifetime.signal.throwIfAborted()
      return await enterSigned(
        { challenge, sign: async (m) => await personalSign(rail, address, m), verify: verifySigned },
        target,
        lifetime.signal,
        venue,
      )
    })
  }

  if (state !== null) {
    return (
      <Verdict
        locale={locale()}
        state={state}
        onDone={() => {
          setState(null)
        }}
      />
    )
  }
  return (
    <main class="member-page member-page-narrow flex flex-col items-center gap-6">
      <h1 class="member-heading text-center">
        {answer === 'passkey' ? c().passkeyEntryTitle : c().signedTitle}
      </h1>
      <p class="text-center text-sm leading-relaxed text-[var(--fuda-muted)]">
        {answer === 'passkey' ? c().passkeyEntryIntro : c().signedIntro}
      </p>
      {answer === 'passkey' ? null : (
        <Scanner
          labels={c().scanner}
          onInput={(text) => {
            const u = uidOf(text)
            if (u === null) {
              setState({ detail: c().signedUnreadable, title: 'REJECT', tone: 'red' })
              return
            }
            setUid(u)
          }}
        />
      )}
      <EntryActions
        answer={answer}
        busy={busy}
        copy={c()}
        uid={ready ? uid : null}
        wallet={injected()}
        onPasskey={enterByPasskey}
        onWallet={enter}
      />
    </main>
  )
}
