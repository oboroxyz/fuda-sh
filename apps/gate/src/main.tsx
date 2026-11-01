import { render } from 'solid-js/web'

import { App } from './App.tsx'

const root = document.querySelector<HTMLElement>('#root')
if (root !== null) {
  render(() => <App />, root)
}
