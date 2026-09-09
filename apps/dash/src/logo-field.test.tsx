/** @jsxImportSource hono/jsx/dom */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { EMPTY_LOGO } from './logo.ts'
import { findViewNodes, viewProps } from './test/test-view.ts'

const LOCAL_LOGO = 'http://localhost:8787/assets/coffee/logo/master?v=version-1'

describe('logo preview connection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    { api: undefined, dev: true, expected: '/api/assets/coffee/logo/master?v=version-1', url: LOCAL_LOGO },
    { api: '/api', dev: true, expected: '/api/assets/coffee/logo/master?v=version-1', url: LOCAL_LOGO },
    { api: '/api', dev: false, expected: LOCAL_LOGO, url: LOCAL_LOGO },
    { api: 'https://api.fuda.sh', dev: true, expected: LOCAL_LOGO, url: LOCAL_LOGO },
    { api: 'http://localhost:8787', dev: true, expected: LOCAL_LOGO, url: LOCAL_LOGO },
    {
      api: undefined,
      dev: true,
      expected: 'https://cdn.example/logo.png?signature=abc',
      url: 'https://cdn.example/logo.png?signature=abc',
    },
    {
      api: undefined,
      dev: true,
      expected: 'http://localhost:8787/pass/example',
      url: 'http://localhost:8787/pass/example',
    },
    { api: undefined, dev: true, expected: '/saved-logo.png', url: '/saved-logo.png' },
  ])(
    'renders the saved logo through the appropriate connection: $dev / $api / $url',
    async ({ dev, api, url, expected }) => {
      vi.stubEnv('DEV', dev)
      vi.stubEnv('VITE_API_BASE_URL', api)
      vi.resetModules()
      const { LogoField } = await import('./LogoField.tsx')
      const view = LogoField({
        busy: false,
        copy: DASH_COPY.en.logo,
        id: 'logo',
        label: 'Logo',
        onClear: null,
        onPick: vi.fn<(file: File) => void>(),
        savedUrl: url,
        state: EMPTY_LOGO,
      })
      expect(viewProps(findViewNodes(view, 'img')[0]).src).toBe(expected)
    },
  )
})
