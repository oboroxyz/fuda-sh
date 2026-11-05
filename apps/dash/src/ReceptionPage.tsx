import type { Hex, ReceptionResponse, StampSummary } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

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
  const [qr, setQr] = useState('')
  const [pending, setPending] = useState(false)
  const pendingNow = useRef(false)
  // The ticket is the submit that produced the result, so a repeat reception of the
  // same pass remounts the stamp actions with clean state.
  const [result, setResult] = useState<{ body: ReceptionResponse; ticket: number } | null>(null)
  const [failure, setFailure] = useState<keyof DashCopy['reception']['failures'] | null>(null)
  const retry = useRef<RetryRequest | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const mounted = useRef(true)
  const revision = useRef(0)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      revision.current += 1
    }
  }, [])
  // A different reception endpoint (another session) starts from a clean slate.
  const endpoint = useRef(props.receive)
  useEffect(() => {
    if (endpoint.current === props.receive) {
      return
    }
    endpoint.current = props.receive
    revision.current += 1
    setPending(false)
    pendingNow.current = false
    setResult(null)
    setFailure(null)
    retry.current = null
  }, [props.receive])
  useEffect(() => {
    if (!pending) {
      input.current?.focus()
    }
  }, [props.receive, pending])

  const submit = (request: RetryRequest): void => {
    if (pendingNow.current) {
      return
    }
    pendingNow.current = true
    setPending(true)
    setResult(null)
    setFailure(null)
    revision.current += 1
    const ticket = revision.current
    const run = async (): Promise<void> => {
      let outcome: Result<ReceptionResponse>
      try {
        outcome = await props.receive(request.qr, request.requestId)
      } catch {
        outcome = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted.current || revision.current !== ticket) {
        return
      }
      pendingNow.current = false
      setPending(false)
      setQr('')
      if (outcome.ok) {
        retry.current = null
        setResult({ body: outcome.body, ticket })
        return
      }
      if (outcome.network) {
        retry.current = request
        setFailure('network')
      } else {
        retry.current = null
        setFailure(failureOf(outcome.error))
      }
    }
    void run()
  }

  const stampText = (): string | null => {
    if (result === null) {
      return null
    }
    const { status, summary } = result.body.stamp
    if (status === 'awarded' && summary !== null) {
      return `${props.copy.stamp.awarded} ${summary.total} / ${summary.goal}`
    }
    return props.copy.stamp[status]
  }

  const stampTarget = (): { summary: StampSummary; uid: Hex } | null => {
    const current = result?.body
    const summary = current?.stamp.summary ?? null
    if (
      current === undefined ||
      summary === null ||
      !summary.enabled ||
      current.stamp.status === 'not_admitted'
    ) {
      return null
    }
    return { summary, uid: current.uid }
  }
  const target = stampTarget()

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
            ref={input}
            autofocus
            class="input w-full font-mono"
            disabled={pending}
            placeholder={props.copy.scannerPlaceholder}
            value={qr}
            onInput={(event) => {
              setQr(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return
              }
              event.preventDefault()
              const value = event.currentTarget.value.trim()
              if (value !== '' && !pending) {
                submit({ qr: value, requestId: createRequestId() })
              }
            }}
          />
        </label>
        {pending ? <p role="status">{props.copy.checking}</p> : null}
        {result === null ? null : (
          <div class="grid gap-3" aria-live="polite">
            <div class={result.body.decision === 'ADMIT' ? 'alert alert-success' : 'alert alert-error'}>
              <strong>{result.body.decision}</strong>
              <span>{result.body.reason}</span>
            </div>
            <div class="alert" role="status">
              {stampText()}
            </div>
            {target === null ? null : (
              <div key={result.ticket} class="border-base-300 rounded-box border p-4">
                <StampActions
                  copy={props.copy.card}
                  io={props.stamps}
                  summary={target.summary}
                  uid={target.uid}
                  onDone={() => input.current?.focus()}
                />
              </div>
            )}
          </div>
        )}
        {failure === null ? null : (
          <div class="alert alert-error" role="alert">
            <span>{props.copy.failures[failure ?? 'rejected']}</span>
            {failure === 'network' ? (
              <button
                class="btn btn-sm"
                type="button"
                onClick={() => {
                  if (retry.current !== null) {
                    submit(retry.current)
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
