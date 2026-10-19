import type { AuthorizePreviewResponse } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
/** @jsxImportSource hono/jsx/dom */
import { FingerprintSimple, FudaMark } from '@fuda/ui'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { approveAuthorization, authorizePreview } from './connected-apps-api.ts'
import type { ConsentCopy } from './consent-copy.ts'
import type { AuthorizeRequest } from './consent.ts'
import { approvalBody, deniedRedirect, previewParams } from './consent.ts'

// The page a connected app sends the browser to (docs/specs/connected-apps.md#approval).
// It stands apart from the dashboard shell: it signs in with the same passkey
// session, shows what the app asks for, and leaves by a full-page redirect.
export interface ConsentIo {
  approve: typeof approveAuthorization
  assign: (url: string) => void
  clearToken: () => void
  preview: typeof authorizePreview
  readToken: () => string | null
  saveToken: (token: string) => void
  signIn: () => Promise<{ ok: true; token: string } | { ok: false }>
}

type View =
  | { kind: 'loading' }
  | { kind: 'sign-in'; pending: boolean; failed: boolean }
  | { kind: 'failed'; error: string }
  | { kind: 'ready'; preview: AuthorizePreviewResponse; issuerId: string; approving: boolean }

const failureText = (copy: ConsentCopy, error: string): string => copy.failures[error] ?? copy.unknownFailure

export interface OAuthConsentPageProps {
  copy: ConsentCopy
  dashboardUrl: string
  io: ConsentIo
  request: AuthorizeRequest
}

export const OAuthConsentPage = ({ copy, dashboardUrl, io, request }: OAuthConsentPageProps): JSX.Element => {
  const [token, setToken] = useState<string | null>(io.readToken)
  const [view, setView] = useState<View>({ kind: 'loading' })

  useEffect(() => {
    if (token === null) {
      setView({ failed: false, kind: 'sign-in', pending: false })
      return
    }
    if (request.codeChallenge === '') {
      setView({ error: 'invalid_request', kind: 'failed' })
      return
    }
    let live = true
    setView({ kind: 'loading' })
    const run = async (): Promise<void> => {
      const result: Result<AuthorizePreviewResponse> = await io.preview(token, previewParams(request))
      if (!live) {
        return
      }
      if (result.ok) {
        setView({
          approving: false,
          issuerId: result.body.issuers[0]?.id ?? '',
          kind: 'ready',
          preview: result.body,
        })
      } else if (result.status === 401) {
        io.clearToken()
        setToken(null)
      } else {
        setView({ error: result.error, kind: 'failed' })
      }
    }
    void run()
    return () => {
      live = false
    }
  }, [token])

  const signIn = (): void => {
    setView({ failed: false, kind: 'sign-in', pending: true })
    const run = async (): Promise<void> => {
      const outcome = await io.signIn().catch(() => ({ ok: false as const }))
      if (outcome.ok) {
        io.saveToken(outcome.token)
        setToken(outcome.token)
      } else {
        setView({ failed: true, kind: 'sign-in', pending: false })
      }
    }
    void run()
  }

  const approve = (ready: Extract<View, { kind: 'ready' }>): void => {
    if (token === null) {
      return
    }
    setView({ ...ready, approving: true })
    const run = async (): Promise<void> => {
      const result = await io.approve(token, approvalBody(request, ready.issuerId))
      if (result.ok) {
        io.assign(result.body.redirectTo)
      } else {
        setView({ error: result.error, kind: 'failed' })
      }
    }
    void run()
  }

  const body = (): JSX.Element => {
    if (view.kind === 'loading') {
      return <p role="status">{copy.loading}</p>
    }
    if (view.kind === 'sign-in') {
      return (
        <>
          <p class="text-base leading-relaxed text-[var(--fuda-muted)]">{copy.signInHint}</p>
          {view.failed ? (
            <p role="alert" class="alert alert-error">
              {copy.signInFailed}
            </p>
          ) : null}
          <button class="btn btn-primary w-full gap-2" disabled={view.pending} onClick={signIn} type="button">
            <FingerprintSimple />
            {view.pending ? copy.signingIn : copy.signIn}
          </button>
        </>
      )
    }
    if (view.kind === 'failed') {
      return (
        <p role="alert" class="alert alert-error">
          {failureText(copy, view.error)}
        </p>
      )
    }
    const { preview } = view
    return (
      <>
        <p class="text-lg">
          <strong>{preview.app.name}</strong> {copy.wants}
        </p>
        <dl class="flex w-full flex-col gap-1 text-sm">
          <dt class="text-[var(--fuda-muted)]">{copy.redirectsTo}</dt>
          <dd class="font-mono break-all">{new URL(preview.redirectUri).origin}</dd>
        </dl>
        <div class="w-full">
          <p class="mb-2 text-sm text-[var(--fuda-muted)]">{copy.permissions}</p>
          <ul class="list-inside list-disc">
            {preview.scope.map((scope): JSX.Element => (
              <li key={scope}>{copy.scopes[scope]}</li>
            ))}
          </ul>
        </div>
        {preview.issuers.length === 0 ? (
          <>
            <p role="alert" class="alert">
              {copy.noIssuer}
            </p>
            <a class="btn" href={dashboardUrl}>
              {copy.createIssuer}
            </a>
          </>
        ) : (
          <fieldset class="w-full">
            <legend class="mb-2 text-sm text-[var(--fuda-muted)]">{copy.chooseIssuer}</legend>
            {preview.issuers.map((issuer): JSX.Element => (
              <label key={issuer.id} class="flex items-center gap-3 py-1">
                <input
                  checked={view.issuerId === issuer.id}
                  class="radio"
                  name="issuer"
                  onChange={() => {
                    setView({ ...view, issuerId: issuer.id })
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
            disabled={view.approving}
            onClick={() => {
              io.assign(deniedRedirect(preview.redirectUri, request.state))
            }}
            type="button"
          >
            {copy.deny}
          </button>
          <button
            class="btn btn-primary flex-1"
            disabled={view.approving || view.issuerId === ''}
            onClick={() => {
              approve(view)
            }}
            type="button"
          >
            {view.approving ? copy.approving : copy.approve}
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
          <h1 class="dash-auth-title">{copy.title}</h1>
          {body()}
        </section>
      </div>
    </main>
  )
}
