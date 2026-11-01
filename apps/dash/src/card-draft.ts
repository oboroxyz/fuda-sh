import { createSignal } from 'solid-js'

import type { DesignerForm } from './card-designer.ts'

// The card form while the operator steps out to edit the profile and back
// (docs/specs/pass-types-and-flows.md): page memory only, so a reload, a
// successful create or a sign-out (a full navigation) drops it.
const [draft, setDraft] = createSignal<DesignerForm | null>(null)

export const cardDraft = draft
export const setCardDraft = setDraft
