import type { Hex, StampActionResponse, StampLedger, StampLedgerEntry, StampSummary } from '@fuda/sdk'
import { STAMP_ADJUST_MAX } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'
import { settled } from './network-result.ts'
import { useLifetime } from './use-lifetime.ts'

export interface StampIo {
  adjust: (uid: Hex, delta: number, note: string, requestId: string) => Promise<Result<StampActionResponse>>
  ledger: (uid: Hex) => Promise<Result<StampLedger>>
  redeem: (uid: Hex, requestId: string) => Promise<Result<StampActionResponse>>
}

export interface StampActionsProps {
  copy: DashCopy['reception']['card']
  createRequestId?: () => string
  io: StampIo
  onDone: () => void
  onPending: (pending: boolean) => void
  requestIds: Map<string, string>
  summary: StampSummary
  uid: Hex
}

type Mode = 'adjust' | 'confirm' | 'idle'
type Failure = keyof DashCopy['reception']['card']['failures']

const failureOf = (error: string): Failure => {
  switch (error) {
    case 'not_full': {
      return 'notFull'
    }
    case 'below_zero': {
      return 'belowZero'
    }
    case 'revoked': {
      return 'revoked'
    }
    case 'stamps_disabled': {
      return 'disabled'
    }
    case 'bad_input': {
      return 'badAmount'
    }
    default: {
      return 'generic'
    }
  }
}

const signed = (delta: number): string => (delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`)

const parseAmount = (text: string): number | null => {
  const value = Number(text.trim().replace('−', '-'))
  return Number.isInteger(value) && value !== 0 && Math.abs(value) <= STAMP_ADJUST_MAX ? value : null
}

type Copy = DashCopy['reception']['card']

const RewardConfirm = (props: {
  busy: boolean
  copy: Copy
  goal: number
  onCancel: () => void
  onConfirm: () => void
}): JSX.Element => (
  <div class="alert flex flex-col items-start gap-3" role="alertdialog" aria-label={props.copy.giveReward}>
    <span>{props.copy.confirmRewardHint(props.goal)}</span>
    <div class="flex gap-2">
      <button class="btn btn-primary" disabled={props.busy} type="button" onClick={props.onConfirm}>
        {props.busy ? props.copy.working : props.copy.confirmReward}
      </button>
      <button class="btn" disabled={props.busy} type="button" onClick={props.onCancel}>
        {props.copy.cancel}
      </button>
    </div>
  </div>
)

const AdjustForm = (props: {
  amount: string
  busy: boolean
  copy: Copy
  onAmount: (value: string) => void
  onCancel: () => void
  onReason: (value: string) => void
  onSubmit: () => void
  reason: string
}): JSX.Element => (
  <form
    class="flex flex-col gap-3"
    onSubmit={(event) => {
      event.preventDefault()
      props.onSubmit()
    }}
  >
    <p class="text-sm opacity-70">{props.copy.adjustHint}</p>
    <label class="flex flex-col gap-1">
      <span>{props.copy.amountLabel}</span>
      <input
        class="input w-full"
        disabled={props.busy}
        inputmode="numeric"
        placeholder={props.copy.amountPlaceholder}
        value={props.amount}
        onInput={(event) => {
          props.onAmount(event.currentTarget.value)
        }}
      />
    </label>
    <label class="flex flex-col gap-1">
      <span>{props.copy.reasonLabel}</span>
      <input
        class="input w-full"
        disabled={props.busy}
        maxLength={200}
        placeholder={props.copy.reasonPlaceholder}
        value={props.reason}
        onInput={(event) => {
          props.onReason(event.currentTarget.value)
        }}
      />
    </label>
    <div class="flex gap-2">
      <button class="btn btn-primary" disabled={props.busy} type="submit">
        {props.busy ? props.copy.working : props.copy.save}
      </button>
      <button class="btn" disabled={props.busy} type="button" onClick={props.onCancel}>
        {props.copy.cancel}
      </button>
    </div>
  </form>
)

const ActionNotices = (props: {
  busy: boolean
  copy: Copy
  done: 'adjust' | 'reward' | null
  failure: Failure | null
  onRetry: () => void
}): JSX.Element => (
  <>
    {props.done === null ? null : (
      <div class="alert alert-success" role="status">
        {props.done === 'reward' ? props.copy.done.reward : props.copy.done.adjust}
      </div>
    )}
    {props.failure === null ? null : (
      <div class="alert alert-error" role="alert">
        <span>{props.copy.failures[props.failure]}</span>
        {props.failure === 'network' ? (
          <button class="btn btn-sm" disabled={props.busy} type="button" onClick={props.onRetry}>
            {props.copy.retry}
          </button>
        ) : null}
      </div>
    )}
  </>
)

const LedgerHistory = (props: { copy: Copy; entries: StampLedgerEntry[] }): JSX.Element => {
  // Ledger rows have no id and are immutable, so identical rows are interchangeable;
  // the occurrence number only keeps their keys distinct.
  const seen = new Map<string, number>()
  const keyedEntries = props.entries.map((entry) => {
    const base = `${entry.at}:${entry.kind}:${entry.delta}:${entry.note}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return { entry, key: `${base}#${occurrence}` }
  })

  return (
    <section class="grid gap-2" aria-label={props.copy.historyTitle}>
      <h2 class="text-sm font-semibold">{props.copy.historyTitle}</h2>
      {props.entries.length > 0 ? (
        <ul class="grid gap-1 text-sm">
          {keyedEntries.map(({ entry, key }) => (
            <li key={key} class="flex flex-wrap items-baseline gap-x-3">
              <span class="font-mono font-semibold">{signed(entry.delta)}</span>
              <span>{entry.kind === 'redeem' ? props.copy.historyReward : props.copy.historyAdjust}</span>
              {entry.note === '' ? null : <span class="opacity-70">{entry.note}</span>}
              <time class="ml-auto opacity-60" datetime={new Date(entry.at * 1000).toISOString()}>
                {new Date(entry.at * 1000).toLocaleString()}
              </time>
            </li>
          ))}
        </ul>
      ) : (
        <p class="text-sm opacity-70">{props.copy.historyEmpty}</p>
      )}
    </section>
  )
}

const StampBalance = (props: {
  copy: Copy
  mode: Mode
  onMode: (mode: 'adjust' | 'confirm') => void
  summary: StampSummary
}): JSX.Element => (
  <div class="flex flex-wrap items-center justify-between gap-3">
    <div>
      <div class="text-sm opacity-70">{props.copy.balance}</div>
      <div class="text-2xl font-semibold" aria-live="polite">
        {props.summary.total} / {props.summary.goal}
      </div>
      {props.summary.total >= props.summary.goal ? (
        <div class="text-sm font-medium">{props.copy.full}</div>
      ) : null}
    </div>
    {props.mode === 'idle' ? (
      <div class="flex flex-wrap gap-2">
        {props.summary.total >= props.summary.goal ? (
          <button
            class="btn btn-primary btn-lg"
            type="button"
            onClick={() => {
              props.onMode('confirm')
            }}
          >
            {props.copy.giveReward}
          </button>
        ) : null}
        <button
          class="btn btn-lg"
          type="button"
          onClick={() => {
            props.onMode('adjust')
          }}
        >
          {props.copy.adjust}
        </button>
      </div>
    ) : null}
  </div>
)

// What the shop does with a card once it is scanned: hand over the reward when
// the card is full, or correct the count. The request id of an action is kept
// until the api has answered, so a retry after a dropped connection cannot
// give the reward twice.
export const StampActions = (props: StampActionsProps): JSX.Element => {
  const newRequestId = (): string => (props.createRequestId ?? (() => crypto.randomUUID()))()
  const [summary, setSummary] = useState(props.summary)
  const [entries, setEntries] = useState<StampLedgerEntry[]>([])
  const [mode, setMode] = useState<Mode>('idle')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [done, setDone] = useState<'adjust' | 'reward' | null>(null)
  const busyNow = useRef(false)
  const { mounted, revision } = useLifetime()

  useEffect(() => {
    const ticket = revision.current
    void (async () => {
      try {
        const loaded = await props.io.ledger(props.uid)
        if (mounted.current && revision.current === ticket && loaded.ok) {
          setEntries(loaded.body.entries)
          setSummary(loaded.body.summary)
        }
      } catch {
        // The scan result already shows the count; the history is a convenience.
      }
    })()
  }, [])

  const run = (key: string, call: (requestId: string) => Promise<Result<StampActionResponse>>): void => {
    if (busyNow.current) {
      return
    }
    busyNow.current = true
    setBusy(true)
    props.onPending(true)
    setFailure(null)
    setDone(null)
    const identity = JSON.stringify([props.uid, key])
    const requestId = props.requestIds.get(identity) ?? newRequestId()
    props.requestIds.set(identity, requestId)
    void (async () => {
      const outcome = await settled(async () => await call(requestId))
      if (!mounted.current) {
        return
      }
      busyNow.current = false
      setBusy(false)
      props.onPending(false)
      if (outcome.ok) {
        props.requestIds.delete(identity)
        revision.current += 1
        setEntries(outcome.body.entries)
        setSummary(outcome.body.summary)
        setMode('idle')
        setAmount('')
        setReason('')
        setDone(outcome.body.entry.kind === 'redeem' ? 'reward' : 'adjust')
        props.onDone()
        return
      }
      if (!outcome.network) {
        props.requestIds.delete(identity)
      }
      setFailure(outcome.network ? 'network' : failureOf(outcome.error))
    })()
  }

  const giveReward = (): void => {
    run('redeem', async (requestId) => await props.io.redeem(props.uid, requestId))
  }

  const saveAdjustment = (): void => {
    const delta = parseAmount(amount)
    const note = reason.trim()
    if (delta === null || note === '') {
      setFailure('badAmount')
      return
    }
    run(
      `adjust:${delta}:${note}`,
      async (requestId) => await props.io.adjust(props.uid, delta, note, requestId),
    )
  }

  const cancel = (): void => {
    if (!busy) {
      setMode('idle')
      setFailure(null)
      props.onDone()
    }
  }

  return (
    <div class="grid gap-4" data-testid="stamp-actions">
      <StampBalance
        copy={props.copy}
        mode={mode}
        onMode={(next) => {
          setFailure(null)
          setDone(null)
          setMode(next)
        }}
        summary={summary}
      />

      {mode === 'confirm' ? (
        <RewardConfirm
          busy={busy}
          copy={props.copy}
          goal={summary.goal}
          onCancel={cancel}
          onConfirm={giveReward}
        />
      ) : null}

      {mode === 'adjust' ? (
        <AdjustForm
          amount={amount}
          busy={busy}
          copy={props.copy}
          onAmount={setAmount}
          onCancel={cancel}
          onReason={setReason}
          onSubmit={saveAdjustment}
          reason={reason}
        />
      ) : null}

      <ActionNotices
        busy={busy}
        copy={props.copy}
        done={done}
        failure={failure}
        onRetry={() => {
          if (mode === 'confirm') {
            giveReward()
          } else {
            saveAdjustment()
          }
        }}
      />
      <LedgerHistory copy={props.copy} entries={entries} />
    </div>
  )
}
