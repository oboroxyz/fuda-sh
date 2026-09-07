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

  // +Private is Signed with the privacy extension on, so /private lives on the
  // same origin and follows the same redirect rule.
  it('renders +Private on the app origin and redirects it from the apex', () => {
    expect(routeFor(APP, '/private', APP)).toBe('private')
    expect(routeFor(APP, '/private/', APP)).toBe('private')
    expect(routeFor(APEX, '/private', APP)).toStrictEqual({ redirect: 'https://app.fuda.sh/private' })
  })

  it('renders the rights list only on the app origin', () => {
    expect(routeFor(APP, '/rights', APP)).toBe('rights')
    expect(routeFor(APP, '/rights/', APP)).toBe('rights')
    expect(routeFor(APEX, '/rights', APP)).toStrictEqual({ redirect: 'https://app.fuda.sh/rights' })
  })

  it('preserves a uid query when routing rights from the apex to the app origin', () => {
    const uid = `0x${'ab'.repeat(32)}`
    expect(routeFor(APEX, `/rights?uid=${uid}`, APP)).toStrictEqual({
      redirect: `https://app.fuda.sh/rights?uid=${uid}`,
    })
  })

  it('sends an unknown path to the landing rather than into a redirect', () => {
    expect(routeFor(APEX, '/nope', APP)).toBe('landing')
    expect(routeFor(APP, '/signed/extra', APP)).toBe('landing')
  })

  // A VITE_APP_ORIGIN spelled with a trailing slash or an upper-case host is the
  // same origin: comparing the raw strings would redirect the gate to itself.
  it('normalizes the app origin before comparing it', () => {
    expect(routeFor(APP, '/signed', 'https://app.fuda.sh/')).toBe('signed')
    expect(routeFor(APP, '/signed', 'HTTPS://APP.FUDA.SH')).toBe('signed')
    expect(routeFor(APEX, '/signed', 'https://app.fuda.sh/')).toStrictEqual({
      redirect: 'https://app.fuda.sh/signed',
    })
  })

  it('renders the landing rather than redirecting when the app origin is unusable', () => {
    expect(routeFor(APEX, '/signed', 'not a url')).toBe('landing')
    expect(routeFor(APEX, '/signed', 'app.fuda.sh')).toBe('landing')
  })

  it('honours a dev app origin, so localhost renders the gate in place', () => {
    const dev = 'http://localhost:5173'
    expect(routeFor(dev, '/signed', dev)).toBe('signed')
  })

  // The card screen calls the api from the browser, so like /signed it may only
  // render on the app origin; the apex hands it over with the query intact.
  it('renders a venue on the app origin and redirects it from the apex', () => {
    expect(routeFor(APP, '/@wassie-coffee', APP)).toStrictEqual({ card: 'wassie-coffee', slug: null })
    expect(routeFor(APP, '/@wassie-coffee/', APP)).toStrictEqual({ card: 'wassie-coffee', slug: null })
    expect(routeFor(APEX, '/@wassie-coffee', APP)).toStrictEqual({
      redirect: 'https://app.fuda.sh/@wassie-coffee',
    })
  })

  // A venue that publishes several cards links each one at /@<handle>/<slug>.
  it('routes one card of a venue by its slug', () => {
    expect(routeFor(APP, '/@wassie-coffee/regular', APP)).toStrictEqual({
      card: 'wassie-coffee',
      slug: 'regular',
    })
    expect(routeFor(APP, '/@wassie-coffee/regular/', APP)).toStrictEqual({
      card: 'wassie-coffee',
      slug: 'regular',
    })
  })

  it('carries a query string across the venue and card redirects', () => {
    expect(routeFor(APEX, '/@wassie-coffee?ref=poster', APP)).toStrictEqual({
      redirect: 'https://app.fuda.sh/@wassie-coffee?ref=poster',
    })
    expect(routeFor(APEX, '/@wassie-coffee/regular?ref=poster', APP)).toStrictEqual({
      redirect: 'https://app.fuda.sh/@wassie-coffee/regular?ref=poster',
    })
    expect(routeFor(APP, '/@wassie-coffee?ref=poster', APP)).toStrictEqual({
      card: 'wassie-coffee',
      slug: null,
    })
  })

  it('sends an invalid or reserved handle to the landing rather than into a redirect', () => {
    expect(routeFor(APP, '/@Wassie Coffee', APP)).toBe('landing')
    expect(routeFor(APEX, '/@www', APP)).toBe('landing')
    expect(routeFor(APP, '/@', APP)).toBe('landing')
  })

  // A slug the sdk would refuse is not a card address, so it falls through to
  // the landing exactly as a bad handle does.
  it('sends an invalid, reserved or over-deep card slug to the landing', () => {
    expect(routeFor(APP, '/@wassie-coffee/Regular Card', APP)).toBe('landing')
    expect(routeFor(APP, '/@wassie-coffee/cards', APP)).toBe('landing')
    expect(routeFor(APEX, '/@wassie-coffee/cards', APP)).toBe('landing')
    expect(routeFor(APP, '/@wassie-coffee/regular/extra', APP)).toBe('landing')
  })
})
