import { MutationObserver } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'

import { createQueryClient, QueryError, readQueryResult } from './index.ts'

describe(createQueryClient, () => {
  it('shares one request between concurrent readers and reuses fresh data', async () => {
    const client = createQueryClient()
    const pending = Promise.withResolvers<string>()
    const queryFn = vi.fn<() => Promise<string>>(async () => await pending.promise)
    const options = { queryFn, queryKey: ['public'] as const }

    const first = client.query(options)
    const second = client.query(options)
    pending.resolve('fresh')

    await expect(Promise.all([first, second])).resolves.toStrictEqual(['fresh', 'fresh'])
    await expect(client.query(options)).resolves.toBe('fresh')
    expect(queryFn).toHaveBeenCalledOnce()
    client.clear()
  })

  it('refetches invalidated data', async () => {
    const client = createQueryClient()
    let value = 'first'
    const options = { queryFn: async () => await Promise.resolve(value), queryKey: ['changing'] as const }

    await expect(client.query(options)).resolves.toBe('first')
    value = 'second'
    await client.invalidateQueries({ queryKey: options.queryKey })

    await expect(client.query(options)).resolves.toBe('second')
    client.clear()
  })

  it('retries one transient read failure', async () => {
    const client = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new QueryError('offline', 0, true))
      .mockResolvedValueOnce('recovered')

    await expect(client.query({ queryFn, queryKey: ['retry'] })).resolves.toBe('recovered')
    expect(queryFn).toHaveBeenCalledTimes(2)
    client.clear()
  })

  it('retries a server failure even when it is not marked as a network failure', async () => {
    const client = createQueryClient()
    const queryFn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new QueryError('unavailable', 503, false))
      .mockResolvedValueOnce('recovered')

    await expect(client.query({ queryFn, queryKey: ['server-retry'] })).resolves.toBe('recovered')
    expect(queryFn).toHaveBeenCalledTimes(2)
    client.clear()
  })

  it('does not retry a 4xx read failure', async () => {
    const client = createQueryClient()
    const unauthorized = new QueryError('unauthorized', 401, false)
    const queryFn = vi.fn<() => Promise<string>>().mockRejectedValue(unauthorized)

    await expect(client.query({ queryFn, queryKey: ['private'] })).rejects.toBe(unauthorized)
    expect(queryFn).toHaveBeenCalledOnce()
    client.clear()
  })

  it('does not retry writes', async () => {
    const client = createQueryClient()
    const unavailable = new QueryError('unavailable', 503, true)
    const mutationFn = vi.fn<() => Promise<void>>().mockRejectedValue(unavailable)
    const observer = new MutationObserver(client, { mutationFn })

    await expect(observer.mutate()).rejects.toBe(unavailable)
    expect(mutationFn).toHaveBeenCalledOnce()
    client.clear()
  })
})

describe(readQueryResult, () => {
  it('returns a successful SDK body', () => {
    expect(readQueryResult({ body: { name: 'Fuda' }, ok: true })).toStrictEqual({ name: 'Fuda' })
  })

  it('throws a typed error with the SDK failure fields', () => {
    expect(() => readQueryResult({ error: 'unauthorized', network: false, ok: false, status: 401 })).toThrow(
      expect.objectContaining({ message: 'unauthorized', network: false, status: 401 }),
    )
  })
})
