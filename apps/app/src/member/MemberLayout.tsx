import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import { For, Match, Switch } from 'solid-js'
import type { JSX } from 'solid-js'

import type { Route } from '../route.ts'
import { MEMBER_COPY } from './copy.ts'

export type MemberRoute = Extract<Route, 'rights' | 'settings' | 'signed'>

const LINKS: readonly { href: string; route: MemberRoute }[] = [
  { href: '/rights', route: 'rights' },
  { href: '/signed', route: 'signed' },
  { href: '/settings', route: 'settings' },
]

const DockIcon = (props: { route: MemberRoute }): JSX.Element => (
  <Switch
    fallback={
      <path d="M19.31 8.75L21.70 9.58L21.70 14.42L19.31 15.25L18.47 16.70L18.95 19.19L14.76 21.61L12.84 19.96L11.16 19.96L9.24 21.61L5.05 19.19L5.53 16.70L4.69 15.25L2.30 14.42L2.30 9.58L4.69 8.75L5.53 7.30L5.05 4.81L9.24 2.39L11.16 4.04L12.84 4.04L14.76 2.39L18.95 4.81L18.47 7.30Z M15.5 12a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0" />
    }
  >
    <Match when={props.route === 'rights'}>
      <path d="M5 5.5h14v13H5zM8 9h8M8 12h8M8 15h5" />
    </Match>
    <Match when={props.route === 'signed'}>
      <path d="M4 12h14m-5-5 5 5-5 5M7 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
    </Match>
  </Switch>
)

export const MemberLayout = (props: {
  locale?: Locale
  children: JSX.Element
  navigate: (path: string) => void
  route: MemberRoute
}): JSX.Element => {
  const copy = (): (typeof MEMBER_COPY)[Locale] => pick(MEMBER_COPY, props.locale ?? DEFAULT_LOCALE)
  return (
    <div class="member-shell">
      {props.children}
      <nav aria-label={copy().nav.label} class="dock member-dock">
        <For each={LINKS}>
          {(link) => (
            <a
              aria-current={props.route === link.route ? 'page' : undefined}
              class={props.route === link.route ? 'dock-active' : undefined}
              href={link.href}
              onClick={(event) => {
                if (
                  event.button === 0 &&
                  !event.altKey &&
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey
                ) {
                  event.preventDefault()
                  props.navigate(link.href)
                }
              }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <DockIcon route={link.route} />
              </svg>
              <span class="dock-label">{copy().nav[link.route]}</span>
            </a>
          )}
        </For>
      </nav>
    </div>
  )
}
