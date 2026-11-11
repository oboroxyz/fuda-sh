import type { CardView, CardUpdateRequest, CardUpdateResponse, IssuerView, OperatorCardView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'

import { cardUpdateBodyFrom, formFromCard } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { CardRequirementSections } from './CardRequirements.tsx'
import { CardStampSettings } from './CardStampSettings.tsx'
import type { CardStampIo } from './CardStampSettings.tsx'
import type { DashCopy } from './copy.ts'
import { IntegrationSettings } from './IntegrationSettings.tsx'
import type { CardIntegrationsIo } from './IntegrationSettings.tsx'
import { settled } from './network-result.ts'
import { isPlainClick } from './plain-click.ts'
import type { DashRoute } from './router.ts'
import { useLifetime } from './use-lifetime.ts'

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

// Each optional service opens on demand, so its settings load only when the operator asks.
const StampsOption = (props: {
  busy: boolean
  cardId: string
  copy: DashCopy
  onToggle: (open: boolean) => void
  open: boolean
  settings: CardStampIo
}): JSX.Element => {
  const { open } = props
  return (
    <details
      class="rounded-box border border-[var(--fuda-border)]"
      open={open}
      onToggle={(event) => {
        props.onToggle(event.currentTarget.open)
      }}
    >
      <summary class="cursor-pointer p-4 font-semibold">{props.copy.management.stampOption}</summary>
      {open ? (
        <fieldset class="min-w-0 p-4 pt-0" disabled={props.busy}>
          <p class="mb-3 text-sm text-[var(--fuda-muted)]">{props.copy.management.stampHint}</p>
          <CardStampSettings cardId={props.cardId} copy={props.copy.stamps} settings={props.settings} />
        </fieldset>
      ) : null}
    </details>
  )
}

const IntegrationsOption = (props: {
  busy: boolean
  cardId: string
  copy: DashCopy
  integrations: CardIntegrationsIo
  onToggle: (open: boolean) => void
  open: boolean
}): JSX.Element => {
  const { open } = props
  return (
    <details
      class="rounded-box border border-[var(--fuda-border)]"
      data-testid="card-integrations"
      open={open}
      onToggle={(event) => {
        props.onToggle(event.currentTarget.open)
      }}
    >
      <summary class="cursor-pointer p-4 font-semibold">{props.copy.management.integrationsOption}</summary>
      {open ? (
        <fieldset class="min-w-0 p-4 pt-0" disabled={props.busy}>
          <p class="mb-3 text-sm text-[var(--fuda-muted)]">{props.copy.management.integrationsHint}</p>
          <IntegrationSettings cardId={props.cardId} copy={props.copy.integrations} io={props.integrations} />
        </fieldset>
      ) : null}
    </details>
  )
}

// Mounted once per loaded Card: the form starts from that Card and keeps its own draft.
const LoadedCardEditor = (props: EditorProps): JSX.Element => {
  const initial = props.card
  const [draft, setDraft] = useState(() => formFromCard(initial))
  const [savedCard, setSavedCard] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [stampsOpen, setStampsOpen] = useState(false)
  const [integrationsOpen, setIntegrationsOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const { mounted } = useLifetime()
  const saving = useRef(false)
  const changed = (form: DesignerForm): void => {
    setDraft(form)
    setSaved(false)
  }

  const submit = (form: DesignerForm): void => {
    if (saving.current) {
      return
    }
    const body = cardUpdateBodyFrom(form)
    if (body === null) {
      setFailed(true)
      return
    }
    saving.current = true
    setBusy(true)
    setSaved(false)
    setFailed(false)
    const run = async (): Promise<void> => {
      const result = await settled(async () => await props.save(initial.id, body))
      if (!mounted.current) {
        return
      }
      saving.current = false
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
        busy={busy}
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
        initialDraft={draft}
        issuer={props.issuer}
        onCheckSlug={available}
        onDraftChange={changed}
        onEditProfile={() => {
          props.onNavigate('/profile')
        }}
        onSubmit={submit}
      />
      <CardRequirementSections card={savedCard} copy={props.copy} />
      {failed ? (
        <p role="alert" class="text-error">
          {props.copy.management.saveFailed}
        </p>
      ) : null}
      {saved ? (
        <p role="status" class="text-sm">
          {props.copy.management.saved}
        </p>
      ) : null}
      {savedCard.identity !== 'sensitive' &&
      savedCard.identity !== 'address' &&
      savedCard.category === 'membership' &&
      draft.category === 'membership' ? (
        <StampsOption
          busy={busy}
          cardId={initial.id}
          copy={props.copy}
          onToggle={setStampsOpen}
          open={stampsOpen}
          settings={props.settings}
        />
      ) : null}
      {savedCard.identity === 'sensitive' ? null : (
        <IntegrationsOption
          busy={busy}
          cardId={initial.id}
          copy={props.copy}
          integrations={props.integrations}
          onToggle={setIntegrationsOpen}
          open={integrationsOpen}
        />
      )}
    </>
  )
}

// Mounted once per Card id: loads the operator view of that Card, then hands it
// to a fresh editor.
const CardEditorLoader = (props: CardEditPageProps & { cardId: string }): JSX.Element => {
  const [loaded, setLoaded] = useState<OperatorCardView | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
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
    return () => {
      current = false
    }
  }, [attempt])

  return loaded === null ? (
    <div class="flex flex-col items-start gap-3" role={failed ? 'alert' : 'status'}>
      <p>{failed ? props.copy.management.loadFailed : props.copy.management.loading}</p>
      {failed ? (
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
  ) : (
    <LoadedCardEditor
      key={loaded.id}
      card={loaded}
      copy={props.copy}
      integrations={props.integrations}
      issuer={props.issuer}
      onNavigate={props.onNavigate}
      save={props.save}
      settings={props.settings}
    />
  )
}

export const CardEditPage = (props: CardEditPageProps): JSX.Element => (
  <section class="dash-page flex max-w-2xl flex-col gap-6">
    <a
      class="link link-hover self-start text-sm"
      href="/cards"
      onClick={(event) => {
        if (!isPlainClick(event)) {
          return
        }
        event.preventDefault()
        props.onNavigate('/cards')
      }}
    >
      {props.copy.management.back}
    </a>
    {props.card === null ? (
      <h1 class="dash-page-title">{props.copy.stamps.cardNotFound}</h1>
    ) : (
      // A different card starts a fresh load and a fresh editor.
      <CardEditorLoader key={props.card.id} {...props} cardId={props.card.id} />
    )}
  </section>
)
