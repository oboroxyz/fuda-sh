import type { Hex, StampActionResponse, StampLedger, StampLedgerEntry, StampSummary } from '@fuda/sdk'
import { STAMP_ADJUST_MAX } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'

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
  const mounted = useRef(true)
  const pendingId = useRef<{ key: string; requestId: string } | null>(null)

  useEffect(() => {
    mounted.current = true
    void (async () => {
      try {
        const loaded = await props.io.ledger(props.uid)
        if (mounted.current && loaded.ok) {
          setEntries(loaded.body.entries)
          setSummary(loaded.body.summary)
        }
      } catch {
        // The scan result already shows the count; the history is a convenience.
      }
    })()
    return () => {
      mounted.current = false
    }
  }, [])

  // Ledger rows have no id and are immutable, so identical rows are interchangeable;
  // the occurrence number only keeps their keys distinct.
  const seen = new Map<string, number>()
  const keyedEntries = entries.map((entry) => {
    const base = `${entry.at}:${entry.kind}:${entry.delta}:${entry.note}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return { entry, key: `${base}#${occurrence}` }
  })

  const full = (): boolean => summary.total >= summary.goal

  const run = (key: string, call: (requestId: string) => Promise<Result<StampActionResponse>>): void => {
    if (busyNow.current) {
      return
    }
    busyNow.current = true
    setBusy(true)
    setFailure(null)
    setDone(null)
    const pending = pendingId.current?.key === key ? pendingId.current : { key, requestId: newRequestId() }
    pendingId.current = pending
    const { requestId } = pending
    void (async () => {
      let outcome: Result<StampActionResponse>
      try {
        outcome = await call(requestId)
      } catch {
        outcome = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted.current) {
        return
      }
      busyNow.current = false
      setBusy(false)
      if (outcome.ok) {
        pendingId.current = null
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
        pendingId.current = null
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
      pendingId.current = null
      props.onDone()
    }
  }

  return (
    <div class="grid gap-4" data-testid="stamp-actions">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-sm opacity-70">{props.copy.balance}</div>
          <div class="text-2xl font-semibold" aria-live="polite">
            {summary.total} / {summary.goal}
          </div>
          {full() ? <div class="text-sm font-medium">{props.copy.full}</div> : null}
        </div>
        {mode === 'idle' ? (
          <div class="flex flex-wrap gap-2">
            {full() ? (
              <button
                class="btn btn-primary btn-lg"
                type="button"
                onClick={() => {
                  setFailure(null)
                  setDone(null)
                  setMode('confirm')
                }}
              >
                {props.copy.giveReward}
              </button>
            ) : null}
            <button
              class="btn btn-lg"
              type="button"
              onClick={() => {
                setFailure(null)
                setDone(null)
                setMode('adjust')
              }}
            >
              {props.copy.adjust}
            </button>
          </div>
        ) : null}
      </div>

      {mode === 'confirm' ? (
        <div
          class="alert flex flex-col items-start gap-3"
          role="alertdialog"
          aria-label={props.copy.giveReward}
        >
          <span>{props.copy.confirmRewardHint(summary.goal)}</span>
          <div class="flex gap-2">
            <button class="btn btn-primary" disabled={busy} type="button" onClick={giveReward}>
              {busy ? props.copy.working : props.copy.confirmReward}
            </button>
            <button class="btn" disabled={busy} type="button" onClick={cancel}>
              {props.copy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {mode === 'adjust' ? (
        <form
          class="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            saveAdjustment()
          }}
        >
          <p class="text-sm opacity-70">{props.copy.adjustHint}</p>
          <label class="flex flex-col gap-1">
            <span>{props.copy.amountLabel}</span>
            <input
              class="input w-full"
              disabled={busy}
              inputmode="numeric"
              placeholder={props.copy.amountPlaceholder}
              value={amount}
              onInput={(event) => {
                setAmount(event.currentTarget.value)
              }}
            />
          </label>
          <label class="flex flex-col gap-1">
            <span>{props.copy.reasonLabel}</span>
            <input
              class="input w-full"
              disabled={busy}
              maxLength={200}
              placeholder={props.copy.reasonPlaceholder}
              value={reason}
              onInput={(event) => {
                setReason(event.currentTarget.value)
              }}
            />
          </label>
          <div class="flex gap-2">
            <button class="btn btn-primary" disabled={busy} type="submit">
              {busy ? props.copy.working : props.copy.save}
            </button>
            <button class="btn" disabled={busy} type="button" onClick={cancel}>
              {props.copy.cancel}
            </button>
          </div>
        </form>
      ) : null}

      {done === null ? null : (
        <div class="alert alert-success" role="status">
          {done === 'reward' ? props.copy.done.reward : props.copy.done.adjust}
        </div>
      )}
      {failure === null ? null : (
        <div class="alert alert-error" role="alert">
          <span>{props.copy.failures[failure]}</span>
          {failure === 'network' ? (
            <button
              class="btn btn-sm"
              disabled={busy}
              type="button"
              onClick={() => {
                if (mode === 'confirm') {
                  giveReward()
                } else {
                  saveAdjustment()
                }
              }}
            >
              {props.copy.retry}
            </button>
          ) : null}
        </div>
      )}

      <section class="grid gap-2" aria-label={props.copy.historyTitle}>
        <h2 class="text-sm font-semibold">{props.copy.historyTitle}</h2>
        {entries.length > 0 ? (
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
    </div>
  )
}
