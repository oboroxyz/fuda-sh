import type {
  ConnectedAppEventView,
  ConnectedAppGrantView,
  ConnectedAppRequest,
  ConnectedAppView,
} from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { createEffect, createSignal, on, onCleanup } from 'solid-js'
import type { JSX } from 'solid-js'

import type { AppsCopy } from './apps-copy.ts'
import { formatInstant } from './card-designer.ts'

// docs/specs/connected-apps.md#registering-an-app — the operator's own apps and
// the approvals they have given, each of which can be ended here.
export interface ConnectedAppsIo {
  activity: () => Promise<Result<{ events: ConnectedAppEventView[] }>>
  grants: () => Promise<Result<{ grants: ConnectedAppGrantView[] }>>
  list: () => Promise<Result<{ apps: ConnectedAppView[] }>>
  register: (body: ConnectedAppRequest) => Promise<Result<{ app: ConnectedAppView }>>
  remove: (clientId: string) => Promise<Result<{ deleted: true }>>
  revoke: (id: string) => Promise<Result<{ revoked: true }>>
}

type Loaded =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | {
      kind: 'ready'
      apps: ConnectedAppView[]
      events: ConnectedAppEventView[]
      grants: ConnectedAppGrantView[]
    }

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

export const ConnectedAppsPage = (props: ConnectedAppsPageProps): JSX.Element => {
  const [loaded, setLoaded] = createSignal<Loaded>({ kind: 'loading' })
  const [revision, setRevision] = createSignal(0)
  const [name, setName] = createSignal('')
  const [redirects, setRedirects] = createSignal('')
  const [busy, setBusy] = createSignal(false)
  const [failure, setFailure] = createSignal<string | null>(null)
  const [confirming, setConfirming] = createSignal<string | null>(null)

  createEffect(
    on(revision, () => {
      let live = true
      const run = async (): Promise<void> => {
        const [apps, grants, activity] = await Promise.all([
          props.io.list(),
          props.io.grants(),
          props.io.activity(),
        ])
        if (!live) {
          return
        }
        setLoaded(
          apps.ok && grants.ok && activity.ok
            ? {
                apps: apps.body.apps,
                events: activity.body.events,
                grants: grants.body.grants,
                kind: 'ready',
              }
            : { kind: 'failed' },
        )
      }
      void run()
      onCleanup(() => {
        live = false
      })
    }),
  )

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
        setFailure(props.copy.actionFailed)
      }
    }
    void run()
  }

  const onRegister = (event: Event): void => {
    event.preventDefault()
    setBusy(true)
    setFailure(null)
    const run = async (): Promise<void> => {
      const result = await props.io.register({
        name: name().trim(),
        redirectUris: redirectLines(redirects()),
      })
      setBusy(false)
      if (result.ok) {
        setName('')
        setRedirects('')
        reload()
      } else {
        setFailure(registerFailure(props.copy, result.error))
      }
    }
    void run()
  }

  const lists = (): JSX.Element => {
    const current = loaded()
    if (current.kind === 'loading') {
      return <p role="status">{props.copy.loading}</p>
    }
    if (current.kind === 'failed') {
      return (
        <div class="flex items-center gap-3">
          <p role="alert">{props.copy.loadFailed}</p>
          <button class="btn btn-sm" onClick={reload} type="button">
            {props.copy.retry}
          </button>
        </div>
      )
    }
    return (
      <>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-bold">{props.copy.appsTitle}</h2>
          {current.apps.length === 0 ? <p class="text-[var(--fuda-muted)]">{props.copy.noApps}</p> : null}
          {current.apps.map((app): JSX.Element => (
            <article class="card border border-[var(--fuda-border)] p-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-1">
                  <h3 class="font-bold">{app.name}</h3>
                  <p class="text-sm">
                    <span class="text-[var(--fuda-muted)]">{props.copy.clientId}</span>{' '}
                    <code class="break-all select-all">{app.clientId}</code>
                  </p>
                  <p class="text-sm text-[var(--fuda-muted)]">{props.copy.redirectUris}</p>
                  <ul class="font-mono text-sm break-all">
                    {app.redirectUris.map((uri): JSX.Element => (
                      <li>{uri}</li>
                    ))}
                  </ul>
                </div>
                <button
                  class={confirming() === app.clientId ? 'btn btn-error btn-sm' : 'btn btn-sm'}
                  disabled={busy()}
                  onClick={() => {
                    if (confirming() === app.clientId) {
                      act(async () => await props.io.remove(app.clientId))
                    } else {
                      setConfirming(app.clientId)
                    }
                  }}
                  type="button"
                >
                  {confirming() === app.clientId ? props.copy.confirmDelete : props.copy.deleteApp}
                </button>
              </div>
            </article>
          ))}
        </section>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-bold">{props.copy.grantsTitle}</h2>
          {current.grants.length === 0 ? <p class="text-[var(--fuda-muted)]">{props.copy.noGrants}</p> : null}
          {current.grants.map((grant): JSX.Element => (
            <article class="card flex flex-row flex-wrap items-center justify-between gap-3 border border-[var(--fuda-border)] p-4">
              <div class="flex flex-col gap-1">
                <p>
                  <strong>{grant.appName}</strong> {props.copy.grantFor} {grant.issuer.name}{' '}
                  <span class="text-[var(--fuda-muted)]">@{grant.issuer.handle}</span>
                </p>
                <p class="text-sm text-[var(--fuda-muted)]">
                  {grant.scope.map((scope) => props.copy.scopes[scope]).join(' · ')} · {props.copy.expires}{' '}
                  {formatInstant(grant.expiresAt)} ·{' '}
                  {grant.lastUsedAt === null
                    ? props.copy.neverUsed
                    : `${props.copy.lastUsed} ${formatInstant(grant.lastUsedAt)}`}
                </p>
              </div>
              <button
                class="btn btn-sm"
                disabled={busy()}
                onClick={() => {
                  act(async () => await props.io.revoke(grant.id))
                }}
                type="button"
              >
                {props.copy.revoke}
              </button>
            </article>
          ))}
        </section>
        <section class="flex flex-col gap-3">
          <h2 class="text-lg font-bold">{props.copy.activityTitle}</h2>
          <p class="text-sm text-[var(--fuda-muted)]">{props.copy.activityHint}</p>
          {current.events.length === 0 ? (
            <p class="text-[var(--fuda-muted)]">{props.copy.noActivity}</p>
          ) : null}
          <ul class="flex flex-col gap-2">
            {current.events.map((event): JSX.Element => (
              <li class="flex flex-col gap-1 border-b border-[var(--fuda-border)] pb-2">
                <p>
                  <strong>{event.appName}</strong> · {props.copy.actions[event.action] ?? event.action}
                  {event.issuerHandle === null ? null : (
                    <span class="text-[var(--fuda-muted)]"> @{event.issuerHandle}</span>
                  )}
                  {event.error === null ? null : (
                    <span class="text-[var(--fuda-danger)]">
                      {' '}
                      · {props.copy.activityFailed} {props.copy.errorMessage(event.error)}
                    </span>
                  )}
                </p>
                <p class="text-sm text-[var(--fuda-muted)]">
                  {formatInstant(event.createdAt)}
                  {event.subject === null ? null : (
                    <span class="font-mono break-all"> · {event.subject}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </>
    )
  }

  return (
    <div class="flex max-w-3xl flex-col gap-8">
      <header class="flex flex-col gap-2">
        <h1 class="text-2xl font-bold">{props.copy.title}</h1>
        <p class="text-[var(--fuda-muted)]">{props.copy.description}</p>
      </header>
      <form class="card flex flex-col gap-3 border border-[var(--fuda-border)] p-4" onSubmit={onRegister}>
        <h2 class="text-lg font-bold">{props.copy.registerTitle}</h2>
        <label class="flex flex-col gap-1">
          <span class="text-sm">{props.copy.nameLabel}</span>
          <input
            class="input w-full"
            maxLength={60}
            onInput={(event: Event) => {
              setName(inputValue(event))
            }}
            required
            value={name()}
          />
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-sm">{props.copy.redirectLabel}</span>
          <textarea
            class="textarea w-full font-mono"
            onInput={(event: Event) => {
              setRedirects(inputValue(event))
            }}
            placeholder="https://your-app.figma.site/"
            required
            rows={3}
            value={redirects()}
          />
          <span class="text-sm text-[var(--fuda-muted)]">{props.copy.redirectHint}</span>
        </label>
        {failure() === null ? null : (
          <p role="alert" class="alert alert-error">
            {failure()}
          </p>
        )}
        <button class="btn btn-primary self-start" disabled={busy()} type="submit">
          {busy() ? props.copy.registering : props.copy.register}
        </button>
      </form>
      {lists()}
    </div>
  )
}
