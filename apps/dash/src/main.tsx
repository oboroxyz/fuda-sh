import { applyThemeMode, readThemeMode } from '@fuda/ui/solid'
import { render } from 'solid-js/web'

import { App } from './App.tsx'

const initialTheme = readThemeMode()
applyThemeMode(initialTheme)
const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  render(() => <App initialTheme={initialTheme} />, root)
}
