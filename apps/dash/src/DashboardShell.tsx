/** @jsxImportSource hono/jsx/dom */
import type { JSX } from 'hono/jsx/dom/jsx-runtime'

import type { DashCopy } from './copy.ts'
import type { DashRoute } from './router.ts'

export interface DashboardShellProps {
  appearance: JSX.Element
  children: JSX.Element
  copy: DashCopy
  onNavigate: (route: DashRoute) => void
  route: DashRoute
}

interface NavigationProps {
  copy: DashCopy
  onNavigate: (route: DashRoute) => void
  onSelection?: () => void
  route: DashRoute
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

const navigationItems = (copy: DashCopy): readonly NavItem[] => [
  { label: copy.nav.overview, route: '/' },
  { label: copy.nav.rights, route: '/rights' },
  { label: copy.nav.issue, route: '/issue' },
]

const Navigation = ({ copy, onNavigate, onSelection, route }: NavigationProps): JSX.Element => (
  <nav aria-label={copy.chrome.navigation} class="menu w-full gap-1">
    {navigationItems(copy).map((item): JSX.Element => (
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

export const DashboardShell = ({
  appearance,
  children,
  copy,
  onNavigate,
  route,
}: DashboardShellProps): JSX.Element => {
  let dialog: HTMLDialogElement | null = null
  let opener: HTMLButtonElement | null = null

  const closeDrawer = (): void => {
    dialog?.close()
    opener?.focus()
  }

  const closeOpenDrawerForDesktop = (): void => {
    if (dialog?.open === true) {
      closeDrawer()
    }
  }

  return (
    <div class="bg-base-100 min-h-screen lg:grid lg:grid-cols-[18rem_1fr]">
      <aside class="bg-base-200 border-base-300 hidden min-h-screen flex-col gap-6 border-r p-5 lg:flex">
        <div>
          <p class="text-xl font-bold">{copy.chrome.brand}</p>
          <p class="text-sm opacity-70">{copy.chrome.subtitle}</p>
        </div>
        {Navigation({ copy, onNavigate, route })}
        <div class="mt-auto">{appearance}</div>
      </aside>

      <div class="min-w-0">
        <header class="navbar bg-base-200 border-base-300 border-b lg:hidden">
          <div>
            <p class="font-bold">{copy.chrome.brand}</p>
            <p class="text-xs opacity-70">{copy.chrome.subtitle}</p>
          </div>
          <div class="ml-auto">
            <button
              aria-label={copy.chrome.openMenu}
              class="btn btn-ghost btn-square"
              onClick={() => {
                dialog?.showModal()
              }}
              ref={(element: HTMLButtonElement | null): void => {
                opener = element
              }}
              type="button"
            >
              <span aria-hidden="true">☰</span>
            </button>
          </div>
        </header>
        <main class="p-4 sm:p-6">{children}</main>
      </div>

      <dialog
        aria-label={copy.chrome.navigation}
        class="modal modal-bottom sm:modal-middle lg:hidden"
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
          dialog = element
          const breakpoint = desktopBreakpoint()
          if (element === null || breakpoint === null) {
            return
          }
          return subscribeToDesktopEntry(breakpoint, closeOpenDrawerForDesktop)
        }}
      >
        <div class="modal-box flex flex-col gap-6">
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
          {Navigation({ copy, onNavigate, onSelection: closeDrawer, route })}
          <div>{appearance}</div>
        </div>
      </dialog>
    </div>
  )
}
