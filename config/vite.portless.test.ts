import { env } from 'node:process'

import { afterEach, describe, expect, it } from 'vitest'

import { portlessViteConfig } from './vite.portless.ts'

const originalPortlessUrl = env.PORTLESS_URL
const originalAllowedHosts = env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS

describe(portlessViteConfig, () => {
  afterEach(() => {
    if (originalPortlessUrl === undefined) {
      delete env.PORTLESS_URL
    } else {
      env.PORTLESS_URL = originalPortlessUrl
    }

    if (originalAllowedHosts === undefined) {
      delete env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS
    } else {
      env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = originalAllowedHosts
    }
  })

  it('keeps the fixed Vite port without Portless overrides in direct development', () => {
    delete env.PORTLESS_URL

    expect(portlessViteConfig('gate', 5174)).toStrictEqual({
      server: { port: 5174, strictPort: true },
    })
  })

  it('uses same-origin api calls and proxies them to the direct api route', () => {
    const config = portlessViteConfig('gate', 5174, 'https://gate.localhost')
    const proxy = config.server.proxy?.['/api']

    expect(config.define).toStrictEqual({
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
    })
    expect(proxy).toMatchObject({ changeOrigin: true, target: 'https://api.localhost' })
    expect(proxy?.rewrite('/api/health')).toBe('/health')
    expect(proxy?.rewrite('/api')).toBe('/')
  })

  it('keeps the worktree prefix when deriving the api route', () => {
    env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = '.dev.example.com'
    const config = portlessViteConfig('dash', 5175, 'https://portless-local-dev.dash.dev.example.com:35815')

    expect(config.server.proxy?.['/api'].target).toBe('https://portless-local-dev.api.dev.example.com:35815')
  })

  it('derives the api route with a multi-segment custom TLD', () => {
    env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS = '.dev.example.com'

    const config = portlessViteConfig('gate', 5174, 'https://gate.dev.example.com')

    expect(config.server.proxy?.['/api'].target).toBe('https://api.dev.example.com')
  })

  it('injects the member app public origin and exact hostname', () => {
    const config = portlessViteConfig('app', 5173, 'https://portless-local-dev.app.localhost')

    expect(config.define).toStrictEqual({
      'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
      'import.meta.env.VITE_APP_ORIGIN': JSON.stringify('https://portless-local-dev.app.localhost'),
      'import.meta.env.VITE_RP_ID': JSON.stringify('portless-local-dev.app.localhost'),
    })
  })
})
