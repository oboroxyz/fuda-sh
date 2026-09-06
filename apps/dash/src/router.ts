export const DASH_ROUTES = ['/', '/rights', '/issue'] as const

export type DashRoute = (typeof DASH_ROUTES)[number]

export interface PushHistory {
  pushState: (data: null, unused: string, url: string) => void
}

export interface RouteEvents {
  pathname: () => string
  addEventListener: (type: 'popstate', listener: () => void) => void
  removeEventListener: (type: 'popstate', listener: () => void) => void
}

const isDashRoute = (value: string): value is DashRoute => DASH_ROUTES.some((route) => route === value)

export const routeFromPath = (pathname: string): DashRoute => {
  const raw = pathname.split(/[?#]/u, 1)[0] || '/'
  const normalized = raw.length > 1 ? raw.replace(/\/+$/u, '') : raw
  return isDashRoute(normalized) ? normalized : '/'
}

export const canonicalPath = (pathname: string): DashRoute => routeFromPath(pathname)

export const navigateTo = (history: PushHistory, route: DashRoute): void => {
  history.pushState(null, '', route)
}

export const subscribeToRoute = (events: RouteEvents, onRoute: (route: DashRoute) => void): (() => void) => {
  const listener = (): void => {
    onRoute(routeFromPath(events.pathname()))
  }
  events.addEventListener('popstate', listener)
  return () => {
    events.removeEventListener('popstate', listener)
  }
}
