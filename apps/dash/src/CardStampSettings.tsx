import type { JSX } from 'preact'
import { useCallback } from 'preact/hooks'

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

export const CardStampSettings = (props: {
  cardId: string
  copy: DashCopy['stamps']
  settings: CardStampIo
}): JSX.Element => {
  const { cardId, settings } = props
  // StampSettings reloads when `load` changes, so the loader must only change with its card.
  const load = useCallback(async () => await settings.load(cardId), [settings.load, cardId])
  const save = useCallback(
    async (value: Parameters<StampSettingsProps['save']>[0]) => await settings.save(cardId, value),
    [settings.save, cardId],
  )
  return <StampSettings copy={props.copy} load={load} save={save} />
}
