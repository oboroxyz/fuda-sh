/** @jsxImportSource hono/jsx/dom */
import type { CardView } from '@fuda/sdk'
import { useCallback } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { StampSettings } from './StampSettings.tsx'
import type { StampSettingsProps } from './StampSettings.tsx'

export interface CardStampSettingsPageProps {
  card: CardView | null
  copy: DashCopy
  onBack: () => void
  settings: {
    load: (cardId: string) => ReturnType<StampSettingsProps['load']>
    save: (
      cardId: string,
      value: Parameters<StampSettingsProps['save']>[0],
    ) => ReturnType<StampSettingsProps['save']>
  }
}

// Keyed by card ID at the route boundary, so pending requests and drafts cannot
// survive navigation to a different Card. Callbacks stay stable within a Card.
const CardSettingsForm = ({
  cardId,
  copy,
  settings,
}: {
  cardId: string
  copy: DashCopy['stamps']
  settings: CardStampSettingsPageProps['settings']
}): JSX.Element => {
  const load = useCallback(async () => await settings.load(cardId), [cardId, settings.load])
  const save = useCallback(
    async (value: Parameters<StampSettingsProps['save']>[0]) => await settings.save(cardId, value),
    [cardId, settings.save],
  )
  return <StampSettings copy={copy} load={load} save={save} />
}

export const CardStampSettingsPage = ({
  card,
  copy,
  onBack,
  settings,
}: CardStampSettingsPageProps): JSX.Element => (
  <section class="dash-page flex max-w-3xl flex-col gap-6">
    <div>
      <button class="btn btn-ghost" onClick={onBack} type="button">
        {copy.stamps.back}
      </button>
    </div>
    <header class="dash-page-header">
      <h1 class="dash-page-title">{card?.title ?? copy.stamps.cardNotFound}</h1>
      {card === null ? null : <p class="opacity-70">{copy.stamps.title}</p>}
    </header>
    {card === null ? null : (
      <CardSettingsForm key={card.id} cardId={card.id} copy={copy.stamps} settings={settings} />
    )}
  </section>
)
