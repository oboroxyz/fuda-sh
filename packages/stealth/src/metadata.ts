import type { Hex } from 'viem'

import { METADATA_RE } from './constants.ts'

export interface AnnouncementMetadata {
  viewTag: number
  uid: Hex
}

// Annotated (not cast): the template literal is contextually typed as Hex.
export const buildAnnouncementMetadata = (viewTag: number, uid: Hex): Hex =>
  `0x${viewTag.toString(16).padStart(2, '0')}${uid.slice(2).toLowerCase()}`

export const parseAnnouncementMetadata = (hex: string): AnnouncementMetadata | null => {
  if (!METADATA_RE.test(hex)) {
    return null
  }
  const body = hex.slice(2).toLowerCase()
  const uid: Hex = `0x${body.slice(2)}`
  return { uid, viewTag: Number.parseInt(body.slice(0, 2), 16) }
}
