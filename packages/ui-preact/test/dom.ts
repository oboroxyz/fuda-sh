import { render } from 'preact'
import type { ComponentChild } from 'preact'
import { act } from 'preact/test-utils'

interface MountedView {
  host: HTMLDivElement
  update: (view: ComponentChild) => void
  dispose: () => void
}

export const mount = (view: ComponentChild): MountedView => {
  const host = document.createElement('div')
  document.body.append(host)
  const update = (next: ComponentChild): void => {
    void act(() => {
      render(next, host)
    })
  }
  update(view)
  return {
    dispose: () => {
      update(null)
      host.remove()
    },
    host,
    update,
  }
}

export const settle = async (run?: () => void | Promise<void>): Promise<void> => {
  await act(async () => {
    await run?.()
  })
}
