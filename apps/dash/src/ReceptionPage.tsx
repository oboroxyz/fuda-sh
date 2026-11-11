import type { Hex, ReceptionResponse, StampSummary } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'
import { settled } from './network-result.ts'
import { StampActions } from './StampActions.tsx'
import type { StampIo } from './StampActions.tsx'
import { useLifetime } from './use-lifetime.ts'

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

const stampText = (copy: DashCopy['reception'], body: ReceptionResponse): string => {
  const { status, summary } = body.stamp
  if (status === 'awarded' && summary !== null) {
    return `${copy.stamp.awarded} ${summary.total} / ${summary.goal}`
  }
  return copy.stamp[status]
}

const stampTargetOf = (body: ReceptionResponse): { summary: StampSummary; uid: Hex } | null => {
  const { summary } = body.stamp
  if (summary === null || !summary.enabled || body.stamp.status === 'not_admitted') {
    return null
  }
  return { summary, uid: body.uid }
}

const receptionReason = (copy: DashCopy['reception'], body: ReceptionResponse): string => {
  if (body.reason !== 'REQUIREMENT_UNMET') {
    return body.reason
  }
  return body.requirement?.detail === 'registry-not-allowed'
    ? copy.registryNotAllowed
    : copy.requirementInactive
}

const ReceptionOutcome = (props: {
  body: ReceptionResponse
  copy: DashCopy['reception']
  onDone: () => void
  onPending: (pending: boolean) => void
  requestIds: Map<string, string>
  stamps: StampIo
  ticket: number
}): JSX.Element => {
  const target = stampTargetOf(props.body)
  return (
    <div class="grid gap-3" aria-live="polite">
      <div class={props.body.decision === 'ADMIT' ? 'alert alert-success' : 'alert alert-error'}>
        <strong>{props.body.decision}</strong>
        <span>{receptionReason(props.copy, props.body)}</span>
      </div>
      <div class="alert" role="status">
        {stampText(props.copy, props.body)}
      </div>
      {target === null ? null : (
        <div key={props.ticket} class="border-base-300 rounded-box border p-4">
          <StampActions
            copy={props.copy.card}
            io={props.stamps}
            summary={target.summary}
            uid={target.uid}
            onDone={props.onDone}
            onPending={props.onPending}
            requestIds={props.requestIds}
          />
        </div>
      )}
    </div>
  )
}

const ReceptionFailure = (props: {
  copy: DashCopy['reception']
  failure: keyof DashCopy['reception']['failures']
  onRetry: () => void
}): JSX.Element => (
  <div class="alert alert-error" role="alert">
    <span>{props.copy.failures[props.failure]}</span>
    {props.failure === 'network' ? (
      <button class="btn btn-sm" type="button" onClick={props.onRetry}>
        {props.copy.retry}
      </button>
    ) : null}
  </div>
)

export const ReceptionPage = (props: ReceptionPageProps): JSX.Element => {
  const createRequestId = (): string => (props.createRequestId ?? (() => crypto.randomUUID()))()
  const [qr, setQr] = useState('')
  const [pending, setPending] = useState(false)
  const pendingNow = useRef(false)
  // The ticket is the submit that produced the result, so a repeat reception of the
  // same pass remounts the stamp actions with clean state.
  const [result, setResult] = useState<{ body: ReceptionResponse; ticket: number } | null>(null)
  const [failure, setFailure] = useState<keyof DashCopy['reception']['failures'] | null>(null)
  const requests = useRef<{ reception: RetryRequest | null; stamps: Map<string, string> }>({
    reception: null,
    stamps: new Map(),
  })
  const input = useRef<HTMLInputElement>(null)
  const { mounted, revision } = useLifetime()
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
    requests.current.reception = null
    requests.current.stamps.clear()
  }, [props.receive])
  useEffect(() => {
    input.current?.focus()
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
      const outcome = await settled(async () => await props.receive(request.qr, request.requestId))
      if (!mounted.current || revision.current !== ticket) {
        return
      }
      pendingNow.current = false
      setPending(false)
      setQr('')
      if (outcome.ok) {
        requests.current.reception = null
        setResult({ body: outcome.body, ticket })
        return
      }
      if (outcome.network) {
        requests.current.reception = request
        setFailure('network')
      } else {
        requests.current.reception = null
        setFailure(failureOf(outcome.error))
      }
    }
    void run()
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
              if (value !== '') {
                submit({ qr: value, requestId: createRequestId() })
              }
            }}
          />
        </label>
        {pending && result === null ? <p role="status">{props.copy.checking}</p> : null}
        {result === null ? null : (
          // The ticket remounts the stamp actions for each reception, even of the same pass.
          <ReceptionOutcome
            body={result.body}
            copy={props.copy}
            onDone={() => input.current?.focus()}
            onPending={(value) => {
              pendingNow.current = value
              setPending(value)
            }}
            requestIds={requests.current.stamps}
            stamps={props.stamps}
            ticket={result.ticket}
          />
        )}
        {failure === null ? null : (
          <ReceptionFailure
            copy={props.copy}
            failure={failure}
            onRetry={() => {
              if (requests.current.reception !== null) {
                submit(requests.current.reception)
              }
            }}
          />
        )}
      </div>
    </section>
  )
}
