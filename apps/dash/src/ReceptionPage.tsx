/** @jsxImportSource hono/jsx/dom */
import type { ReceptionResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'

export type ReceptionIo = (qr: string, requestId: string) => Promise<Result<ReceptionResponse>>

export interface ReceptionPageProps {
  copy: DashCopy['reception']
  createRequestId?: () => string
  receive: ReceptionIo
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

export const ReceptionPage = ({
  copy,
  createRequestId = () => crypto.randomUUID(),
  receive,
}: ReceptionPageProps): JSX.Element => {
  const [qr, setQr] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [result, setResult] = useState<ReceptionResponse | null>(null)
  const [failure, setFailure] = useState<keyof DashCopy['reception']['failures'] | null>(null)
  const retry = useRef<RetryRequest | null>(null)
  const input = useRef<HTMLInputElement | null>(null)
  const mounted = useRef(true)
  const revision = useRef(0)
  useEffect(
    () => () => {
      mounted.current = false
      revision.current += 1
    },
    [],
  )
  useEffect(() => {
    revision.current += 1
    setPending(false)
    pendingRef.current = false
    setResult(null)
    setFailure(null)
    retry.current = null
  }, [receive])
  useEffect(() => {
    if (!pending) {
      input.current?.focus()
    }
  }, [pending, receive])

  const submit = (request: RetryRequest): void => {
    if (pendingRef.current) {
      return
    }
    pendingRef.current = true
    setPending(true)
    setResult(null)
    setFailure(null)
    revision.current += 1
    const ticket = revision.current
    const run = async (): Promise<void> => {
      let outcome: Result<ReceptionResponse>
      try {
        outcome = await receive(request.qr, request.requestId)
      } catch {
        outcome = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted.current || revision.current !== ticket) {
        return
      }
      pendingRef.current = false
      setPending(false)
      setQr('')
      if (outcome.ok) {
        retry.current = null
        setResult(outcome.body)
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
    const { status } = result.stamp
    const { summary } = result.stamp
    if (status === 'awarded' && summary !== null) {
      return `${copy.stamp.awarded} ${summary.total} / ${summary.goal}`
    }
    return copy.stamp[status]
  }

  return (
    <section class="dash-page max-w-3xl">
      <header class="dash-page-header">
        <p class="dash-eyebrow">{copy.eyebrow}</p>
        <h1 class="text-3xl font-bold">{copy.title}</h1>
        <p class="opacity-70">{copy.description}</p>
      </header>
      <div class="card flex flex-col gap-5 p-5">
        <label class="flex flex-col gap-2">
          <span>{copy.scannerLabel}</span>
          <input
            ref={input}
            autofocus
            class="input w-full font-mono"
            disabled={pending}
            placeholder={copy.scannerPlaceholder}
            value={qr}
            onInput={(event) => {
              if (event.currentTarget instanceof HTMLInputElement) {
                setQr(event.currentTarget.value)
              }
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') {
                return
              }
              event.preventDefault()
              const value =
                event.currentTarget instanceof HTMLInputElement ? event.currentTarget.value.trim() : ''
              if (value !== '' && !pending) {
                submit({ qr: value, requestId: createRequestId() })
              }
            }}
          />
        </label>
        {pending ? <p role="status">{copy.checking}</p> : null}
        {result === null ? null : (
          <div class="grid gap-3" aria-live="polite">
            <div class={result.decision === 'ADMIT' ? 'alert alert-success' : 'alert alert-error'}>
              <strong>{result.decision}</strong>
              <span>{result.reason}</span>
            </div>
            <div class="alert" role="status">
              {stampText()}
            </div>
          </div>
        )}
        {failure === null ? null : (
          <div class="alert alert-error" role="alert">
            <span>{copy.failures[failure]}</span>
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
                {copy.retry}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
