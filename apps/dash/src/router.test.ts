import { describe, expect, it, vi } from 'vitest'

import {
  canonicalPath,
  navigateTo,
  redirectFor,
  routeFromPath,
  subscribeToRoute,
  surfaceOf,
} from './router.ts'
import type { DashRoute, PushHistory, RouteEvents } from './router.ts'

describe('Dash router', () => {
  it('recognizes routes and normalizes trailing and unknown paths', () => {
    expect(routeFromPath('/')).toBe('/')
    expect(routeFromPath('/profile')).toBe('/profile')
    expect(routeFromPath('/rights/')).toBe('/rights')
    expect(routeFromPath('/issue?from=overview')).toBe('/issue')
    expect(routeFromPath('/unknown')).toBe('/')
  })

  it('canonicalizes previous operator URLs', () => {
    expect(canonicalPath('/venue/')).toBe('/profile')
    expect(canonicalPath('/published')).toBe('/cards')
    expect(canonicalPath('/new?from=menu')).toBe('/cards/new')
  })

  it('recognizes the reception route', () => {
    expect(routeFromPath('/reception')).toBe('/reception')
  })

  it('opens card settings directly and preserves the selected card through history', () => {
    expect(routeFromPath('/cards/card-1/stamps/')).toBe('/cards/card-1/stamps')
    expect(routeFromPath('/cards/card-2/stamps?from=list')).toBe('/cards/card-2/stamps')
  })

  it('guards Card settings as an operator route', () => {
    expect(surfaceOf(routeFromPath('/cards/card-1/stamps'))).toBe('operator')
    expect(redirectFor(routeFromPath('/cards/card-1/stamps'), 'admin', false)).toBe('/')
    expect(redirectFor(routeFromPath('/cards/card-1/stamps'), 'operator', false)).toBe('/start')
    expect(redirectFor(routeFromPath('/cards/card-1/stamps'), 'operator', true)).toBeNull()
    expect(routeFromPath('/cards//stamps')).toBe('/')
  })

  it('canonicalizes an unknown path', () => {
    expect(canonicalPath('/unknown')).toBe('/')
  })

  it('pushes a selected route and reports browser navigation', () => {
    const pushState = vi.fn<PushHistory['pushState']>()
    navigateTo({ pushState }, '/rights')
    expect(pushState).toHaveBeenCalledWith(null, '', '/rights')

    let listener: (() => void) | undefined
    const onRoute = vi.fn<(route: DashRoute) => void>()
    const unsubscribe = subscribeToRoute(
      {
        addEventListener: (_type, next) => {
          listener = next
        },
        pathname: () => '/issue',
        removeEventListener: vi.fn<RouteEvents['removeEventListener']>(),
      },
      onRoute,
    )
    listener?.()
    expect(onRoute).toHaveBeenCalledWith('/issue')
    unsubscribe()
  })
})

describe(redirectFor, () => {
  it('separates initial registration from the saved profile', () => {
    expect(redirectFor('/profile', 'operator', false)).toBe('/start')
    expect(redirectFor('/cards', 'operator', false)).toBe('/start')
    expect(redirectFor('/start', 'operator', true)).toBe('/profile')
    expect(redirectFor('/profile', 'operator', true)).toBeNull()
  })

  it('keeps each session on its own surface', () => {
    expect(redirectFor('/', 'admin', false)).toBeNull()
    expect(redirectFor('/cards/new', 'admin', false)).toBe('/')
    expect(redirectFor('/rights', 'operator', false)).toBe('/start')
    expect(redirectFor('/rights', 'operator', true)).toBe('/cards')
  })

  it('keeps the designer open for a second card and needs a venue for the card list', () => {
    expect(redirectFor('/start', 'operator', false)).toBeNull()
    expect(redirectFor('/cards/new', 'operator', false)).toBe('/start')
    expect(redirectFor('/cards/new', 'operator', true)).toBeNull()
    expect(redirectFor('/cards', 'operator', true)).toBeNull()
  })
})

describe(surfaceOf, () => {
  it('separates the console routes from the venue card routes', () => {
    expect(surfaceOf('/')).toBe('admin')
    expect(surfaceOf('/issue')).toBe('admin')
    expect(surfaceOf('/cards/new')).toBe('operator')
    expect(surfaceOf('/profile')).toBe('operator')
    expect(surfaceOf('/cards')).toBe('operator')
  })

  it('places reception on the operator surface', () => {
    expect(surfaceOf('/reception')).toBe('operator')
  })
})
