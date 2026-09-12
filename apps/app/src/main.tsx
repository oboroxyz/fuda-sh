/** @jsxImportSource hono/jsx/dom */
import { render } from 'hono/jsx/dom'

import { App } from './App.tsx'

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  if (import.meta.env.DEV && import.meta.env.VITE_STORE_PREVIEW === '1') {
    const { StorePreview } = await import('./venue/StorePreview.tsx')
    render(<StorePreview />, root)
  } else {
    render(<App />, root)
  }
}
