// @vitest-environment happy-dom
import { createQueryClient, useQuery, useQueryScope } from '@fuda/libs/query'
import type { QueryClient } from '@fuda/libs/query'
import { mount, settle } from '@fuda/ui/test'
import type { JSX } from 'preact'
import { afterEach, describe, expect, it, vi } from 'vitest'

const disposers: (() => void)[] = []
describe('Preact query ownership', () => {
  afterEach(() => {
    for (const dispose of disposers.splice(0)) {
      dispose()
    }
  })

  it('changes keys without ever rendering the old result and respects disabled state', async () => {
    const load = vi.fn<() => Promise<string>>(async () => await Promise.resolve('first'))
    const client = createQueryClient()
    const seen: (string | undefined)[] = []
    const View = (props: { id: string; enabled: boolean }): JSX.Element => {
      const result = useQuery(client, { enabled: props.enabled, queryFn: load, queryKey: [props.id] })
      seen.push(result.data)
      return <output>{result.data ?? 'loading'}</output>
    }
    const view = mount(<View enabled id="one" />)
    disposers.push(view.dispose)
    await vi.waitFor(() => {
      expect(view.host.textContent).toBe('first')
    })
    seen.length = 0
    await settle(() => {
      view.update(<View enabled={false} id="two" />)
    })
    expect(seen).not.toContain('first')
    expect(view.host.textContent).toBe('loading')
    expect(load).toHaveBeenCalledOnce()
    load.mockResolvedValue('second')
    await settle(() => {
      view.update(<View enabled id="two" />)
    })
    await vi.waitFor(() => {
      expect(view.host.textContent).toBe('second')
    })
    expect(load).toHaveBeenCalledTimes(2)
    await settle(() => {
      view.update(<View enabled id="two" />)
    })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('refetches on request, cancels explicitly and aborts only the departing observer', async () => {
    const requests: AbortSignal[] = []
    const pending = Promise.withResolvers<string>()
    const client = createQueryClient()
    const View = (props: { id: string }): JSX.Element => {
      const result = useQuery(client, {
        queryFn: async ({ signal }) => {
          requests.push(signal)
          return await pending.promise
        },
        queryKey: [props.id],
      })
      return (
        <button
          onClick={() => {
            void result.refetch()
          }}
        >
          {result.fetchStatus}
        </button>
      )
    }
    const first = mount(<View id="one" />)
    const second = mount(<View id="two" />)
    disposers.push(first.dispose, second.dispose)
    expect(requests).toHaveLength(2)
    first.dispose()
    expect(requests[0]?.aborted).toBe(true)
    expect(requests[1]?.aborted).toBe(false)
    await client.cancelQueries({ queryKey: ['two'] })
    expect(requests[1]?.aborted).toBe(true)
    await settle(() => second.host.querySelector('button')?.click())
    expect(requests).toHaveLength(3)
    pending.resolve('done')
    await vi.waitFor(() => {
      expect(second.host.textContent).toBe('idle')
    })
    await settle(() => second.host.querySelector('button')?.click())
    await vi.waitFor(() => {
      expect(requests).toHaveLength(4)
    })
  })

  it('keeps one scope across rerenders, clears on unmount and isolates owners', async () => {
    const clients: QueryClient[] = []
    const counts = new Map<QueryClient, { mount: number; unmount: number }>()
    const load = vi.fn<() => Promise<string>>(async () => await Promise.resolve('done'))
    const View = (): JSX.Element => {
      const client = useQueryScope()
      if (!clients.includes(client)) {
        clients.push(client)
        const lifetime = { mount: 0, unmount: 0 }
        counts.set(client, lifetime)
        const mountClient = client.mount.bind(client)
        const unmountClient = client.unmount.bind(client)
        vi.spyOn(client, 'mount').mockImplementation(() => {
          lifetime.mount += 1
          mountClient()
        })
        vi.spyOn(client, 'unmount').mockImplementation(() => {
          lifetime.unmount += 1
          unmountClient()
        })
      }
      const result = useQuery(client, { queryFn: load, queryKey: ['same'] })
      return <output>{result.data}</output>
    }
    const first = mount(<View />)
    const second = mount(<View />)
    disposers.push(first.dispose, second.dispose)
    await vi.waitFor(() => {
      expect(first.host.textContent).toBe('done')
    })
    await vi.waitFor(() => {
      expect(second.host.textContent).toBe('done')
    })
    await settle(() => {
      first.update(<View />)
    })
    expect(clients).toHaveLength(2)
    expect(load).toHaveBeenCalledTimes(2)
    first.dispose()
    expect({
      cache: clients[0]?.getQueryCache().getAll().length,
      lifetimes: [...counts.values()],
      remaining: clients[1]?.getQueryData(['same']),
    }).toStrictEqual({
      cache: 0,
      lifetimes: [
        { mount: 1, unmount: 1 },
        { mount: 1, unmount: 0 },
      ],
      remaining: 'done',
    })
    second.dispose()
    expect([...counts.values()]).toStrictEqual([
      { mount: 1, unmount: 1 },
      { mount: 1, unmount: 1 },
    ])
  })

  it('refreshes stale data on focus and reconnect only while its owner is mounted', async () => {
    let reads = 0
    const View = (): JSX.Element => {
      const client = useQueryScope()
      const result = useQuery(client, {
        queryFn: async () => {
          reads += 1
          return await Promise.resolve(String(reads))
        },
        queryKey: ['events'],
        staleTime: 0,
      })
      return <output>{result.data}</output>
    }
    const view = mount(<View />)
    disposers.push(view.dispose)
    await vi.waitFor(() => {
      expect(view.host.textContent).toBe('1')
    })
    const visible = vi.spyOn(document, 'visibilityState', 'get')
    visible.mockReturnValue('hidden')
    window.dispatchEvent(new Event('visibilitychange'))
    visible.mockReturnValue('visible')
    window.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => {
      expect(view.host.textContent).toBe('2')
    })
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => {
      expect(view.host.textContent).toBe('3')
    })
    view.dispose()
    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))
    await settle()
    expect(reads).toBe(3)
    visible.mockRestore()
  })
})
