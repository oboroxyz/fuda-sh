/** @jsxImportSource hono/jsx/dom */
import { applyThemeMode, readThemeMode } from '@fuda/ui'
import { render } from 'hono/jsx/dom'

import { App } from './App.tsx'

const initialTheme = readThemeMode()
applyThemeMode(initialTheme)
const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  render(<App initialTheme={initialTheme} />, root)
}
