import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const UID = `0x${'aa'.repeat(32)}`
const NONCE = `0x${'bb'.repeat(32)}`

// The script's only external boundary is HTTP. Track the remote active rights
// so cleanup assertions exercise the effect of /revoke, including early exits.
const fakeApi = (failAt?: string) => {
  const active = new Set<string>()
  const issued: string[] = []
  const revoked: string[] = []
  let scans = 0
  let signedScans = 0
  let level = 'bearer'
  const fetchSpy = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url, init) => {
    const { pathname } = new URL(url)
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
      return Response.json(
        active.has(UID) ? { decision: 'ADMIT' } : { decision: 'REJECT', reason: 'REVOKED' },
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

    expect(api.issued).toHaveLength(2)
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
