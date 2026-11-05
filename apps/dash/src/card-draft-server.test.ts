// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { EMPTY_FORM } from './card-designer.ts'
import { cardDraft, setCardDraft } from './card-draft.ts'

describe('card draft store without a window', () => {
  it('ignores a write, so no request can leave a draft for the next one', () => {
    setCardDraft({ ...EMPTY_FORM, title: 'From a request' })
    expect(cardDraft()).toBeNull()
  })
})
