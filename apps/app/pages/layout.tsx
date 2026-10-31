import '../src/styles.css'
import type { JSX } from 'solid-js'

export default function Layout(props: { children?: JSX.Element }): JSX.Element {
  return <div class="app-frame">{props.children}</div>
}
