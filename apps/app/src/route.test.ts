import { describe, expect, it } from 'vitest'

import { routeFor } from './route.ts'

const APEX = 'https://fuda.sh'
const APP = 'https://app.fuda.sh'

describe(routeFor, () => {
  it('renders the landing at the root of either origin', () => {
    expect(routeFor(APEX, '/', APP)).toBe('landing')
    expect(routeFor(APP, '/', APP)).toBe('landing')
  })

  // The api's CORS list has no entry for the apex, so the gate may never render
  // there: a challenge posted from https://fuda.sh would fail closed every time.
  it('sends /signed at the apex to the app origin', () => {
    expect(routeFor(APEX, '/signed', APP)).toStrictEqual({ redirect: 'https://app.fuda.sh/signed' })
  })

  it('renders the gate when already on the app origin', () => {
    expect(routeFor(APP, '/signed', APP)).toBe('signed')
  })

  it('treats a trailing slash as the same route', () => {
    expect(routeFor(APP, '/signed/', APP)).toBe('signed')
    expect(routeFor(APEX, '/signed/', APP)).toStrictEqual({ redirect: 'https://app.fuda.sh/signed' })
  })

  it('sends an unknown path to the landing rather than into a redirect', () => {
    expect(routeFor(APEX, '/nope', APP)).toBe('landing')
    expect(routeFor(APP, '/signed/extra', APP)).toBe('landing')
  })

  it('honours a dev app origin, so localhost renders the gate in place', () => {
    const dev = 'http://localhost:5173'
    expect(routeFor(dev, '/signed', dev)).toBe('signed')
  })
})
