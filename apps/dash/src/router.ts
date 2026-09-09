export const DASH_ROUTES = ['/', '/rights', '/issue', '/venue', '/new', '/published'] as const

export type DashRoute = (typeof DASH_ROUTES)[number]

// The dashboard has two kinds of signed-in surface, and they do not overlap:
// the admin token opens the operational console, a passkey session opens the
// venue's own card. Each kind is sent back to its own home on the other's route.
export type DashSurface = 'admin' | 'operator'

const OPERATOR_ROUTES: ReadonlySet<DashRoute> = new Set(['/venue', '/new', '/published'])

export const surfaceOf = (route: DashRoute): DashSurface =>
  OPERATOR_ROUTES.has(route) ? 'operator' : 'admin'

// Where a session belongs when it lands somewhere it cannot be: an operator
// with a venue goes to its cards, one without to the designer.
export const homeFor = (surface: DashSurface, hasIssuer: boolean): DashRoute => {
  if (surface === 'admin') {
    return '/'
  }
  return hasIssuer ? '/published' : '/venue'
}

// null means the route is allowed as it stands.
export const redirectFor = (
  route: DashRoute,
  surface: DashSurface,
  hasIssuer: boolean,
  hasConfirmedEns = false,
): DashRoute | null => {
  if (surfaceOf(route) !== surface) {
    return homeFor(surface, hasIssuer)
  }
  if (surface === 'operator' && !hasIssuer && route !== '/venue') {
    return '/venue'
  }
  if (surface === 'operator' && route === '/new' && !hasConfirmedEns) {
    return '/venue'
  }
  return null
}

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
