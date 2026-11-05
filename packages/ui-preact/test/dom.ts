import { render } from 'preact'
import type { ComponentChild } from 'preact'
import { act } from 'preact/test-utils'

interface MountedView {
  host: HTMLElement
  update: (view: ComponentChild) => void
  dispose: () => void
}

// Mounts into a fresh host on document.body, or into one the test owns; only a
// host made here is removed on dispose.
export const mount = (view: ComponentChild, owned?: HTMLElement): MountedView => {
  const host = owned ?? document.createElement('div')
  if (owned === undefined) {
    document.body.append(host)
  }
  const update = (next: ComponentChild): void => {
    void act(() => {
      render(next, host)
    })
  }
  update(view)
  return {
    dispose: () => {
      update(null)
      if (owned === undefined) {
        host.remove()
      }
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
