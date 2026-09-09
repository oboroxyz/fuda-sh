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
    expect(routeFromPath('/venue')).toBe('/venue')
    expect(routeFromPath('/rights/')).toBe('/rights')
    expect(routeFromPath('/issue?from=overview')).toBe('/issue')
    expect(routeFromPath('/unknown')).toBe('/')
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
  it('keeps each session on its own surface', () => {
    expect(redirectFor('/', 'admin', false)).toBeNull()
    expect(redirectFor('/new', 'admin', false, false)).toBe('/')
    expect(redirectFor('/rights', 'operator', false, false)).toBe('/venue')
    expect(redirectFor('/rights', 'operator', true)).toBe('/published')
  })

  it('keeps the designer open for a second card and needs a venue for the card list', () => {
    expect(redirectFor('/venue', 'operator', false, false)).toBeNull()
    expect(redirectFor('/new', 'operator', false, false)).toBe('/venue')
    expect(redirectFor('/new', 'operator', true, false)).toBe('/venue')
    expect(redirectFor('/new', 'operator', true, true)).toBeNull()
    expect(redirectFor('/published', 'operator', true, false)).toBeNull()
  })
})

describe(surfaceOf, () => {
  it('separates the console routes from the venue card routes', () => {
    expect(surfaceOf('/')).toBe('admin')
    expect(surfaceOf('/issue')).toBe('admin')
    expect(surfaceOf('/new')).toBe('operator')
    expect(surfaceOf('/venue')).toBe('operator')
    expect(surfaceOf('/published')).toBe('operator')
  })
})
