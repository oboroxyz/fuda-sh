import type { JSX } from 'solid-js'

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
}): JSX.Element => (
  <StampSettings
    copy={props.copy}
    load={async () => await props.settings.load(props.cardId)}
    save={async (value) => await props.settings.save(props.cardId, value)}
  />
)
