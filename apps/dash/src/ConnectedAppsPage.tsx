/** @jsxImportSource hono/jsx/dom */
import type { ConnectedAppGrantView, ConnectedAppRequest, ConnectedAppView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useEffect, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { AppsCopy } from './apps-copy.ts'
import { formatInstant } from './card-designer.ts'

// docs/specs/connected-apps.md#registering-an-app — the operator's own apps and
// the approvals they have given, each of which can be ended here.
export interface ConnectedAppsIo {
  grants: () => Promise<Result<{ grants: ConnectedAppGrantView[] }>>
  list: () => Promise<Result<{ apps: ConnectedAppView[] }>>
  register: (body: ConnectedAppRequest) => Promise<Result<{ app: ConnectedAppView }>>
  remove: (clientId: string) => Promise<Result<{ deleted: true }>>
  revoke: (id: string) => Promise<Result<{ revoked: true }>>
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'ready'; apps: ConnectedAppView[]; grants: ConnectedAppGrantView[] }

export const redirectLines = (text: string): string[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')

const inputValue = (event: Event): string =>
  event.currentTarget instanceof HTMLInputElement || event.currentTarget instanceof HTMLTextAreaElement
    ? event.currentTarget.value
    : ''

const registerFailure = (copy: AppsCopy, error: string): string => {
  if (error === 'bad_redirect_uri' || error === 'app_limit') {
    return copy.registerFailed[error]
  }
  return copy.registerFailed.other
}

export interface ConnectedAppsPageProps {
  copy: AppsCopy
  io: ConnectedAppsIo
}

export const ConnectedAppsPage = ({ copy, io }: ConnectedAppsPageProps): JSX.Element => {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [revision, setRevision] = useState(0)
  const [name, setName] = useState('')
  const [redirects, setRedirects] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    const run = async (): Promise<void> => {
      const [apps, grants] = await Promise.all([io.list(), io.grants()])
      if (!live) {
        return
      }
      setLoaded(
        apps.ok && grants.ok
          ? { apps: apps.body.apps, grants: grants.body.grants, kind: 'ready' }
          : { kind: 'failed' },
      )
    }
    void run()
    return () => {
      live = false
    }
  }, [revision])

  const reload = (): void => {
    setRevision((value) => value + 1)
  }

  const act = (action: () => Promise<Result<unknown>>): void => {
    setBusy(true)
    setFailure(null)
    const run = async (): Promise<void> => {
      const result = await action()
      setBusy(false)
      setConfirming(null)
      if (result.ok) {
        reload()
      } else {
        setFailure(copy.actionFailed)
      }
    }
    void run()
  }

  const onRegister = (event: Event): void => {
    event.preventDefault()
    setBusy(true)
    setFailure(null)
    const run = async (): Promise<void> => {
      const result = await io.register({ name: name.trim(), redirectUris: redirectLines(redirects) })
      setBusy(false)
      if (result.ok) {
        setName('')
        setRedirects('')
        reload()
      } else {
        setFailure(registerFailure(copy, result.error))
      }
    }
    void run()
  }

  const lists = (): JSX.Element => {
    if (loaded.kind === 'loading') {
      return <p role="status">{copy.loading}</p>
    }
    if (loaded.kind === 'failed') {
      return (
        <div class="flex items-center gap-3">
          <p role="alert">{copy.loadFailed}</p>
          <button class="btn btn-sm" onClick={reload} type="button">
            {copy.retry}
          </button>
        </div>
      )
    }
    return (
      <>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-bold">{copy.appsTitle}</h2>
          {loaded.apps.length === 0 ? <p class="text-[var(--fuda-muted)]">{copy.noApps}</p> : null}
          {loaded.apps.map((app): JSX.Element => (
            <article key={app.clientId} class="card border border-[var(--fuda-border)] p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <h3 class="font-bold">{app.name}</h3>
                  <p class="text-sm">
                    <span class="text-[var(--fuda-muted)]">{copy.clientId}</span>{' '}
                    <code class="break-all select-all">{app.clientId}</code>
                  </p>
                  <p class="text-sm text-[var(--fuda-muted)]">{copy.redirectUris}</p>
                  <ul class="font-mono text-sm break-all">
                    {app.redirectUris.map((uri): JSX.Element => (
                      <li key={uri}>{uri}</li>
                    ))}
                  </ul>
                </div>
                <button
                  class={confirming === app.clientId ? 'btn btn-error btn-sm' : 'btn btn-sm'}
                  disabled={busy}
                  onClick={() => {
                    if (confirming === app.clientId) {
                      act(async () => await io.remove(app.clientId))
                    } else {
                      setConfirming(app.clientId)
                    }
                  }}
                  type="button"
                >
                  {confirming === app.clientId ? copy.confirmDelete : copy.deleteApp}
                </button>
              </div>
            </article>
          ))}
        </section>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-bold">{copy.grantsTitle}</h2>
          {loaded.grants.length === 0 ? <p class="text-[var(--fuda-muted)]">{copy.noGrants}</p> : null}
          {loaded.grants.map((grant): JSX.Element => (
            <article
              key={grant.id}
              class="card flex flex-row flex-wrap items-center justify-between gap-3 border border-[var(--fuda-border)] p-4"
            >
              <div class="flex flex-col gap-1">
                <p>
                  <strong>{grant.appName}</strong> {copy.grantFor} {grant.issuer.name}{' '}
                  <span class="text-[var(--fuda-muted)]">@{grant.issuer.handle}</span>
                </p>
                <p class="text-sm text-[var(--fuda-muted)]">
                  {grant.scope.map((scope) => copy.scopes[scope]).join(' · ')} · {copy.expires}{' '}
                  {formatInstant(grant.expiresAt)}
                </p>
              </div>
              <button
                class="btn btn-sm"
                disabled={busy}
                onClick={() => {
                  act(async () => await io.revoke(grant.id))
                }}
                type="button"
              >
                {copy.revoke}
              </button>
            </article>
          ))}
        </section>
      </>
    )
  }

  return (
    <div class="flex max-w-3xl flex-col gap-8">
      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold">{copy.title}</h1>
        <p class="text-[var(--fuda-muted)]">{copy.description}</p>
      </header>
      <form class="card flex flex-col gap-3 border border-[var(--fuda-border)] p-4" onSubmit={onRegister}>
        <h2 class="text-lg font-bold">{copy.registerTitle}</h2>
        <label class="flex flex-col gap-1">
          <span class="text-sm">{copy.nameLabel}</span>
          <input
            class="input w-full"
            maxLength={60}
            onInput={(event: Event) => {
              setName(inputValue(event))
            }}
            required
            value={name}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm">{copy.redirectLabel}</span>
          <textarea
            class="textarea w-full font-mono"
            onInput={(event: Event) => {
              setRedirects(inputValue(event))
            }}
            placeholder="https://your-app.figma.site/"
            required
            rows={3}
            value={redirects}
          />
          <span class="text-sm text-[var(--fuda-muted)]">{copy.redirectHint}</span>
        </label>
        {failure === null ? null : (
          <p role="alert" class="alert alert-error">
            {failure}
          </p>
        )}
        <button class="btn btn-primary self-start" disabled={busy} type="submit">
          {busy ? copy.registering : copy.register}
        </button>
      </form>
      {lists()}
    </div>
  )
}
