// @vitest-environment happy-dom
import { renderToString } from 'preact-render-to-string'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_FORM } from './card-designer.ts'
import { cardDraft, setCardDraft, useCardDraft } from './card-draft.ts'
import { act, cleanup, mount } from './test/render.tsx'

const DraftTitle = () => {
  const draft = useCardDraft()
  return <output>{draft === null ? 'none' : draft.title}</output>
}

describe('card draft store', () => {
  afterEach(() => {
    cleanup()
    setCardDraft(null)
  })

  it('keeps the draft in module memory across a screen leaving and returning', () => {
    const first = mount(<DraftTitle />)
    expect(first.textContent).toBe('none')
    act(() => {
      setCardDraft({ ...EMPTY_FORM, title: 'Spring pass' })
    })
    expect(first.textContent).toBe('Spring pass')
    cleanup()
    expect(cardDraft()?.title).toBe('Spring pass')
    expect(mount(<DraftTitle />).textContent).toBe('Spring pass')
  })

  it('tells every mounted reader, and stops telling one that unmounted', () => {
    const first = mount(<DraftTitle />)
    const second = mount(<DraftTitle />)
    act(() => {
      setCardDraft({ ...EMPTY_FORM, title: 'One' })
    })
    expect([first.textContent, second.textContent]).toStrictEqual(['One', 'One'])
    const renders = vi.fn<() => void>()
    const Counted = () => {
      renders()
      return <DraftTitle />
    }
    const third = mount(<Counted />)
    cleanup()
    renders.mockClear()
    act(() => {
      setCardDraft({ ...EMPTY_FORM, title: 'Two' })
    })
    expect(renders).not.toHaveBeenCalled()
    expect(third.textContent).toBe('')
  })

  it('does not notify when the same draft is set again', () => {
    const draft = { ...EMPTY_FORM, title: 'Same' }
    setCardDraft(draft)
    const renders = vi.fn<() => void>()
    const Counted = () => {
      renders()
      return <DraftTitle />
    }
    mount(<Counted />)
    renders.mockClear()
    act(() => {
      setCardDraft(draft)
    })
    expect(renders).not.toHaveBeenCalled()
  })

  it('renders as if there were no draft on the server, whatever the browser holds', () => {
    setCardDraft({ ...EMPTY_FORM, title: 'Private to this browser' })
    expect(renderToString(<DraftTitle />)).toBe('<output>none</output>')
  })
})
