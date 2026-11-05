import type { AuthorizePreviewResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { FingerprintSimple, FudaMark } from '@fuda/ui'
import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

import type { approveAuthorization, authorizePreview } from './connected-apps-api.ts'
import type { ConsentCopy } from './consent-copy.ts'
import type { AuthorizeRequest } from './consent.ts'
import { approvalBody, approvedScope, deniedRedirect, previewParams } from './consent.ts'

// The page a connected app sends the browser to (docs/specs/connected-apps.md#approval).
// It stands apart from the dashboard shell: it signs in with the same passkey
// session, shows what the app asks for, and leaves by a full-page redirect.
export interface ConsentIo {
  approve: typeof approveAuthorization
  assign: (url: string) => void
  preview: typeof authorizePreview
  signIn: () => Promise<{ ok: boolean }>
  signInWithWallet: () => Promise<{ ok: boolean }>
}

type View =
  | { kind: 'loading' }
  | { kind: 'sign-in'; pending: boolean; failed: boolean }
  | { kind: 'failed'; error: string }
  | {
      kind: 'ready'
      preview: AuthorizePreviewResponse
      issuerId: string
      approving: boolean
      allowRevoke: boolean
    }

const failureText = (copy: ConsentCopy, error: string): string => copy.failures[error] ?? copy.unknownFailure

export interface OAuthConsentPageProps {
  signedIn: boolean
  copy: ConsentCopy
  dashboardUrl: string
  io: ConsentIo
  request: AuthorizeRequest
}

export const OAuthConsentPage = (props: OAuthConsentPageProps): JSX.Element => {
  const [signedIn, setSignedIn] = useState(props.signedIn)
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    if (!signedIn) {
      setView({ failed: false, kind: 'sign-in', pending: false })
      return
    }
    if (props.request.codeChallenge === '') {
      setView({ error: 'invalid_request', kind: 'failed' })
      return
    }
    let live = true
    setView({ kind: 'loading' })
    const run = async (): Promise<void> => {
      const result: Result<AuthorizePreviewResponse> = await props.io.preview(previewParams(props.request))
      if (!live) {
        return
      }
      if (result.ok) {
        setView({
          allowRevoke: false,
          approving: false,
          issuerId: result.body.issuers[0]?.id ?? '',
          kind: 'ready',
          preview: result.body,
        })
      } else if (result.status === 401) {
        setSignedIn(false)
      } else {
        setView({ error: result.error, kind: 'failed' })
      }
    }
    void run()
    return () => {
      live = false
    }
  }, [signedIn])

  const signIn = (method: ConsentIo['signIn']): void => {
    setView({ failed: false, kind: 'sign-in', pending: true })
    const run = async (): Promise<void> => {
      const outcome = await method().catch(() => ({ ok: false as const }))
      if (outcome.ok) {
        setSignedIn(true)
      } else {
        setView({ failed: true, kind: 'sign-in', pending: false })
      }
    }
    void run()
  }

  const approve = (ready: Extract<View, { kind: 'ready' }>): void => {
    if (!signedIn) {
      return
    }
    setView({ ...ready, approving: true })
    const run = async (): Promise<void> => {
      const result = await props.io.approve(
        approvalBody(props.request, ready.issuerId, approvedScope(ready.preview.scope, ready.allowRevoke)),
      )
      if (result.ok) {
        props.io.assign(result.body.redirectTo)
      } else {
        setView({ error: result.error, kind: 'failed' })
      }
    }
    void run()
  }

  const body = (): JSX.Element => {
    const current = view
    if (current.kind === 'loading') {
      return <p role="status">{props.copy.loading}</p>
    }
    if (current.kind === 'sign-in') {
      return (
        <>
          <p class="text-base leading-relaxed text-[var(--fuda-muted)]">{props.copy.signInHint}</p>
          {current.failed ? (
            <p role="alert" class="alert alert-error">
              {props.copy.signInFailed}
            </p>
          ) : null}
          <button
            class="btn btn-primary w-full gap-2"
            disabled={current.pending}
            onClick={() => {
              signIn(props.io.signIn)
            }}
            type="button"
          >
            <FingerprintSimple />
            {current.pending ? props.copy.signingIn : props.copy.signIn}
          </button>
          <button
            class="link text-sm"
            disabled={current.pending}
            onClick={() => {
              signIn(props.io.signInWithWallet)
            }}
            type="button"
          >
            {props.copy.signInWithWallet}
          </button>
        </>
      )
    }
    if (current.kind === 'failed') {
      return (
        <p role="alert" class="alert alert-error">
          {failureText(props.copy, current.error)}
        </p>
      )
    }
    const { preview } = current
    return (
      <>
        <p class="text-lg">
          <strong>{preview.app.name}</strong> {props.copy.wants}
        </p>
        <dl class="flex w-full flex-col gap-1 text-sm">
          <dt class="text-[var(--fuda-muted)]">{props.copy.redirectsTo}</dt>
          <dd class="font-mono break-all">{new URL(preview.redirectUri).origin}</dd>
        </dl>
        <div class="w-full">
          <p class="mb-2 text-sm text-[var(--fuda-muted)]">{props.copy.permissions}</p>
          <ul class="list-inside list-disc">
            {preview.scope
              .filter((scope) => scope !== 'passes:revoke')
              .map((scope): JSX.Element => (
                <li>{props.copy.scopes[scope]}</li>
              ))}
          </ul>
          {preview.scope.includes('passes:revoke') ? (
            <label class="mt-3 flex items-start gap-3">
              <input
                checked={current.allowRevoke}
                class="checkbox mt-0.5"
                onChange={(event: Event) => {
                  setView({
                    ...current,
                    allowRevoke:
                      event.currentTarget instanceof HTMLInputElement && event.currentTarget.checked,
                  })
                }}
                type="checkbox"
              />
              <span>{props.copy.revokeOptIn}</span>
            </label>
          ) : null}
        </div>
        {preview.issuers.length === 0 ? (
          <>
            <p role="alert" class="alert">
              {props.copy.noIssuer}
            </p>
            <a class="btn" href={props.dashboardUrl}>
              {props.copy.createIssuer}
            </a>
          </>
        ) : (
          <fieldset class="w-full">
            <legend class="mb-2 text-sm text-[var(--fuda-muted)]">{props.copy.chooseIssuer}</legend>
            {preview.issuers.map((issuer): JSX.Element => (
              <label class="flex items-center gap-3 py-1">
                <input
                  checked={current.issuerId === issuer.id}
                  class="radio"
                  name="issuer"
                  onChange={() => {
                    setView({ ...current, issuerId: issuer.id })
                  }}
                  type="radio"
                  value={issuer.id}
                />
                <span>
                  {issuer.name} <span class="text-[var(--fuda-muted)]">@{issuer.handle}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div class="flex w-full gap-3">
          <button
            class="btn flex-1"
            disabled={current.approving}
            onClick={() => {
              props.io.assign(deniedRedirect(preview.redirectUri, props.request.state, preview.issuer))
            }}
            type="button"
          >
            {props.copy.deny}
          </button>
          <button
            class="btn btn-primary flex-1"
            disabled={current.approving || current.issuerId === ''}
            onClick={() => {
              approve(current)
            }}
            type="button"
          >
            {current.approving ? props.copy.approving : props.copy.approve}
          </button>
        </div>
      </>
    )
  }

  return (
    <main class="dash-auth">
      <div class="mx-auto flex w-full max-w-[30rem] flex-col gap-8 px-5 py-8 sm:px-8 sm:py-12">
        <header class="flex flex-col items-center gap-4 border-b border-[var(--fuda-border)] pb-5">
          <div class="dash-auth-logo-intro">{FudaMark({ class: 'dash-auth-logo' })}</div>
          <span class="font-display text-3xl font-bold">fuda</span>
        </header>
        <section class="flex flex-col items-start gap-6 py-4">
          <h1 class="dash-auth-title">{props.copy.title}</h1>
          {body()}
        </section>
      </div>
    </main>
  )
}
