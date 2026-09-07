/** @jsxImportSource hono/jsx/dom */
import { useEffect, useRef } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import type { DashRoute, DashSurface } from './router.ts'

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

export const subscribeToDesktopEntry = (
  breakpoint: DesktopBreakpoint,
  onEnterDesktop: () => void,
): (() => void) => {
  let wasDesktop = breakpoint.matches
  const listener = (event: MediaQueryListEvent): void => {
    if (!wasDesktop && event.matches) {
      onEnterDesktop()
    }
    wasDesktop = event.matches
  }
  breakpoint.addEventListener('change', listener)
  return (): void => {
    breakpoint.removeEventListener('change', listener)
  }
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
    ? [{ label: copy.nav.card, route: '/published' }]
    : [{ label: copy.nav.newCard, route: '/new' }]
}

const Navigation = ({
  copy,
  hasIssuer,
  onNavigate,
  onSelection,
  route,
  surface,
}: NavigationProps): JSX.Element => (
  <nav aria-label={copy.chrome.navigation} class="dash-nav">
    {navigationItems(copy, surface, hasIssuer).map((item): JSX.Element => (
      <a
        aria-current={route === item.route ? 'page' : undefined}
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
        {item.label}
      </a>
    ))}
  </nav>
)

const SignOutButton = (label: string, onSignOut: (() => void) | null): JSX.Element | null =>
  onSignOut === null ? null : (
    <button class="btn btn-ghost btn-sm self-start" onClick={onSignOut} type="button">
      {label}
    </button>
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
  const dialog = useRef<HTMLDialogElement | null>(null)
  const opener = useRef<HTMLButtonElement | null>(null)

  const closeDrawer = (): void => {
    dialog.current?.close()
    opener.current?.focus()
  }

  const closeOpenDrawer = (): void => {
    if (dialog.current?.open === true) {
      closeDrawer()
    }
  }

  useEffect(closeOpenDrawer, [route])

  return (
    <div class="dash-app">
      <aside class="dash-sidebar">
        <div>
          <p class="text-xl font-bold">{copy.chrome.brand}</p>
          <p class="text-sm opacity-70">{copy.chrome.subtitle}</p>
        </div>
        {Navigation({ copy, hasIssuer, onNavigate, route, surface })}
        <div class="mt-auto flex flex-col gap-3">
          {SignOutButton(copy.auth.signOut, onSignOut)}
          {appearance}
        </div>
      </aside>

      <div class="dash-workspace">
        <header class="dash-mobile-header">
          <div>
            <p class="font-bold">{copy.chrome.brand}</p>
            <p class="text-xs opacity-70">{copy.chrome.subtitle}</p>
          </div>
          <div class="ml-auto">
            <button
              aria-label={copy.chrome.openMenu}
              class="dash-menu-button btn btn-ghost btn-square"
              onClick={() => {
                dialog.current?.showModal()
              }}
              ref={(element: HTMLButtonElement | null): void => {
                opener.current = element
              }}
              type="button"
            >
              <span aria-hidden="true">☰</span>
            </button>
          </div>
        </header>
        <main class="dash-main">{children}</main>
      </div>

      <dialog
        aria-label={copy.chrome.navigation}
        class="dash-drawer"
        onCancel={(event: Event): void => {
          event.preventDefault()
          closeDrawer()
        }}
        onClick={(event: MouseEvent): void => {
          if (event.target === event.currentTarget) {
            closeDrawer()
          }
        }}
        ref={(element: HTMLDialogElement | null): (() => void) | undefined => {
          dialog.current = element
          const breakpoint = desktopBreakpoint()
          if (element === null || breakpoint === null) {
            return
          }
          return subscribeToDesktopEntry(breakpoint, closeOpenDrawer)
        }}
      >
        <div class="dash-drawer-panel">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xl font-bold">{copy.chrome.brand}</p>
              <p class="text-sm opacity-70">{copy.chrome.subtitle}</p>
            </div>
            <button
              aria-label={copy.chrome.closeMenu}
              class="btn btn-ghost btn-square"
              onClick={closeDrawer}
              type="button"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {Navigation({ copy, hasIssuer, onNavigate, onSelection: closeDrawer, route, surface })}
          <div class="flex flex-col gap-3">
            {SignOutButton(copy.auth.signOut, onSignOut)}
            {appearance}
          </div>
        </div>
      </dialog>
    </div>
  )
}
