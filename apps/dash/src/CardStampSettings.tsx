/** @jsxImportSource hono/jsx/dom */
import { useCallback } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import { StampSettings } from './StampSettings.tsx'
import type { StampSettingsProps } from './StampSettings.tsx'

export interface CardStampIo {
  load: (cardId: string) => ReturnType<StampSettingsProps['load']>
  save: (
    cardId: string,
    value: Parameters<StampSettingsProps['save']>[0],
  ) => ReturnType<StampSettingsProps['save']>
}

export const CardStampSettings = ({
  cardId,
  copy,
  settings,
}: {
  cardId: string
  copy: DashCopy['stamps']
  settings: CardStampIo
}): JSX.Element => {
  const load = useCallback(async () => await settings.load(cardId), [cardId, settings.load])
  const save = useCallback(
    async (value: Parameters<StampSettingsProps['save']>[0]) => await settings.save(cardId, value),
    [cardId, settings.save],
  )
  return <StampSettings copy={copy} load={load} save={save} />
}
