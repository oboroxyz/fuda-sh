import type { IssuerMeResponse } from '@fuda/sdk'

import {
  cardEditPath,
  cardForRoute,
  cardSettingsPath,
  homeFor,
  isCardEditRoute,
  isLegacyCardSettingsRoute,
  redirectFor,
  routeFromPath,
} from '../router.ts'
import type { DashRoute, DashSurface } from '../router.ts'

export const SIGN_IN_PATH = '/signin'

const trimmed = (pathname: string): string => (pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname)

// The one place a page request is sent somewhere else: a signed-out visit goes
// to sign-in, a retired or unknown URL to its current route, a route of the
// other surface (or of an unregistered venue) to the session's home, and a Card
// to its canonical URL. null means the request stands.
export const guardRedirect = (
  pathname: string,
  surface: DashSurface | null,
  operator: IssuerMeResponse | null,
): string | null => {
  const path = trimmed(pathname)
  if (surface === null) {
    return path === SIGN_IN_PATH ? null : SIGN_IN_PATH
  }
  const hasIssuer = operator?.issuer !== null && operator?.issuer !== undefined
  if (path === SIGN_IN_PATH) {
    return homeFor(surface, hasIssuer)
  }
  const route = routeFromPath(path)
  const allowed: DashRoute = redirectFor(route, surface, hasIssuer) ?? route
  let target: string = allowed
  if (allowed === route && operator !== null) {
    const card = cardForRoute(route, operator.cards)
    if (card !== null) {
      target =
        isCardEditRoute(route) || isLegacyCardSettingsRoute(route)
          ? cardEditPath(card)
          : cardSettingsPath(card)
    }
  }
  return target === pathname ? null : target
}
