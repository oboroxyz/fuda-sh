import { describe, expect, it, vi } from 'vitest'

import { createSingleFlight } from './single-flight.ts'

describe('single flight', () => {
  it('starts an action synchronously and suppresses duplicates until it settles', async () => {
    const pending = Promise.withResolvers<null>()
    const action = vi.fn<() => Promise<null>>(async () => await pending.promise)
    const flight = createSingleFlight<string>()

    const first = flight.run('uid', action)
    expect(flight.run('uid', action)).toBeNull()
    expect(flight.isRunning('uid')).toBe(true)
    expect(action).toHaveBeenCalledOnce()

    pending.resolve(null)
    await first
    expect(flight.isRunning('uid')).toBe(false)
    await flight.run('uid', action)
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('allows different keys independently and releases a rejected action for retry', async () => {
    const flight = createSingleFlight<string>()
    const pending = Promise.withResolvers<null>()
    const first = flight.run('first', async () => await pending.promise)
    await expect(flight.run('other', async () => await Promise.resolve('done'))).resolves.toBe('done')
    pending.reject(new Error('offline'))
    await expect(first).rejects.toThrow('offline')
    expect(flight.isRunning('first')).toBe(false)
    await expect(flight.run('first', async () => await Promise.resolve('retry'))).resolves.toBe('retry')
  })

  it('releases the key when the action throws before returning a promise', () => {
    const flight = createSingleFlight<string>()
    expect((): void => {
      void flight.run('uid', () => {
        throw new Error('synchronous failure')
      })
    }).toThrow('synchronous failure')
    expect(flight.isRunning('uid')).toBe(false)
  })
})
