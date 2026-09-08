/** @jsxImportSource hono/jsx/dom */
import { focusManager, onlineManager } from '@tanstack/query-core'
import type { QueryFunctionContext } from '@tanstack/query-core'
import { render, useState } from 'hono/jsx/dom'
import type { JSX } from 'hono/jsx/dom/jsx-runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient, useQuery, useQueryScope } from './index.ts'
import type { QueryClient, QueryKey } from './index.ts'

type StringQuery = (context: QueryFunctionContext) => Promise<string>

let removeMounted: (() => void) | undefined
const clients: QueryClient[] = []

const Mount = ({ children }: { children: JSX.Element }): JSX.Element | null => {
  const [mounted, setMounted] = useState(true)
  removeMounted = () => {
    setMounted(false)
  }
  return mounted ? children : null
}

const mount = (child: JSX.Element): HTMLElement => {
  const root = document.createElement('div')
  document.body.append(root)
  render(<Mount>{child}</Mount>, root)
  return root
}

const click = (root: HTMLElement, id: string): void => {
  const button = root.querySelector<HTMLButtonElement>(`#${id}`)
  if (!button) {
    throw new Error(`missing button ${id}`)
  }
  button.click()
}

const resultText = (root: HTMLElement, id = 'result'): string | null =>
  root.querySelector<HTMLOutputElement>(`#${id}`)?.textContent ?? null

const QueryValue = ({
  client,
  id = 'result',
  queryFn,
  queryKey,
}: {
  client: QueryClient
  id?: string
  queryFn: StringQuery
  queryKey: QueryKey
}): JSX.Element => {
  const result = useQuery(client, { queryFn, queryKey, retry: false })
  return <output id={id}>{`${result.status}:${result.fetchStatus}:${result.data ?? ''}`}</output>
}

describe('Hono DOM query integration', () => {
  beforeEach(() => {
    focusManager.setFocused(true)
    onlineManager.setOnline(true)
  })

  afterEach(async () => {
    removeMounted?.()
    await Promise.resolve()
    for (const client of clients) {
      client.clear()
    }
    clients.length = 0
    removeMounted = undefined
    focusManager.setFocused(true)
    onlineManager.setOnline(true)
    document.body.replaceChildren()
  })

  describe(useQuery, () => {
    it('renders one shared request into two mounted readers', async () => {
      const client = createQueryClient()
      clients.push(client)
      const pending = Promise.withResolvers<string>()
      const queryFn = vi.fn<StringQuery>(async () => await pending.promise)
      const root = mount(
        <div>
          <QueryValue client={client} id="first" queryFn={queryFn} queryKey={['shared']} />
          <QueryValue client={client} id="second" queryFn={queryFn} queryKey={['shared']} />
        </div>,
      )

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledOnce()
      })
      pending.resolve('fresh')

      await vi.waitFor(() => {
        expect(resultText(root, 'first')).toBe('success:idle:fresh')
        expect(resultText(root, 'second')).toBe('success:idle:fresh')
      })
    })

    it('switches identity immediately and ignores the old key completing later', async () => {
      const client = createQueryClient()
      clients.push(client)
      const oldRequest = Promise.withResolvers<string>()
      const newRequest = Promise.withResolvers<string>()
      const queryFn = vi.fn<StringQuery>(async ({ queryKey }) =>
        queryKey[1] === 'old' ? await oldRequest.promise : await newRequest.promise,
      )
      const Harness = (): JSX.Element => {
        const [name, setName] = useState('old')
        const result = useQuery(client, { queryFn, queryKey: ['identity', name], retry: false })
        return (
          <div>
            <button
              id="change-key"
              onClick={() => {
                setName('new')
              }}
              type="button"
            >
              change
            </button>
            <output id="result">{`${result.status}:${result.fetchStatus}:${result.data ?? ''}`}</output>
          </div>
        )
      }
      const root = mount(<Harness />)
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledOnce()
      })

      click(root, 'change-key')

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledTimes(2)
        expect(resultText(root)).toBe('pending:fetching:')
      })
      newRequest.resolve('new data')
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('success:idle:new data')
      })

      oldRequest.resolve('old data')
      await Promise.resolve()
      expect(resultText(root)).toBe('success:idle:new data')
    })

    it('starts a disabled query when enabled changes', async () => {
      const client = createQueryClient()
      clients.push(client)
      const pending = Promise.withResolvers<string>()
      const queryFn = vi.fn<StringQuery>(async () => await pending.promise)
      const Harness = (): JSX.Element => {
        const [enabled, setEnabled] = useState(false)
        const result = useQuery(client, { enabled, queryFn, queryKey: ['disabled'], retry: false })
        return (
          <div>
            <button
              id="enable"
              onClick={() => {
                setEnabled(true)
              }}
              type="button"
            >
              enable
            </button>
            <output id="result">{`${result.status}:${result.fetchStatus}:${result.data ?? ''}`}</output>
          </div>
        )
      }
      const root = mount(<Harness />)

      expect(resultText(root)).toBe('pending:idle:')
      expect(queryFn).not.toHaveBeenCalled()
      click(root, 'enable')
      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledOnce()
      })
      pending.resolve('enabled')
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('success:idle:enabled')
      })
    })

    it('uses updated options when refetch is called', async () => {
      const client = createQueryClient()
      clients.push(client)
      const firstQuery = vi.fn<StringQuery>(async () => await Promise.resolve('first'))
      const secondQuery = vi.fn<StringQuery>(async () => await Promise.resolve('second'))
      const Harness = (): JSX.Element => {
        const [version, setVersion] = useState<'first' | 'second'>('first')
        const result = useQuery(client, {
          queryFn: version === 'first' ? firstQuery : secondQuery,
          queryKey: ['options'],
          retry: false,
        })
        return (
          <div data-version={version}>
            <button
              id="change-function"
              onClick={() => {
                setVersion('second')
              }}
              type="button"
            >
              change function
            </button>
            <button
              id="refetch"
              onClick={() => {
                result.refetch().catch(() => null)
              }}
              type="button"
            >
              refetch
            </button>
            <output id="result">{result.data ?? ''}</output>
          </div>
        )
      }
      const root = mount(<Harness />)
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('first')
      })

      click(root, 'change-function')
      await vi.waitFor(() => {
        expect(root.querySelector('[data-version="second"]')).not.toBeNull()
      })
      click(root, 'refetch')

      await vi.waitFor(() => {
        expect(resultText(root)).toBe('second')
      })
      expect(firstQuery).toHaveBeenCalledOnce()
      expect(secondQuery).toHaveBeenCalledOnce()
    })

    it('replaces the observer when its client changes', async () => {
      const firstClient = createQueryClient()
      const secondClient = createQueryClient()
      clients.push(firstClient, secondClient)
      firstClient.setQueryData(['client'], 'first cache')
      const secondRequest = Promise.withResolvers<string>()
      const queryFn = vi.fn<StringQuery>(async () => await secondRequest.promise)
      const Harness = (): JSX.Element => {
        const [client, setClient] = useState(firstClient)
        const result = useQuery(client, { queryFn, queryKey: ['client'], retry: false })
        return (
          <div>
            <button
              id="replace-client"
              onClick={() => {
                setClient(secondClient)
              }}
              type="button"
            >
              replace
            </button>
            <output id="result">{`${result.status}:${result.fetchStatus}:${result.data ?? ''}`}</output>
          </div>
        )
      }
      const root = mount(<Harness />)
      expect(resultText(root)).toBe('success:idle:first cache')

      click(root, 'replace-client')

      await vi.waitFor(() => {
        expect(queryFn).toHaveBeenCalledOnce()
        expect(resultText(root)).toBe('pending:fetching:')
      })
      secondRequest.resolve('second cache')
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('success:idle:second cache')
      })
    })

    it('refreshes mounted stale data on focus and reconnect', async () => {
      focusManager.setFocused(true)
      onlineManager.setOnline(true)
      let calls = 0
      const queryFn = vi.fn<StringQuery>(async () => {
        calls += 1
        return await Promise.resolve(`value ${calls}`)
      })
      const Harness = (): JSX.Element => {
        const client = useQueryScope()
        const result = useQuery(client, { queryFn, queryKey: ['browser'], retry: false, staleTime: 0 })
        return <output id="result">{result.data ?? ''}</output>
      }
      const root = mount(<Harness />)
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('value 1')
      })

      focusManager.setFocused(false)
      focusManager.setFocused(true)
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('value 2')
      })

      onlineManager.setOnline(false)
      onlineManager.setOnline(true)
      await vi.waitFor(() => {
        expect(resultText(root)).toBe('value 3')
      })
    })

    it('refreshes on the configured interval', async () => {
      let calls = 0
      const queryFn = vi.fn<StringQuery>(async () => {
        calls += 1
        return await Promise.resolve(`tick ${calls}`)
      })
      const Harness = (): JSX.Element => {
        const client = useQueryScope()
        const result = useQuery(client, {
          queryFn,
          queryKey: ['interval'],
          refetchInterval: 10,
          retry: false,
          staleTime: 0,
        })
        return <output id="result">{result.data ?? ''}</output>
      }
      const root = mount(<Harness />)

      await vi.waitFor(() => {
        expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(resultText(root)).toMatch(/^tick [2-9]\d*$/u)
      })
    })
  })

  describe(useQueryScope, () => {
    it('keeps one client across renders, then aborts and clears it on teardown', async () => {
      const seenClients: QueryClient[] = []
      let signal: AbortSignal | undefined
      const pending = Promise.withResolvers<string>()
      const queryFn = vi.fn<StringQuery>(async (context) => {
        const { signal: querySignal } = context
        signal = querySignal
        querySignal.addEventListener(
          'abort',
          () => {
            pending.resolve('cancelled')
          },
          { once: true },
        )
        return await pending.promise
      })
      const Harness = (): JSX.Element => {
        const client = useQueryScope()
        seenClients.push(client)
        const [count, setCount] = useState(0)
        const result = useQuery(client, { queryFn, queryKey: ['cleanup'], retry: false })
        return (
          <div>
            <button
              id="rerender"
              onClick={() => {
                setCount((value) => value + 1)
              }}
              type="button"
            >
              {count}
            </button>
            <output id="result">{result.status}</output>
          </div>
        )
      }
      const root = mount(<Harness />)
      await vi.waitFor(() => {
        expect(signal).toBeDefined()
      })

      click(root, 'rerender')
      await vi.waitFor(() => {
        expect(seenClients).toHaveLength(2)
      })
      expect(seenClients[1]).toBe(seenClients[0])

      removeMounted?.()
      await vi.waitFor(() => {
        expect(signal?.aborted).toBe(true)
        expect(seenClients[0]?.getQueryCache().getAll()).toHaveLength(0)
      })
    })
  })
})
