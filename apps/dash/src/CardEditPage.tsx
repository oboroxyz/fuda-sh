import type { CardView, CardUpdateRequest, CardUpdateResponse, IssuerView, OperatorCardView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js'
import type { JSX } from 'solid-js'

import { cardUpdateBodyFrom, formFromCard } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { CardStampSettings } from './CardStampSettings.tsx'
import type { CardStampIo } from './CardStampSettings.tsx'
import type { DashCopy } from './copy.ts'
import { IntegrationSettings } from './IntegrationSettings.tsx'
import type { CardIntegrationsIo } from './IntegrationSettings.tsx'
import type { DashRoute } from './router.ts'

export interface CardEditPageProps {
  card: CardView | null
  issuer: IssuerView
  copy: DashCopy
  load: (cardId: string) => Promise<Result<CardUpdateResponse>>
  save: (cardId: string, body: CardUpdateRequest) => Promise<Result<CardUpdateResponse>>
  settings: CardStampIo
  integrations: CardIntegrationsIo
  onNavigate: (route: DashRoute) => void
}

const available = async (): Promise<'available'> => await Promise.resolve('available')

type EditorProps = Omit<CardEditPageProps, 'card' | 'load'> & { card: OperatorCardView }

// Mounted once per loaded Card: the form starts from that Card and keeps its own draft.
const LoadedCardEditor = (props: EditorProps): JSX.Element => {
  const initial = props.card
  const [draft, setDraft] = createSignal(formFromCard(initial))
  const [savedCard, setSavedCard] = createSignal(initial)
  const [busy, setBusy] = createSignal(false)
  const [saved, setSaved] = createSignal(false)
  const [failed, setFailed] = createSignal(false)
  const [stampsOpen, setStampsOpen] = createSignal(false)
  const [integrationsOpen, setIntegrationsOpen] = createSignal(false)
  let mounted = true
  let saving = false
  onCleanup(() => {
    mounted = false
  })
  const changed = (form: DesignerForm): void => {
    setDraft(form)
    setSaved(false)
  }

  const submit = (form: DesignerForm): void => {
    if (saving) {
      return
    }
    const body = cardUpdateBodyFrom(form)
    if (body === null) {
      setFailed(true)
      return
    }
    saving = true
    setBusy(true)
    setSaved(false)
    setFailed(false)
    const run = async (): Promise<void> => {
      let result: Result<CardUpdateResponse>
      try {
        result = await props.save(initial.id, body)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
      if (!mounted) {
        return
      }
      saving = false
      setBusy(false)
      if (result.ok) {
        setSavedCard(result.body.card)
        setSaved(true)
      } else {
        setFailed(true)
      }
    }
    void run()
  }

  return (
    <>
      <CardDesigner
        busy={busy()}
        editing
        copy={{
          ...props.copy.designer,
          description: props.copy.management.editDescription,
          submit: props.copy.management.save,
          submitting: props.copy.management.saving,
          title: props.copy.management.editCard,
        }}
        readonlySlugHint={props.copy.management.slugHint}
        failure={null}
        initialDraft={draft()}
        issuer={props.issuer}
        logoCopy={props.copy.logo}
        onCheckHandle={available}
        onCheckSlug={available}
        onDraftChange={changed}
        onEditProfile={() => {
          props.onNavigate('/profile')
        }}
        onSubmit={(_mode, form) => {
          submit(form)
        }}
      />
      {failed() ? (
        <p role="alert" class="text-error">
          {props.copy.management.saveFailed}
        </p>
      ) : null}
      {saved() ? (
        <p role="status" class="text-sm">
          {props.copy.management.saved}
        </p>
      ) : null}
      {savedCard().identity !== 'sensitive' &&
      savedCard().category === 'membership' &&
      draft().category === 'membership' ? (
        <details
          class="rounded-box border border-[var(--fuda-border)]"
          open={stampsOpen()}
          onToggle={(event) => {
            setStampsOpen(event.currentTarget.open)
          }}
        >
          <summary class="cursor-pointer p-4 font-semibold">{props.copy.management.stampOption}</summary>
          {stampsOpen() ? (
            <fieldset class="min-w-0 p-4 pt-0" disabled={busy()}>
              <p class="mb-3 text-sm text-[var(--fuda-muted)]">{props.copy.management.stampHint}</p>
              <CardStampSettings cardId={initial.id} copy={props.copy.stamps} settings={props.settings} />
            </fieldset>
          ) : null}
        </details>
      ) : null}
      {savedCard().identity === 'sensitive' ? null : (
        <details
          class="rounded-box border border-[var(--fuda-border)]"
          data-testid="card-integrations"
          open={integrationsOpen()}
          onToggle={(event) => {
            setIntegrationsOpen(event.currentTarget.open)
          }}
        >
          <summary class="cursor-pointer p-4 font-semibold">
            {props.copy.management.integrationsOption}
          </summary>
          {integrationsOpen() ? (
            <fieldset class="min-w-0 p-4 pt-0" disabled={busy()}>
              <p class="mb-3 text-sm text-[var(--fuda-muted)]">{props.copy.management.integrationsHint}</p>
              <IntegrationSettings
                cardId={initial.id}
                copy={props.copy.integrations}
                io={props.integrations}
              />
            </fieldset>
          ) : null}
        </details>
      )}
    </>
  )
}

// Mounted once per Card id: loads the operator view of that Card, then hands it
// to a fresh editor.
const CardEditorLoader = (props: CardEditPageProps & { cardId: string }): JSX.Element => {
  const [loaded, setLoaded] = createSignal<OperatorCardView | null>(null)
  const [failed, setFailed] = createSignal(false)
  const [attempt, setAttempt] = createSignal(0)
  createEffect(
    on(attempt, () => {
      let current = true
      setFailed(false)
      setLoaded(null)
      const run = async (): Promise<void> => {
        try {
          const result = await props.load(props.cardId)
          if (!current) {
            return
          }
          if (result.ok) {
            setLoaded(result.body.card)
          } else {
            setFailed(true)
          }
        } catch {
          if (current) {
            setFailed(true)
          }
        }
      }
      void run()
      onCleanup(() => {
        current = false
      })
    }),
  )

  return (
    <Show
      when={loaded()}
      keyed
      fallback={
        <div class="flex flex-col items-start gap-3" role={failed() ? 'alert' : 'status'}>
          <p>{failed() ? props.copy.management.loadFailed : props.copy.management.loading}</p>
          {failed() ? (
            <button
              class="btn btn-sm"
              type="button"
              onClick={() => {
                setAttempt((value) => value + 1)
              }}
            >
              {props.copy.management.retry}
            </button>
          ) : null}
        </div>
      }
    >
      {(card) => (
        <LoadedCardEditor
          card={card}
          copy={props.copy}
          integrations={props.integrations}
          issuer={props.issuer}
          onNavigate={props.onNavigate}
          save={props.save}
          settings={props.settings}
        />
      )}
    </Show>
  )
}

export const CardEditPage = (props: CardEditPageProps): JSX.Element => (
  <section class="dash-page flex max-w-2xl flex-col gap-6">
    <a
      class="link link-hover self-start text-sm"
      href="/cards"
      onClick={(event) => {
        if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
          return
        }
        event.preventDefault()
        props.onNavigate('/cards')
      }}
    >
      {props.copy.management.back}
    </a>
    <Show
      when={props.card?.id}
      keyed
      fallback={<h1 class="dash-page-title">{props.copy.stamps.cardNotFound}</h1>}
    >
      {(cardId) => <CardEditorLoader {...props} cardId={cardId} />}
    </Show>
  </section>
)
