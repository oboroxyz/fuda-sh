import { API_VERSION_PREFIX } from '@fuda/sdk/http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const UID = `0x${'aa'.repeat(32)}`
const CARD_UID = `0x${'cc'.repeat(32)}`
const NONCE = `0x${'bb'.repeat(32)}`
const HANDLE_RE = /^\/issuers\/(?<handle>[^/]+)$/u
const CLAIM_RE = /^\/issuers\/(?<handle>[^/]+)\/(?<slug>[^/]+)\/issue$/u

interface Published {
  handle: string
  slug: string
}

// The card ladder's own boundary: sign-in, publish, the public page, and the
// member's tap. Split out so the fake's main branch stays readable — and so the
// ladder it serves can grow without the whole fixture growing with it.
const cardRoute = async (
  pathname: string,
  url: string,
  init: RequestInit | undefined,
  state: { active: Set<string>; issued: string[]; published: Published },
): Promise<Response | null> => {
  if (pathname === '/auth/challenge') {
    return Response.json({ message: 'fuda.sh dashboard sign-in', nonce: NONCE })
  }
  if (pathname === '/auth/verify') {
    return Response.json({ issuer: null, token: 'smoke-session' })
  }
  if (pathname === '/issuers') {
    const body = await new Request(url, init).json<{ card: { slug: string }; handle: string }>()
    state.published.handle = body.handle
    state.published.slug = body.card.slug
    return Response.json({
      card: { claimable: true, slug: body.card.slug },
      issuer: { handle: body.handle },
      publicUrl: `https://fuda.sh/@${body.handle}`,
    })
  }
  if (CLAIM_RE.test(pathname)) {
    state.issued.push(CARD_UID)
    state.active.add(CARD_UID)
    return Response.json({
      holder: `0x${'dd'.repeat(20)}`,
      level: 'bearer',
      memberNumber: 'qj2yxphepdrka',
      qr: `fuda:${CARD_UID}`,
      uid: CARD_UID,
    })
  }
  if (HANDLE_RE.test(pathname)) {
    return Response.json({
      cards: [{ claimable: true, slug: state.published.slug }],
      handle: state.published.handle,
    })
  }
  return null
}

// The script's only external boundary is HTTP. Track the remote active rights
// so cleanup assertions exercise the effect of /revoke, including early exits.
const fakeApi = (failAt?: string) => {
  const active = new Set<string>()
  const issued: string[] = []
  const revoked: string[] = []
  let scans = 0
  let signedScans = 0
  let level = 'bearer'
  const published: Published = { handle: '', slug: '' }
  const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    // The script sends every request under the version prefix; the fake matches
    // on the route's own path, as the api's own routers do.
    const { pathname: versioned } = new URL(url)
    const pathname = versioned.startsWith(API_VERSION_PREFIX)
      ? versioned.slice(API_VERSION_PREFIX.length)
      : versioned
    if (pathname === '/issue') {
      const body = await new Request(url, init).json<{ holder?: string; stealthMetaAddress?: string }>()
      level = body.holder === undefined ? 'bearer' : 'signed'
      if (body.stealthMetaAddress !== undefined) {
        throw new Error('unsupported private issue reached the API')
      }
      issued.push(UID)
      active.add(UID)
      return Response.json({
        level: failAt === 'issue-shape' ? 'wrong-level' : level,
        qr: `fuda:${UID}`,
        uid: UID,
      })
    }
    if (pathname === '/revoke') {
      const body = await new Request(url, init).json<{ uid: string }>()
      if (failAt === 'revoke') {
        throw new Error('revoke unavailable')
      }
      active.delete(body.uid)
      revoked.push(body.uid)
      return Response.json({ revoked: true, uid: body.uid })
    }
    if (pathname.startsWith('/verify/')) {
      if (failAt === 'preview') {
        throw new Error('preview unavailable')
      }
      const uid = pathname.slice('/verify/'.length)
      return Response.json(
        active.has(uid) ? { decision: 'ADMIT' } : { decision: 'REJECT', reason: 'REVOKED' },
      )
    }
    if (pathname === '/verify') {
      if (level === 'signed') {
        return Response.json({ decision: 'REJECT', reason: 'LEVEL_REQUIRED' })
      }
      scans += 1
      return Response.json(
        scans === 1 ? { decision: 'ADMIT' } : { decision: 'REJECT', reason: 'ALREADY_USED' },
      )
    }
    const card = await cardRoute(pathname, url, init, { active, issued, published })
    if (card !== null) {
      if (CLAIM_RE.test(pathname)) {
        // A claimed card is a bearer right, and the scanner starts fresh on it
        // even when a signed ladder ran first.
        level = 'bearer'
        scans = 0
      }
      return card
    }
    if (pathname === '/challenge') {
      return Response.json({ challenge: 'smoke challenge', nonce: NONCE, uid: UID })
    }
    if (pathname === '/verify-signed') {
      const responses = [
        { decision: 'REJECT', reason: 'BAD_SIGNATURE' },
        { decision: 'REJECT', reason: 'BAD_CHALLENGE' },
        { decision: 'ADMIT', path: 'signature' },
        { decision: 'REJECT', reason: 'BAD_CHALLENGE' },
        { decision: 'REJECT', reason: 'ALREADY_USED' },
      ]
      const response = responses[signedScans]
      signedScans += 1
      return Response.json(response)
    }
    throw new Error(`unexpected smoke request ${pathname}`)
  })
  vi.stubGlobal('fetch', fetchSpy)
  return { active, fetchSpy, issued, revoked }
}

const runScript = async () => {
  vi.resetModules()
  await import('./smoke-live.ts')
}

describe('live smoke cleanup', () => {
  beforeEach(() => {
    vi.stubEnv('SMOKE_LADDERS', '')
    vi.spyOn(console, 'log').mockReturnValue()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects a mixed private selection before issuing any rights', async () => {
    vi.stubEnv('SMOKE_LADDERS', 'bearer,private')
    const api = fakeApi()

    await expect(runScript()).rejects.toThrow(/unknown ladder|unsupported/iu)
    expect(api.issued).toStrictEqual([])
    expect(api.fetchSpy).not.toHaveBeenCalled()
  })

  it.each(['bearer', 'signed'])('revokes %s rights when verification fails', async (ladder) => {
    vi.stubEnv('SMOKE_LADDERS', ladder)
    const api = fakeApi('preview')

    await expect(runScript()).rejects.toThrow('preview unavailable')
    expect(api.revoked).toStrictEqual([UID])
    expect([...api.active]).toStrictEqual([])
  })

  it('revokes a signed right even when the issue response has an unexpected level', async () => {
    vi.stubEnv('SMOKE_LADDERS', 'signed')
    const api = fakeApi('issue-shape')

    await expect(runScript()).rejects.toThrow('signed issue')
    expect(api.revoked).toStrictEqual([UID])
    expect([...api.active]).toStrictEqual([])
  })

  it('defaults to the supported ladders and revokes every issued right', async () => {
    const api = fakeApi()

    await runScript()

    expect(api.issued).toHaveLength(3)
    expect(api.revoked).toStrictEqual(api.issued)
    expect([...api.active]).toStrictEqual([])
  })

  it('fails visibly when revocation fails', async () => {
    vi.stubEnv('SMOKE_LADDERS', 'bearer')
    const api = fakeApi('revoke')

    await expect(runScript()).rejects.toThrow('revoke unavailable')
    expect([...api.active]).toStrictEqual([UID])
  })
})
