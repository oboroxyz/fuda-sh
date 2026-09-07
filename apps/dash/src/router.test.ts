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
    expect(routeFromPath('/rights/')).toBe('/rights')
    expect(routeFromPath('/issue?from=overview')).toBe('/issue')
    expect(routeFromPath('/unknown')).toBe('/')
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
  it('keeps each session on its own surface', () => {
    expect(redirectFor('/', 'admin', false)).toBeNull()
    expect(redirectFor('/new', 'admin', false)).toBe('/')
    expect(redirectFor('/rights', 'operator', false)).toBe('/new')
    expect(redirectFor('/rights', 'operator', true)).toBe('/published')
  })

  it('sends an operator to the designer or the published card as the issuer requires', () => {
    expect(redirectFor('/new', 'operator', false)).toBeNull()
    expect(redirectFor('/new', 'operator', true)).toBe('/published')
    expect(redirectFor('/published', 'operator', false)).toBe('/new')
    expect(redirectFor('/published', 'operator', true)).toBeNull()
  })
})

describe(surfaceOf, () => {
  it('separates the console routes from the venue card routes', () => {
    expect(surfaceOf('/')).toBe('admin')
    expect(surfaceOf('/issue')).toBe('admin')
    expect(surfaceOf('/new')).toBe('operator')
    expect(surfaceOf('/published')).toBe('operator')
  })
})
