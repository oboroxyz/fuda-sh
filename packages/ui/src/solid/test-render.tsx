import type { JSX } from 'solid-js'
/** @jsxImportSource solid-js */
import { render } from 'solid-js/web'

// Mounts a Solid tree into a fresh host on document.body; tests clear the body
// in afterEach.
export const mount = (view: () => JSX.Element): HTMLElement => {
  const host = document.createElement('div')
  document.body.append(host)
  render(view, host)
  return host
}
