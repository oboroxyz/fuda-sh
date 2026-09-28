import type { Hex } from '@fuda/sdk'
import type * as IdkitCore from '@worldcoin/idkit-core'
import { describe, expect, it, vi } from 'vitest'

const REJECTION = new Error('unknown_rp')

const constraints = vi.fn<() => Promise<never>>(async () => await Promise.reject(REJECTION))
const request = vi.fn<() => { constraints: typeof constraints }>(() => ({ constraints }))
const isInWorldApp = vi.fn<() => boolean>(() => false)
// Stand-ins for the constraint builders `humanConstraints` calls eagerly to
// build the argument to `.constraints()`, before that promise ever settles;
// their return shape does not matter here because `.constraints()` is mocked
// to reject regardless of what it is called with.
const any = vi.fn<(...nodes: unknown[]) => unknown>(() => ({}))
const CredentialRequest = vi.fn<(...args: unknown[]) => unknown>(() => ({}))

// SAFETY: the mock stands in for the whole module; `defaultHumanBadgeIo.open`
// only touches `IDKit.request(...).constraints(...)` and `isInWorldApp`, plus
// the constraint builders it calls to build that argument. This test never
// reaches `pollUntilCompletion` because `.constraints()` rejects first.
vi.mock(
  import('@worldcoin/idkit-core'),
  () =>
    ({ CredentialRequest, IDKit: { request }, any, isInWorldApp }) as unknown as Partial<typeof IdkitCore>,
)

const { defaultHumanBadgeIo } = await import('./badges.ts')

describe('defaultHumanBadgeIo.open', () => {
  it('logs the real rejection reason and fails closed to constraints_unsupported', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const uid: Hex = `0x${'ab'.repeat(32)}`
    const onConnect = vi.fn<(connectorUri: string) => void>()

    const result = await defaultHumanBadgeIo.open(
      {
        action: 'a',
        app_id: 'app_test',
        rp_context: { created_at: 0, expires_at: 0, nonce: '0x0', rp_id: 'r', signature: '0x0' },
      },
      uid,
      onConnect,
    )

    expect(result).toStrictEqual({ error: 'constraints_unsupported', success: false })
    expect(consoleError).toHaveBeenCalledWith('[fuda-app] World ID verification request failed', REJECTION)
    expect(onConnect).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('also fails closed when IDKit.request throws synchronously', async () => {
    request.mockImplementationOnce(() => {
      throw REJECTION
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const uid: Hex = `0x${'ab'.repeat(32)}`

    const result = await defaultHumanBadgeIo.open(
      {
        action: 'a',
        app_id: 'app_test',
        rp_context: { created_at: 0, expires_at: 0, nonce: '0x0', rp_id: 'r', signature: '0x0' },
      },
      uid,
      vi.fn<(connectorUri: string) => void>(),
    )

    expect(result).toStrictEqual({ error: 'constraints_unsupported', success: false })
    expect(consoleError).toHaveBeenCalledWith('[fuda-app] World ID verification request failed', REJECTION)
    consoleError.mockRestore()
  })
})
