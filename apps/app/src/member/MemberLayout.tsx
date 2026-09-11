/** @jsxImportSource hono/jsx/dom */
import { DEFAULT_LOCALE, pick } from '@fuda/i18n'
import type { Locale } from '@fuda/i18n'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { Route } from '../route.ts'
import { MEMBER_COPY } from './copy.ts'

export type MemberRoute = Extract<Route, 'private' | 'rights' | 'settings' | 'signed'>

const LINKS: readonly { href: string; route: MemberRoute }[] = [
  { href: '/rights', route: 'rights' },
  { href: '/signed', route: 'signed' },
  { href: '/private', route: 'private' },
  { href: '/settings', route: 'settings' },
]

const DockIcon = ({ route }: { route: MemberRoute }): JSX.Element => {
  if (route === 'rights') {
    return <path d="M5 5.5h14v13H5zM8 9h8M8 12h8M8 15h5" />
  }
  if (route === 'signed') {
    return <path d="M4 12h14m-5-5 5 5-5 5M7 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" />
  }
  if (route === 'private') {
    return <path d="M12 3a4 4 0 0 0-4 4v3m8 0V7a4 4 0 0 0-1-2.7M5 10h14v11H5zM12 14v3" />
  }
  return (
    <path d="M19.31 8.75L21.70 9.58L21.70 14.42L19.31 15.25L18.47 16.70L18.95 19.19L14.76 21.61L12.84 19.96L11.16 19.96L9.24 21.61L5.05 19.19L5.53 16.70L4.69 15.25L2.30 14.42L2.30 9.58L4.69 8.75L5.53 7.30L5.05 4.81L9.24 2.39L11.16 4.04L12.84 4.04L14.76 2.39L18.95 4.81L18.47 7.30Z M15.5 12a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0" />
  )
}

export const MemberLayout = ({
  locale = DEFAULT_LOCALE,
  children,
  navigate,
  route,
}: {
  locale?: Locale
  children: JSX.Element
  navigate: (path: string) => void
  route: MemberRoute
}): JSX.Element => {
  const copy = pick(MEMBER_COPY, locale)
  return (
    <div class="member-shell">
      {children}
      <nav aria-label={copy.nav.label} class="dock member-dock">
        {LINKS.map((link): JSX.Element => (
          <a
            aria-current={route === link.route ? 'page' : undefined}
            class={route === link.route ? 'dock-active' : undefined}
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
                navigate(link.href)
              }
            }}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <DockIcon route={link.route} />
            </svg>
            <span class="dock-label">{copy.nav[link.route]}</span>
          </a>
        ))}
      </nav>
    </div>
  )
}
