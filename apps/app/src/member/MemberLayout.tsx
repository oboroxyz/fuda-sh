/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { Route } from '../route.ts'

export type MemberRoute = Extract<Route, 'private' | 'rights' | 'settings' | 'signed'>

const LINKS: readonly { href: string; label: string; route: MemberRoute }[] = [
  { href: '/rights', label: 'Your passes', route: 'rights' },
  { href: '/signed', label: 'Enter', route: 'signed' },
  { href: '/private', label: '+Private', route: 'private' },
  { href: '/settings', label: 'Settings', route: 'settings' },
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
    <path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2m9-9h-2M5 12H3m15.4-6.4L17 7M7 17l-1.4 1.4m12.8 0L17 17M7 7 5.6 5.6" />
  )
}

export const MemberLayout = ({
  children,
  navigate,
  route,
}: {
  children: JSX.Element
  navigate: (path: string) => void
  route: MemberRoute
}): JSX.Element => (
  <div class="member-shell">
    {children}
    <nav aria-label="Member navigation" class="dock member-dock">
      {LINKS.map((link): JSX.Element => (
        <a
          aria-current={route === link.route ? 'page' : undefined}
          class={route === link.route ? 'dock-active' : undefined}
          href={link.href}
          onClick={(event) => {
            if (event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
              event.preventDefault()
              navigate(link.href)
            }
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <DockIcon route={link.route} />
          </svg>
          <span class="dock-label">{link.label}</span>
        </a>
      ))}
    </nav>
  </div>
)
