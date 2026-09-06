import { env } from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { portlessViteOverrides } from './vite.ts'

const originalPortlessUrl = env.PORTLESS_URL

describe(portlessViteOverrides, () => {
  afterEach(() => {
    if (originalPortlessUrl === undefined) {
      delete env.PORTLESS_URL
      return
    }
    env.PORTLESS_URL = originalPortlessUrl
  })

  it('does nothing outside Portless', () => {
    delete env.PORTLESS_URL

    expect(portlessViteOverrides('gate')).toBeUndefined()
  })

  it('adds a same-origin proxy for a worktree frontend', () => {
    const overrides = portlessViteOverrides('gate', 'https://feature-auth.gate.localhost')

    expect(overrides?.define).toStrictEqual({
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
    })
    expect(overrides?.proxy['/api']).toMatchObject({
      changeOrigin: true,
      target: 'https://feature-auth.api.localhost',
    })
    expect(overrides?.proxy['/api'].rewrite('/api/health')).toBe('/health')
    expect(overrides?.proxy['/api'].rewrite('/api')).toBe('/')
  })

  it('sets the member origin and exact WebAuthn hostname', () => {
    expect(portlessViteOverrides('app', 'https://feature-auth.app.localhost')?.define).toStrictEqual({
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
      'import.meta.env.VITE_APP_ORIGIN': JSON.stringify('https://feature-auth.app.localhost'),
      'import.meta.env.VITE_RP_ID': JSON.stringify('feature-auth.app.localhost'),
    })
  })

  it('derives the dash API origin', () => {
    expect(portlessViteOverrides('dash', 'https://feature-auth.dash.localhost')?.proxy['/api'].target).toBe(
      'https://feature-auth.api.localhost',
    )
  })

  it('propagates invalid PORTLESS_URL errors', () => {
    env.PORTLESS_URL = 'https://gate.localhost'

    expect(() => portlessViteOverrides('app')).toThrow(/Invalid PORTLESS_URL/u)
  })
})
