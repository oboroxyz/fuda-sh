/** @jsxImportSource solid-js */
import { focusManager, onlineManager } from '@tanstack/query-core'
import type { QueryFunctionContext } from '@tanstack/query-core'
import { createSignal } from 'solid-js'
import type { JSX } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createQueryClient } from './client.ts'
import type { QueryClient, QueryKey } from './index.ts'
import { createQuery, createQueryScope } from './solid.ts'

type StringQuery = (context: QueryFunctionContext) => Promise<string>

let dispose: (() => void) | undefined
const clients: QueryClient[] = []

const mount = (view: () => JSX.Element): HTMLElement => {
  const root = document.createElement('div')
  document.body.append(root)
  dispose = render(view, root)
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

const QueryValue = (props: {
  client: QueryClient
  id?: string
  queryFn: StringQuery
  queryKey: QueryKey
}): JSX.Element => {
  const result = createQuery(props.client, () => ({
    queryFn: props.queryFn,
    queryKey: props.queryKey,
    retry: false,
  }))
  return (
    <output
      id={props.id ?? 'result'}
    >{`${result().status}:${result().fetchStatus}:${result().data ?? ''}`}</output>
  )
}

describe('Solid query integration', () => {
  beforeEach(() => {
    focusManager.setFocused(true)
    onlineManager.setOnline(true)
  })

  afterEach(async () => {
    dispose?.()
    await Promise.resolve()
    for (const client of clients) {
      client.clear()
    }
    clients.length = 0
    dispose = undefined
    focusManager.setFocused(true)
    onlineManager.setOnline(true)
    document.body.replaceChildren()
  })

  describe(createQuery, () => {
    it('renders one shared request into two mounted readers', async () => {
      const client = createQueryClient()
      clients.push(client)
      const pending = Promise.withResolvers<string>()
      const queryFn = vi.fn<StringQuery>(async () => await pending.promise)
      const root = mount(() => (
        <div>
          <QueryValue client={client} id="first" queryFn={queryFn} queryKey={['shared']} />
          <QueryValue client={client} id="second" queryFn={queryFn} queryKey={['shared']} />
        </div>
      ))

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
        const [name, setName] = createSignal('old')
        const result = createQuery(client, () => ({ queryFn, queryKey: ['identity', name()], retry: false }))
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
            <output id="result">{`${result().status}:${result().fetchStatus}:${result().data ?? ''}`}</output>
          </div>
        )
      }
      const root = mount(() => <Harness />)
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
        const [enabled, setEnabled] = createSignal(false)
        const result = createQuery(client, () => ({
          enabled: enabled(),
          queryFn,
          queryKey: ['disabled'],
          retry: false,
        }))
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
            <output id="result">{`${result().status}:${result().fetchStatus}:${result().data ?? ''}`}</output>
          </div>
        )
      }
      const root = mount(() => <Harness />)

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
        const [version, setVersion] = createSignal<'first' | 'second'>('first')
        const result = createQuery(client, () => ({
          queryFn: version() === 'first' ? firstQuery : secondQuery,
          queryKey: ['options'],
          retry: false,
        }))
        return (
          <div data-version={version()}>
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
                result()
                  .refetch()
                  .catch(() => null)
              }}
              type="button"
            >
              refetch
            </button>
            <output id="result">{result().data ?? ''}</output>
          </div>
        )
      }
      const root = mount(() => <Harness />)
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

    it('refreshes mounted stale data on focus and reconnect', async () => {
      let calls = 0
      const queryFn = vi.fn<StringQuery>(async () => {
        calls += 1
        return await Promise.resolve(`value ${calls}`)
      })
      const Harness = (): JSX.Element => {
        const client = createQueryScope()
        const result = createQuery(client, () => ({
          queryFn,
          queryKey: ['browser'],
          retry: false,
          staleTime: 0,
        }))
        return <output id="result">{result().data ?? ''}</output>
      }
      const root = mount(() => <Harness />)
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
        const client = createQueryScope()
        const result = createQuery(client, () => ({
          queryFn,
          queryKey: ['interval'],
          refetchInterval: 10,
          retry: false,
          staleTime: 0,
        }))
        return <output id="result">{result().data ?? ''}</output>
      }
      const root = mount(() => <Harness />)

      await vi.waitFor(() => {
        expect(queryFn.mock.calls.length).toBeGreaterThanOrEqual(2)
        expect(resultText(root)).toMatch(/^tick [2-9]\d*$/u)
      })
    })
  })

  describe(createQueryScope, () => {
    it('aborts and clears its client when the owner is disposed', async () => {
      let client: QueryClient | undefined
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
        client = createQueryScope()
        const result = createQuery(client, () => ({ queryFn, queryKey: ['cleanup'], retry: false }))
        return <output id="result">{result().status}</output>
      }
      mount(() => <Harness />)
      await vi.waitFor(() => {
        expect(signal).toBeDefined()
      })

      dispose?.()
      dispose = undefined
      await vi.waitFor(() => {
        expect(signal?.aborted).toBe(true)
        expect(client?.getQueryCache().getAll()).toHaveLength(0)
      })
    })
  })
})
