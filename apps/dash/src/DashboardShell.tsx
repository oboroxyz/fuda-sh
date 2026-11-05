import { cn } from 'cn'
import type { ComponentChildren, JSX } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'

import type { DashCopy } from './copy.ts'
import { isPlainClick } from './plain-click.ts'
import { ProfileMenu } from './ProfileMenu.tsx'
import type { ProfileChoices } from './ProfileMenu.tsx'
import { navigationRoute } from './router.ts'
import type { DashRoute, DashSurface, MainDashRoute } from './router.ts'
import { SignOutButton } from './SignOutButton.tsx'

export interface DashboardShellProps {
  profiles?: ProfileChoices | null
  appearance: JSX.Element
  venue?: { name: string; publicUrl: string | null } | null
  children: ComponentChildren
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
  route: MainDashRoute
}

const DASH_DESKTOP_MEDIA_QUERY = '(min-width: 48rem)'

interface DesktopBreakpoint {
  addEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
  matches: boolean
  removeEventListener: (type: 'change', listener: (event: MediaQueryListEvent) => void) => void
}

const desktopBreakpoint = (): DesktopBreakpoint | null =>
  globalThis.matchMedia?.(DASH_DESKTOP_MEDIA_QUERY) ?? null

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
        { label: copy.nav.venue, route: '/profile' },
        { label: copy.nav.reception, route: '/reception' },
        { label: copy.nav.card, route: '/cards' },
        { label: copy.nav.passes, route: '/passes' },
        { label: copy.nav.apps, route: '/apps' },
      ]
    : [{ label: copy.nav.venue, route: '/start' }]
}

const navigationIcon = (route: MainDashRoute): JSX.Element => {
  const paths = {
    '/': 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    '/apps': 'M9 7H5v12h12v-4 M13 3h8v8 M21 3l-10 10',
    '/cards': 'M3 7h18v13H3z M6 4h12 M3 11h18',
    '/cards/new': 'M4 5h16v14H4z M8 12h8 M12 8v8',
    '/issue': 'M12 3v12 M7 10l5 5 5-5 M4 17v4h16v-4',
    '/passes': 'M3 5h18v14H3z M7 9h4 M7 13h6 M16 9h1 M16 13h1',
    '/profile': 'M4 21V10l8-7 8 7v11 M9 21v-6h6v6',
    '/profiles/new': 'M4 21V10l8-7 8 7v11 M12 11v6 M9 14h6',
    '/reception': 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h2v2h-2z M18 14h2v6h-6v-2',
    '/rights': 'M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5',
    '/start': 'M4 21V10l8-7 8 7v11 M9 21v-6h6v6',
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

const Navigation = (props: NavigationProps): JSX.Element => (
  <nav aria-label={props.copy.chrome.navigation}>
    <ul class="menu w-full gap-1.5 px-2 py-4">
      {navigationItems(props.copy, props.surface, props.hasIssuer).map((item) => (
        <li key={item.route}>
          <a
            aria-current={navigationRoute(props.route) === item.route ? 'page' : undefined}
            class={cn('dash-menu-item', navigationRoute(props.route) === item.route && 'menu-active')}
            href={item.route}
            onClick={(event) => {
              if (!isPlainClick(event)) {
                return
              }
              event.preventDefault()
              props.onSelection?.()
              props.onNavigate(item.route)
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

const Brand = (props: { copy: DashCopy['chrome'] }): JSX.Element => (
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
      <span>{props.copy.brand}</span>
    </p>
  </div>
)

const visibleControls = (sidebar: HTMLElement | null): HTMLElement[] =>
  [...(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])].filter(
    (element) => element.closest('dialog:not([open]), [hidden], [inert]') === null,
  )

const wrapTab = (event: KeyboardEvent, controls: HTMLElement[]): void => {
  const [first] = controls
  const last = controls.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last?.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first?.focus()
  }
}

// Keeps keyboard focus inside the drawer while it covers the page: Escape closes it
// and Tab wraps between its first and last visible control.
const keepFocusInDrawer = (
  event: KeyboardEvent,
  sidebar: HTMLElement | null,
  modal: boolean,
  close: () => void,
): void => {
  const inDialog = event.target instanceof Element && event.target.closest('dialog') !== null
  if (inDialog || !modal) {
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'Tab') {
    wrapTab(event, visibleControls(sidebar))
  }
}

// The mobile drawer: open state, the breakpoint that makes it permanent, closing on a
// route change and moving focus into it while it covers the page and back out after.
const useDrawer = (route: DashRoute) => {
  const [open, setOpen] = useState(false)
  const [desktop, setDesktop] = useState(() => desktopBreakpoint()?.matches ?? false)
  const opener = useRef<HTMLButtonElement>(null)
  const sidebar = useRef<HTMLElement>(null)
  const modal = open && !desktop
  const restoreFocus = useRef(false)
  const closeDrawer = (): void => {
    restoreFocus.current = true
    setOpen(false)
  }

  // A route change closes the drawer; the first render has no previous route.
  const previousRoute = useRef(route)
  useEffect(() => {
    if (previousRoute.current === route) {
      return
    }
    previousRoute.current = route
    if (open) {
      closeDrawer()
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
    if (!modal) {
      if (restoreFocus.current) {
        restoreFocus.current = false
        opener.current?.focus()
      }
      return
    }
    let frame = 0
    const focusDrawer = (): void => {
      const first = sidebar.current?.querySelector<HTMLElement>('button, a')
      if (!first || sidebar.current?.contains(document.activeElement) === true) {
        return
      }
      // daisyUI delays visibility while the drawer begins its transition.
      // Browsers ignore focus until that transition makes the control visible.
      if (getComputedStyle(first).visibility === 'hidden') {
        frame = requestAnimationFrame(focusDrawer)
        return
      }
      first.focus()
    }
    focusDrawer()
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [modal])

  return { closeDrawer, modal, open, opener, setOpen, sidebar }
}

export const DashboardShell = (props: DashboardShellProps): JSX.Element => {
  const drawerId = useId()
  const venue = props.venue ?? null
  const { closeDrawer, modal, open, opener, setOpen, sidebar } = useDrawer(props.route)
  // Preact types an aside's role narrowly, but the open drawer really is a modal dialog.
  const modalAttributes: Record<string, string> = modal ? { 'aria-modal': 'true', role: 'dialog' } : {}

  return (
    <div class="dash-app drawer md:drawer-open min-h-svh bg-[var(--fuda-bg)] text-[var(--fuda-text)] print:block">
      <input
        id={drawerId}
        class="drawer-toggle"
        type="checkbox"
        checked={open}
        tabIndex={-1}
        aria-label={props.copy.chrome.openMenu}
        onInput={(event) => {
          setOpen(event.currentTarget.checked)
        }}
      />
      <div class="drawer-content min-w-0" inert={modal}>
        <header class="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-[var(--fuda-border)] bg-[var(--fuda-surface)] px-4 md:hidden print:hidden!">
          <Brand copy={props.copy.chrome} />
          <button
            ref={opener}
            aria-label={props.copy.chrome.openMenu}
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
        <main class="mx-auto w-full max-w-6xl min-w-0 p-4 sm:px-6 sm:py-8 lg:px-8 lg:py-10 print:p-0">
          {props.children}
        </main>
      </div>
      <div class="drawer-side z-30 md:z-auto">
        <label
          for={drawerId}
          class="drawer-overlay"
          aria-label={props.copy.chrome.closeMenu}
          onClick={(event) => {
            event.preventDefault()
            closeDrawer()
          }}
        />
        <aside
          ref={sidebar}
          id={`${drawerId}-side`}
          class="dash-sidebar flex min-h-dvh w-64 flex-col border-r border-[var(--fuda-border)] bg-[var(--fuda-surface)] pb-6 print:hidden!"
          {...modalAttributes}
          aria-label={props.copy.chrome.navigation}
          onKeyDown={(event) => {
            keepFocusInDrawer(event, sidebar.current, modal, closeDrawer)
          }}
        >
          <div class="flex h-14 shrink-0 items-center justify-between gap-2 px-5">
            <Brand copy={props.copy.chrome} />
            <button
              class="btn btn-ghost btn-square md:hidden!"
              aria-label={props.copy.chrome.closeMenu}
              type="button"
              onClick={closeDrawer}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {props.surface === 'operator' && venue !== null ? (
            // A new route closes the menu by mounting a fresh one.
            <ProfileMenu
              key={props.route}
              profiles={props.profiles}
              copy={props.copy}
              venue={venue}
              onSignOut={props.onSignOut}
            />
          ) : null}
          <Navigation
            copy={props.copy}
            hasIssuer={props.hasIssuer}
            onNavigate={props.onNavigate}
            onSelection={() => {
              if (open) {
                closeDrawer()
              }
            }}
            route={props.route}
            surface={props.surface}
          />
          <div class="mt-auto flex flex-col gap-3">
            {props.onSignOut === null || (props.surface === 'operator' && venue !== null) ? null : (
              <SignOutButton
                copy={props.copy.auth}
                onSignOut={() => {
                  props.onSignOut?.()
                }}
                menu
              />
            )}
            <div class="px-5">{props.appearance}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}
