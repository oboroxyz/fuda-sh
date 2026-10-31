import type { JSX } from 'solid-js'
import { lazy, Match, onMount, Show, Switch, createSignal } from 'solid-js'
import { Dynamic } from 'solid-js/web'

import { useApp } from '../../../src/page-context.tsx'
import { CardScreen } from '../../../src/venue/CardScreen.tsx'
import { VenueScreen } from '../../../src/venue/VenueScreen.tsx'
import type { Props } from './index.server.ts'

// The card body depends on what this device remembers (a card it already
// holds shows its pass), so the server renders the frame and the browser
// fills in the rest from the venue the Worker read.
const StorePreview = import.meta.env.DEV
  ? lazy(async () => {
      const preview = await import('../../../src/venue/StorePreview.tsx')
      return { default: preview.StorePreview }
    })
  : null

export default function VenuePage(props: Props): JSX.Element {
  const shared = useApp()
  // The preview reads its scene from the browser's URL, so it mounts there.
  const [mounted, setMounted] = createSignal(false)
  onMount(() => {
    setMounted(true)
  })
  return (
    <Switch>
      <Match when={props.preview && StorePreview !== null}>
        <Show when={mounted() && StorePreview}>{(Preview) => <Dynamic component={Preview()} />}</Show>
      </Match>
      <Match when={props.page.kind === 'card' ? props.page : null}>
        {(page) => (
          <CardScreen
            handle={page().handle}
            initial={props.venue}
            locale={shared.locale}
            slug={page().slug}
          />
        )}
      </Match>
      <Match when={props.page.kind === 'home'}>
        <VenueScreen handle={props.page.handle} initial={props.venue} locale={shared.locale} mode="home" />
      </Match>
      <Match when={props.page.kind === 'entry'}>
        <VenueScreen handle={props.page.handle} initial={props.venue} locale={shared.locale} mode="entry" />
      </Match>
    </Switch>
  )
}
