import { isCardSlug, isCardSlugReference } from '@fuda/sdk'
import type { CardView } from '@fuda/sdk'

export const DASH_ROUTES = [
  '/',
  '/rights',
  '/issue',
  '/start',
  '/profile',
  '/reception',
  '/cards/new',
  '/cards',
  '/passes',
] as const

export type MainDashRoute = (typeof DASH_ROUTES)[number]
export type CardSettingsRoute = `/cards/${string}`
export type CardEditRoute = `/cards/${string}/edit`
type LegacyCardSettingsRoute = `/cards/${string}/stamps`
export type DashRoute = MainDashRoute | CardSettingsRoute

export const isLegacyCardSettingsRoute = (value: string): value is LegacyCardSettingsRoute =>
  /^\/cards\/[a-zA-Z0-9_-]+\/stamps$/u.test(value)

const isCardSettingsRoute = (value: string): value is CardSettingsRoute => {
  const parts = value.split('/')
  return parts.length === 3 && parts[1] === 'cards' && isCardSlug(parts[2] ?? '')
}

export const cardSettingsPath = (card: Pick<CardView, 'id' | 'slug'>): CardSettingsRoute =>
  // Cards created before "new" became reserved remain manageable at the old URL.
  card.slug === 'new' ? `/cards/${card.id}/stamps` : `/cards/${card.slug}`

export const cardEditPath = (card: Pick<CardView, 'slug'>): CardEditRoute => `/cards/${card.slug}/edit`

export const isCardEditRoute = (value: string): value is CardEditRoute => {
  const parts = value.split('/')
  return (
    parts.length === 4 && parts[1] === 'cards' && isCardSlugReference(parts[2] ?? '') && parts[3] === 'edit'
  )
}

export const isCardRoute = (route: string): route is CardSettingsRoute =>
  isCardSettingsRoute(route) || isLegacyCardSettingsRoute(route) || isCardEditRoute(route)

export const cardForRoute = (route: DashRoute, cards: readonly CardView[]): CardView | null => {
  const segment = route.split('/').at(2)
  if (isLegacyCardSettingsRoute(route)) {
    return cards.find((card) => card.id === segment) ?? null
  }
  return isCardSettingsRoute(route) || isCardEditRoute(route)
    ? (cards.find((card) => card.slug === segment) ?? null)
    : null
}

export const navigationRoute = (route: DashRoute): MainDashRoute =>
  DASH_ROUTES.find((candidate) => candidate === route) ?? '/cards'

// The dashboard has two kinds of signed-in surface, and they do not overlap:
// the admin token opens the operational console, a passkey session opens the
// venue's own card. Each kind is sent back to its own home on the other's route.
export type DashSurface = 'admin' | 'operator'

const OPERATOR_ROUTES: ReadonlySet<DashRoute> = new Set([
  '/start',
  '/profile',
  '/reception',
  '/cards/new',
  '/cards',
  '/passes',
])

export const surfaceOf = (route: DashRoute): DashSurface =>
  OPERATOR_ROUTES.has(navigationRoute(route)) ? 'operator' : 'admin'

// Where a session belongs when it lands somewhere it cannot be: an operator
// with a venue goes to its cards, one without to initial registration.
export const homeFor = (surface: DashSurface, hasIssuer: boolean): DashRoute => {
  if (surface === 'admin') {
    return '/'
  }
  return hasIssuer ? '/cards' : '/start'
}

// null means the route is allowed as it stands.
export const redirectFor = (route: DashRoute, surface: DashSurface, hasIssuer: boolean): DashRoute | null => {
  if (surfaceOf(route) !== surface) {
    return homeFor(surface, hasIssuer)
  }
  if (surface === 'operator' && !hasIssuer && route !== '/start') {
    return '/start'
  }
  if (surface === 'operator' && hasIssuer && route === '/start') {
    return '/profile'
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

const isDashRoute = (value: string): value is DashRoute =>
  DASH_ROUTES.some((route) => route === value) || isCardRoute(value)

export const routeFromPath = (pathname: string): DashRoute => {
  const raw = pathname.split(/[?#]/u, 1)[0] || '/'
  const normalized = raw.length > 1 ? raw.replace(/\/+$/u, '') : raw
  if (normalized === '/venue') {
    return '/profile'
  }
  if (normalized === '/published') {
    return '/cards'
  }
  if (normalized === '/new') {
    return '/cards/new'
  }
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
