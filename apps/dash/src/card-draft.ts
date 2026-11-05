import { useSyncExternalStore } from 'preact/compat'

import type { DesignerForm } from './card-designer.ts'

// The card form while the operator steps out to edit the profile and back
// (docs/specs/pass-types-and-flows.md): page memory only, so a reload, a
// successful create or a sign-out (a full navigation) drops it. It is module
// state because it must outlive the card page without a layout above it
// holding it; a server render never reads or writes it, so no request's draft
// can reach another.
let draft: DesignerForm | null = null
const listeners = new Set<() => void>()

export const cardDraft = (): DesignerForm | null => draft

export const setCardDraft = (next: DesignerForm | null): void => {
  if (!('window' in globalThis) || next === draft) {
    return
  }
  draft = next
  for (const listener of listeners) {
    listener()
  }
}

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useCardDraft = (): DesignerForm | null => useSyncExternalStore(subscribe, cardDraft, () => null)
