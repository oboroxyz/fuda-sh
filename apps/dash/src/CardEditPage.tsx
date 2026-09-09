/** @jsxImportSource hono/jsx/dom */
import type { CardView, CardUpdateRequest, CardUpdateResponse, IssuerView, OperatorCardView } from '@fuda/sdk'
import type { Result } from '@fuda/sdk/http'
import { useCallback, useEffect, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import { cardUpdateBodyFrom, formFromCard } from './card-designer.ts'
import type { DesignerForm } from './card-designer.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { CardStampSettings } from './CardStampSettings.tsx'
import type { CardStampIo } from './CardStampSettings.tsx'
import type { DashCopy } from './copy.ts'
import type { DashRoute } from './router.ts'

export interface CardEditPageProps {
  card: CardView | null
  issuer: IssuerView
  copy: DashCopy
  load: (cardId: string) => Promise<Result<CardUpdateResponse>>
  save: (cardId: string, body: CardUpdateRequest) => Promise<Result<CardUpdateResponse>>
  settings: CardStampIo
  onNavigate: (route: DashRoute) => void
}

const available = async (): Promise<'available'> => await Promise.resolve('available')

const LoadedCardEditor = ({
  card,
  copy,
  issuer,
  save,
  settings,
  onNavigate,
}: Omit<CardEditPageProps, 'card' | 'load'> & { card: OperatorCardView }): JSX.Element => {
  const [draft, setDraft] = useState(() => formFromCard(card))
  const [savedCard, setSavedCard] = useState(card)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [failed, setFailed] = useState(false)
  const [stampsOpen, setStampsOpen] = useState(false)
  const mounted = useRef(true)
  const saving = useRef(false)
  useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )
  const changed = useCallback((form: DesignerForm): void => {
    setDraft(form)
    setSaved(false)
  }, [])

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
      let result: Result<CardUpdateResponse>
      try {
        result = await save(card.id, body)
      } catch {
        result = { error: 'network', network: true, ok: false, status: 0 }
      }
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
          ...copy.designer,
          description: copy.management.editDescription,
          submit: copy.management.save,
          submitting: copy.management.saving,
          title: copy.management.editCard,
        }}
        readonlySlugHint={copy.management.slugHint}
        failure={null}
        initialDraft={draft}
        issuer={issuer}
        logoCopy={copy.logo}
        onCheckHandle={available}
        onCheckSlug={available}
        onDraftChange={changed}
        onEditProfile={() => {
          onNavigate('/profile')
        }}
        onSubmit={(_mode, form) => {
          submit(form)
        }}
      />
      {failed ? (
        <p role="alert" class="text-error">
          {copy.management.saveFailed}
        </p>
      ) : null}
      {saved ? (
        <p role="status" class="text-sm">
          {copy.management.saved}
        </p>
      ) : null}
      {savedCard.category === 'membership' && draft.category === 'membership' ? (
        <details
          class="rounded-box border border-[var(--fuda-border)]"
          open={stampsOpen}
          onToggle={(event: Event) => {
            if (event.currentTarget instanceof HTMLDetailsElement) {
              setStampsOpen(event.currentTarget.open)
            }
          }}
        >
          <summary class="cursor-pointer p-4 font-semibold">{copy.management.stampOption}</summary>
          {stampsOpen ? (
            <fieldset class="min-w-0 p-4 pt-0" disabled={busy}>
              <p class="mb-3 text-sm text-[var(--fuda-muted)]">{copy.management.stampHint}</p>
              <CardStampSettings cardId={card.id} copy={copy.stamps} settings={settings} />
            </fieldset>
          ) : null}
        </details>
      ) : null}
    </>
  )
}

const CardEditorLoader = ({
  card,
  ...props
}: Omit<CardEditPageProps, 'card'> & { card: CardView }): JSX.Element => {
  const [loaded, setLoaded] = useState<OperatorCardView | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setFailed(false)
    setLoaded(null)
    const run = async (): Promise<void> => {
      try {
        const result = await props.load(card.id)
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
  }, [card.id, props.load, attempt])

  if (loaded !== null) {
    return <LoadedCardEditor {...props} card={loaded} />
  }
  return (
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
  )
}

export const CardEditPage = ({ card, ...props }: CardEditPageProps): JSX.Element => (
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
    {card === null ? (
      <h1 class="dash-page-title">{props.copy.stamps.cardNotFound}</h1>
    ) : (
      <CardEditorLoader key={card.id} {...props} card={card} />
    )}
  </section>
)
