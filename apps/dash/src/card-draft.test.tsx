// @vitest-environment happy-dom
import { renderToString } from 'preact-render-to-string'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_FORM } from './card-designer.ts'
import { cardDraft, setCardDraft, useCardDraft } from './card-draft.ts'
import { CardDesigner } from './CardDesigner.tsx'
import { DASH_COPY } from './copy.ts'
import { act, cleanup, mount, open } from './test/render.tsx'

const noop = (): void => {
  // A handler these cases do not observe.
}

const designer = (onEditProfile: (form: typeof EMPTY_FORM) => void) => (
  <CardDesigner
    busy={false}
    copy={DASH_COPY.en.designer}
    failure={null}
    initialDraft={{ ...EMPTY_FORM, title: 'Old card' }}
    issuer={null}
    onCheckSlug={async () => await Promise.resolve('available')}
    onDraftChange={setCardDraft}
    onEditProfile={onEditProfile}
    onSubmit={noop}
  />
)

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

  it('ignores a location answer that arrives after the designer left', () => {
    const answers: PositionCallback[] = []
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (success: PositionCallback) => {
          answers.push(success)
        },
      },
    })
    const view = open(designer(noop))
    const toggle = view.host.querySelector<HTMLInputElement>('#lock-screen')
    act(() => {
      if (toggle !== null) {
        toggle.checked = true
        toggle.dispatchEvent(new Event('input', { bubbles: true }))
      }
    })
    cleanup()
    setCardDraft({ ...EMPTY_FORM, title: 'New card' })
    const [answer] = answers
    expect(answer).toBeDefined()
    // SAFETY: the designer reads only coords from the position.
    answer?.({ coords: { latitude: 35, longitude: 139 } } as GeolocationPosition)
    expect(cardDraft()?.title).toBe('New card')
    vi.unstubAllGlobals()
  })

  it('hands the profile link an input from the same tick, before any rerender', () => {
    const handed: string[] = []
    const view = open(
      designer((form) => {
        handed.push(form.title)
      }),
    )
    const title = view.host.querySelector<HTMLInputElement>('#card-title')
    if (title !== null) {
      title.value = 'Last keystroke'
      title.dispatchEvent(new Event('input', { bubbles: true }))
    }
    view.host.querySelector<HTMLAnchorElement>('a[href="/profile"]')?.click()
    expect(handed).toStrictEqual(['Last keystroke'])
  })
})
