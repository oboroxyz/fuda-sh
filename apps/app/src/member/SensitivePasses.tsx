import { pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { MemberSecretResponse } from '@fuda/sdk'
import { apiFetch } from '@fuda/sdk/http'
import { ConfirmAction } from '@fuda/ui-preact'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { challenge, verifySigned } from '../api.ts'
import { API_BASE_URL } from '../config.ts'
import { displayOf, enterSigned } from '../signed-gate.ts'
import type { SignedDisplay } from '../signed-gate.ts'
import { useLoad } from '../use-load.ts'
import { MEMBER_COPY } from './copy.ts'
import type { VaultEntry } from './member-secret.ts'
import { Verdict } from './Verdict.tsx'

const holdsSecret = async (): Promise<boolean> => {
  const state = await apiFetch<MemberSecretResponse>(API_BASE_URL, '/member/secret')
  return state.ok && state.body.copies.length > 0
}

interface Opened {
  entries: VaultEntry[]
  secret: Uint8Array<ArrayBuffer>
}

type Problem = 'failed' | 'notOpened'

const readList = async (): Promise<{ list: Opened } | { problem: Problem }> => {
  const { defaultSensitiveIo, openMemberSecret, readVaultEntries } = await import('./sensitive.ts')
  const secret = await openMemberSecret(defaultSensitiveIo)
  if (secret.kind !== 'open') {
    return { problem: secret.kind === 'failed' ? 'failed' : 'notOpened' }
  }
  const read = await readVaultEntries(defaultSensitiveIo, secret.secret)
  return read.ok ? { list: { entries: read.entries, secret: secret.secret } } : { problem: 'failed' }
}

// docs/specs/pass-types-and-flows.md#sensitive-use. The account has no list of these passes
// the server can read, so this asks for a passkey only when the member asks to see them, and
// asks the server nothing about any one of them until the member enters with it. The opened
// secret lives only in this screen, so entering from here takes no second prompt.
const renderSensitiveList = (input: {
  busy: boolean
  copy: (typeof MEMBER_COPY)['en']['sensitive']
  onEnter: (entry: VaultEntry, secret: Opened['secret']) => Promise<void>
  onOpen: () => Promise<void>
  opened: Opened | null
}): JSX.Element => {
  const { busy, copy: text, onEnter: enter, onOpen: openList, opened } = input
  if (opened === null) {
    return (
      <>
        <p class="text-sm text-[var(--fuda-muted)]">{text.hint}</p>
        <button
          class="btn btn-outline w-full"
          disabled={busy}
          type="button"
          onClick={() => {
            void openList()
          }}
        >
          {busy ? text.opening : text.open}
        </button>
      </>
    )
  }
  if (opened.entries.length === 0) {
    return <p class="text-sm text-[var(--fuda-muted)]">{text.empty}</p>
  }
  return (
    <ul class="flex flex-col gap-2">
      {opened.entries.map((entry) => (
        <li
          key={entry.uid}
          class="flex items-center gap-3 rounded-2xl border border-[var(--fuda-border)] p-3"
        >
          <div class="flex min-w-0 grow flex-col">
            <span class="text-sm font-medium wrap-anywhere">{entry.cardTitle}</span>
            <span class="text-xs wrap-anywhere text-[var(--fuda-muted)]">@{entry.venue}</span>
          </div>
          <button
            class="btn btn-primary btn-sm"
            disabled={busy}
            type="button"
            onClick={() => {
              void enter(entry, opened.secret)
            }}
          >
            {text.enter}
          </button>
        </li>
      ))}
    </ul>
  )
}

const RecoveryActions = (props: {
  copy: (typeof MEMBER_COPY)['en']['sensitive']
  onStartOver: () => Promise<void>
  problem: Problem | null
  startedOver: boolean | null
}): JSX.Element => (
  <>
    {props.problem ? (
      <div role="alert" class="alert alert-error">
        {props.copy[props.problem]}
      </div>
    ) : null}
    {props.problem === 'notOpened' ? (
      <>
        <p class="text-sm text-[var(--fuda-muted)]">{props.copy.startOverHint}</p>
        <ConfirmAction
          cancelLabel={props.copy.keepThem}
          confirmLabel={props.copy.startOver}
          description={props.copy.startOverWarning}
          label={props.copy.startOver}
          onConfirm={() => {
            void props.onStartOver()
          }}
          title={props.copy.startOverTitle}
        />
      </>
    ) : null}
    {props.startedOver === false ? (
      <div role="alert" class="alert alert-error">
        {props.copy.startOverFailed}
      </div>
    ) : null}
  </>
)

export const SensitivePasses = (props: { locale: Locale }): JSX.Element => {
  const copy = (): (typeof MEMBER_COPY)[Locale]['sensitive'] => pick(MEMBER_COPY, props.locale).sensitive
  const { data: held, refetch } = useLoad(holdsSecret)
  const [startedOver, setStartedOver] = useState<boolean | null>(null)
  const [opened, setOpened] = useState<Opened | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)
  const [verdict, setVerdict] = useState<SignedDisplay | null>(null)

  const mounted = useRef(true)
  const busyRef = useRef(false)
  useEffect(
    () => () => {
      mounted.current = false
      setOpened(null)
    },
    [],
  )

  const openList = async (): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    setProblem(null)
    try {
      const result = await readList()
      if (!mounted.current) {
        return
      }
      if ('list' in result) {
        setOpened(result.list)
      } else {
        setProblem(result.problem)
      }
    } catch {
      setProblem('failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const startOver = async (): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    const { startSecretOver } = await import('./sensitive.ts')
    const cleared = await startSecretOver()
    if (!mounted.current) {
      return
    }
    busyRef.current = false
    setBusy(false)
    setStartedOver(cleared)
    if (cleared) {
      setOpened(null)
      setVerdict(null)
      setProblem(null)
      await refetch()
    }
  }

  const enter = async (entry: VaultEntry, secret: Opened['secret']): Promise<void> => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setBusy(true)
    setProblem(null)
    try {
      const { passKeyFrom } = await import('./member-secret.ts')
      const key = await passKeyFrom(secret, entry.salt)
      const outcome = await enterSigned(
        {
          challenge,
          sign: async (message) => await key.signMessage({ message }),
          verify: verifySigned,
        },
        entry.uid,
      )
      if (mounted.current) {
        setVerdict(displayOf(outcome))
      }
    } catch {
      setProblem('failed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const renderList = () =>
    renderSensitiveList({ busy, copy: copy(), onEnter: enter, onOpen: openList, opened })

  return (
    <>
      {startedOver === true ? (
        <p role="status" class="alert alert-info text-sm">
          {copy().startOverDone}
        </p>
      ) : null}
      {held === true ? (
        <section class="flex flex-col gap-3" data-testid="sensitive-passes">
          <h2 class="text-sm font-semibold">{copy().title}</h2>
          {renderList()}
          <RecoveryActions
            copy={copy()}
            problem={problem}
            startedOver={startedOver}
            onStartOver={startOver}
          />
          {verdict ? (
            <Verdict
              locale={props.locale}
              state={verdict}
              onDone={() => {
                setVerdict(null)
              }}
            />
          ) : null}
        </section>
      ) : null}
    </>
  )
}
