/** @jsxImportSource hono/jsx/dom */
import { cn } from 'cn'
import { useEffect, useId, useRef, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import type { DashRoute, DashSurface } from './router.ts'
import { SignOutButton } from './SignOutButton.tsx'

export interface DashboardShellProps {
  appearance: JSX.Element
  venue?: { name: string; publicUrl: string | null } | null
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

export const DASH_DESKTOP_MEDIA_QUERY = '(min-width: 48rem)'

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
        { label: copy.nav.reception, route: '/reception' },
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
    '/reception': 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 14h2v6h-6v-2',
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
            class={cn('dash-menu-item', route === item.route && 'menu-active')}
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

const Brand = ({ copy }: { copy: DashCopy['chrome'] }): JSX.Element => (
  <div>
    <p class="flex items-center gap-2 text-xl font-bold">
      <svg
        aria-hidden="true"
        class="size-8 shrink-0"
        fill="none"
        viewBox="0 0 260 260"
        stroke="currentColor"
        stroke-width="15"
      >
        <path
          d="m130 54 63 50v128h-126v-128z M119 98a11 11 0 1 0 22 0 11 11 0 1 0-22 0 M130 28v20"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      <span>{copy.brand}</span>
    </p>
    <p class="font-display mt-2 hidden px-1.5 opacity-70 md:block">{copy.subtitle}</p>
  </div>
)

export const DashboardShell = ({
  appearance,
  venue = null,
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
    <div class="dash-app drawer md:drawer-open min-h-svh bg-[var(--fuda-bg)] text-[var(--fuda-text)] print:block">
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
      <div class="drawer-content min-w-0" inert={modal}>
        <header class="sticky top-0 z-20 flex items-center gap-4 border-b border-[var(--fuda-border)] bg-[var(--fuda-surface)] px-4 py-2 md:hidden print:hidden!">
          <Brand copy={copy.chrome} />
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
        <main class="mx-auto w-full max-w-6xl min-w-0 p-4 sm:p-6 lg:p-8 print:p-0">{children}</main>
      </div>
      <div class="drawer-side z-30 md:z-auto">
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
          class="dash-sidebar flex min-h-dvh w-64 flex-col gap-8 border-r border-[var(--fuda-border)] bg-[var(--fuda-surface)] py-6 print:hidden!"
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
          <div class="flex items-start justify-between gap-2 px-5">
            <Brand copy={copy.chrome} />
            <button
              class="btn btn-ghost btn-square md:hidden!"
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
            {surface === 'operator' && venue !== null ? (
              <div class="min-w-0 space-y-1 border-t px-5 pt-5">
                <p class="font-semibold wrap-anywhere">{venue.name}</p>
                {venue.publicUrl === null ? null : (
                  <a
                    class="link link-hover block text-xs wrap-anywhere opacity-70"
                    href={venue.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {venue.publicUrl}
                  </a>
                )}
              </div>
            ) : null}
            {onSignOut === null ? null : <SignOutButton copy={copy.auth} onSignOut={onSignOut} menu />}
            <div class="px-5">{appearance}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
