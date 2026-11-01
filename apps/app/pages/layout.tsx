import '../src/styles.css'
import type { JSX } from 'solid-js'

import { useApp } from '../src/page-context.tsx'
import { setPublicApiOrigin } from '../src/pass-links.ts'

export default function Layout(props: { children?: JSX.Element }): JSX.Element {
  setPublicApiOrigin(useApp().apiOrigin)
  return <div class="app-frame">{props.children}</div>
}
