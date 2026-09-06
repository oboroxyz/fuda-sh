/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'

import { App } from './App.tsx'

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  render(<App />, root)
}
