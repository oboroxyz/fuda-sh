import { describe, expect, it, vi } from 'vitest'

import { canonicalPath, navigateTo, routeFromPath, subscribeToRoute } from './router.ts'
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
