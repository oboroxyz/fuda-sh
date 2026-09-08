/** @jsxImportSource hono/jsx/dom */
import { useEffect, useId, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import type { DashRoute, DashSurface } from './router.ts'
import { SignOutButton } from './SignOutButton.tsx'

export interface DashboardShellProps {
  appearance: JSX.Element
  children: JSX.Element
  copy: DashCopy
  hasIssuer: boolean
  onNavigate: (route: DashRoute) => void
  onSignOut: (() => void) | null
  route: DashRoute
  surface: DashSurface
}

interface NavigationProps {
  copy: DashCopy
  hasIssuer: boolean
  onNavigate: (route: DashRoute) => void
  onSelection?: () => void
  route: DashRoute
  surface: DashSurface
}

interface NavItem {
  label: string
  route: DashRoute
}

export const DASH_DESKTOP_MEDIA_QUERY = '(min-width: 64rem)'

export interface DesktopBreakpoint {
  addEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
  matches: boolean
  removeEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
}

const desktopBreakpoint = (): DesktopBreakpoint | null =>
  globalThis.matchMedia?.(DASH_DESKTOP_MEDIA_QUERY) ?? null

const isPrimaryNavigation = (event: MouseEvent): boolean =>
  event.button === 0 && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey

// The two surfaces never share a menu: an admin token runs the console, a
// passkey session runs one venue's card.
const navigationItems = (copy: DashCopy, surface: DashSurface, hasIssuer: boolean): readonly NavItem[] => {
  if (surface === 'admin') {
    return [
      { label: copy.nav.overview, route: '/' },
      { label: copy.nav.rights, route: '/rights' },
      { label: copy.nav.issue, route: '/issue' },
    ]
  }
  return hasIssuer
    ? [
        { label: copy.nav.venue, route: '/venue' },
        { label: copy.nav.card, route: '/published' },
        { label: copy.nav.newCard, route: '/new' },
      ]
    : [{ label: copy.nav.venue, route: '/venue' }]
}

const navigationIcon = (route: DashRoute): JSX.Element => {
  const paths = {
    '/': 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    '/issue': 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    '/new': 'M4 5h16v14H4z M8 12h8 M12 8v8',
    '/published': 'M3 7h18v13H3z M6 4h12 M3 11h18',
    '/rights': 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
    '/venue': 'M4 21V10l8-7 8 7v11 M9 21v-6h6v6',
  }
  return (
    <svg
      aria-hidden="true"
      class="size-5 shrink-0"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <path d={paths[route]} stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

const Navigation = ({
  copy,
  hasIssuer,
  onNavigate,
  onSelection,
  route,
  surface,
}: NavigationProps): JSX.Element => (
  <nav aria-label={copy.chrome.navigation}>
    <ul class="menu w-full gap-1 p-0">
      {navigationItems(copy, surface, hasIssuer).map((item): JSX.Element => (
        <li key={item.route}>
          <a
            aria-current={route === item.route ? 'page' : undefined}
            class={route === item.route ? 'menu-active' : ''}
            href={item.route}
            onClick={(event: MouseEvent): void => {
              if (!isPrimaryNavigation(event)) {
                return
              }
              event.preventDefault()
              onSelection?.()
              onNavigate(item.route)
            }}
          >
            {navigationIcon(item.route)}
            <span>{item.label}</span>
          </a>
        </li>
      ))}
    </ul>
  </nav>
)

export const DashboardShell = ({
  appearance,
  children,
  copy,
  hasIssuer,
  onNavigate,
  onSignOut,
  route,
  surface,
}: DashboardShellProps): JSX.Element => {
  const drawerId = useId()
  const [open, setOpen] = useState(false)
  const [desktop, setDesktop] = useState(() => desktopBreakpoint()?.matches ?? false)
  const opener = useRef<HTMLButtonElement | null>(null)
  const sidebar = useRef<HTMLElement | null>(null)
  const modal = open && !desktop
  const restoreFocus = useRef(false)
  const closeDrawer = (): void => {
    restoreFocus.current = true
    setOpen(false)
  }

  const previousRoute = useRef(route)
  useEffect(() => {
    if (previousRoute.current !== route) {
      previousRoute.current = route
      if (open) {
        closeDrawer()
      }
    }
  }, [route])

  useEffect(() => {
    const breakpoint = desktopBreakpoint()
    if (breakpoint === null) {
      return
    }
    const changed = (event: MediaQueryListEvent): void => {
      setDesktop(event.matches)
      if (event.matches) {
        setOpen(false)
      }
    }
    breakpoint.addEventListener('change', changed)
    return () => {
      breakpoint.removeEventListener('change', changed)
    }
  }, [])

  useEffect(() => {
    if (modal) {
      sidebar.current?.querySelector<HTMLElement>('button, a')?.focus()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      opener.current?.focus()
    }
  }, [modal])

  return (
    <div class="dash-app drawer lg:drawer-open">
      <input
        id={drawerId}
        class="drawer-toggle"
        type="checkbox"
        checked={open}
        tabIndex={-1}
        aria-label={copy.chrome.openMenu}
        onChange={(event) => {
          if (event.currentTarget instanceof HTMLInputElement) {
            setOpen(event.currentTarget.checked)
          }
        }}
      />
      <div class="drawer-content dash-workspace" inert={modal}>
        <header class="dash-mobile-header">
          <div>
            <p class="font-bold">{copy.chrome.brand}</p>
            <p class="text-xs opacity-70">{copy.chrome.subtitle}</p>
          </div>
          <button
            ref={opener}
            aria-label={copy.chrome.openMenu}
            aria-expanded={open}
            aria-controls={`${drawerId}-side`}
            class="btn btn-ghost btn-square ml-auto"
            type="button"
            onClick={() => {
              setOpen(true)
            }}
          >
            <span aria-hidden="true">☰</span>
          </button>
        </header>
        <main class="dash-main">{children}</main>
      </div>
      <div class="drawer-side z-30 lg:z-auto">
        <label
          for={drawerId}
          class="drawer-overlay"
          aria-label={copy.chrome.closeMenu}
          onClick={(event) => {
            event.preventDefault()
            closeDrawer()
          }}
        />
        <aside
          ref={sidebar}
          id={`${drawerId}-side`}
          class="dash-sidebar"
          role={modal ? 'dialog' : undefined}
          aria-modal={modal ? 'true' : undefined}
          aria-label={copy.chrome.navigation}
          onKeyDown={(event) => {
            if (event.target instanceof Element && event.target.closest('dialog') !== null) {
              return
            }
            if (!modal) {
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              closeDrawer()
              return
            }
            if (event.key !== 'Tab') {
              return
            }
            const controls = [
              ...(sidebar.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []),
            ]
            const visibleControls = controls.filter(
              (element) => element.closest('dialog:not([open]), [hidden], [inert]') === null,
            )
            const [first] = visibleControls
            const last = visibleControls.at(-1)
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault()
              last?.focus()
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault()
              first?.focus()
            }
          }}
        >
          <div class="flex items-start justify-between gap-2">
            <div>
              <p class="text-xl font-bold">{copy.chrome.brand}</p>
              <p class="text-sm opacity-70">{copy.chrome.subtitle}</p>
            </div>
            <button
              class="dash-drawer-close btn btn-ghost btn-square"
              aria-label={copy.chrome.closeMenu}
              type="button"
              onClick={closeDrawer}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {Navigation({
            copy,
            hasIssuer,
            onNavigate,
            onSelection: () => {
              if (open) {
                closeDrawer()
              }
            },
            route,
            surface,
          })}
          <div class="mt-auto flex flex-col gap-3">
            {onSignOut === null ? null : <SignOutButton copy={copy.auth} onSignOut={onSignOut} />}
            {appearance}
          </div>
        </aside>
      </div>
    </div>
  )
}
