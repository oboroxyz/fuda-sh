import type { Hex, ReceptionResponse, StampSummary } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import type { DashCopy } from './copy.ts'
import { StampActions } from './StampActions.tsx'
import type { StampIo } from './StampActions.tsx'

export type ReceptionIo = (qr: string, requestId: string) => Promise<Result<ReceptionResponse>>

export interface ReceptionPageProps {
  copy: DashCopy['reception']
  createRequestId?: () => string
  receive: ReceptionIo
  stamps: StampIo
}

interface RetryRequest {
  qr: string
  requestId: string
}

const failureOf = (error: string): keyof DashCopy['reception']['failures'] => {
  if (error === 'not_found') {
    return 'notFound'
  }
  if (error === 'bad_qr') {
    return 'badQr'
  }
  if (error === 'bad_input') {
    return 'badInput'
  }
  return 'rejected'
}

export const ReceptionPage = (props: ReceptionPageProps): JSX.Element => {
  const createRequestId = (): string => (props.createRequestId ?? (() => crypto.randomUUID()))()
  const [qr, setQr] = createSignal('')
  const [pending, setPending] = createSignal(false)
  let pendingNow = false
  const [result, setResult] = createSignal<ReceptionResponse | null>(null)
  const [failure, setFailure] = createSignal<keyof DashCopy['reception']['failures'] | null>(null)
  let retry: RetryRequest | null = null
  let input: HTMLInputElement | undefined
  let mounted = true
  let revision = 0
  onCleanup(() => {
    mounted = false
    revision += 1
  })
  // A different reception endpoint (another session) starts from a clean slate.
  createEffect(
    on(
      () => props.receive,
      () => {
        revision += 1
        setPending(false)
        pendingNow = false
        setResult(null)
        setFailure(null)
        retry = null
      },
      { defer: true },
    ),
  )
  createEffect(
    on([() => props.receive, pending], ([, busy]) => {
      if (!busy) {
        input?.focus()
      }
    }),
  )

  const submit = (request: RetryRequest): void => {
    if (pendingNow) {
      return
    }
    pendingNow = true
    setPending(true)
    setResult(null)
    setFailure(null)
    revision += 1
    const ticket = revision
    const run = async (): Promise<void> => {
      let outcome: Result<ReceptionResponse>
      try {
        outcome = await props.receive(request.qr, request.requestId)
      } catch {
        outcome = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted || revision !== ticket) {
        return
      }
      pendingNow = false
      setPending(false)
      setQr('')
      if (outcome.ok) {
        retry = null
        setResult(outcome.body)
        return
      }
      if (outcome.network) {
        retry = request
        setFailure('network')
      } else {
        retry = null
        setFailure(failureOf(outcome.error))
      }
    }
    void run()
  }

  const stampText = (): string | null => {
    const current = result()
    if (current === null) {
      return null
    }
    const { status, summary } = current.stamp
    if (status === 'awarded' && summary !== null) {
      return `${props.copy.stamp.awarded} ${summary.total} / ${summary.goal}`
    }
    return props.copy.stamp[status]
  }

  const stampTarget = (): { summary: StampSummary; uid: Hex } | null => {
    const current = result()
    const summary = current?.stamp.summary ?? null
    if (current === null || summary === null || !summary.enabled || current.stamp.status === 'not_admitted') {
      return null
    }
    return { summary, uid: current.uid }
  }

  return (
    <section class="dash-page flex max-w-3xl flex-col gap-6">
      <header class="dash-page-header">
        <h1 class="dash-page-title">{props.copy.title}</h1>
        <p class="opacity-70">{props.copy.description}</p>
      </header>
      <div class="card flex flex-col gap-5 px-6 py-8">
        <label class="flex flex-col gap-2">
          <span>{props.copy.scannerLabel}</span>
          <input
            ref={(el) => {
              input = el
            }}
            autofocus
            class="input w-full font-mono"
            disabled={pending()}
            placeholder={props.copy.scannerPlaceholder}
            value={qr()}
            onInput={(event) => {
              setQr(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return
              }
              event.preventDefault()
              const value = event.currentTarget.value.trim()
              if (value !== '' && !pending()) {
                submit({ qr: value, requestId: createRequestId() })
              }
            }}
          />
        </label>
        {pending() ? <p role="status">{props.copy.checking}</p> : null}
        {result() === null ? null : (
          <div class="grid gap-3" aria-live="polite">
            <div class={result()?.decision === 'ADMIT' ? 'alert alert-success' : 'alert alert-error'}>
              <strong>{result()?.decision}</strong>
              <span>{result()?.reason}</span>
            </div>
            <div class="alert" role="status">
              {stampText()}
            </div>
            <Show when={stampTarget()} keyed>
              {(target) => (
                <div class="border-base-300 rounded-box border p-4">
                  <StampActions
                    copy={props.copy.card}
                    io={props.stamps}
                    summary={target.summary}
                    uid={target.uid}
                    onDone={() => input?.focus()}
                  />
                </div>
              )}
            </Show>
          </div>
        )}
        {failure() === null ? null : (
          <div class="alert alert-error" role="alert">
            <span>{props.copy.failures[failure() ?? 'rejected']}</span>
            {failure() === 'network' ? (
              <button
                class="btn btn-sm"
                type="button"
                onClick={() => {
                  if (retry !== null) {
                    submit(retry)
                  }
                }}
              >
                {props.copy.retry}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
