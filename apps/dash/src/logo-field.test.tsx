// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DASH_COPY } from './copy.ts'
import { EMPTY_LOGO } from './logo.ts'
import { cleanup, mount } from './test/render.tsx'

const LOCAL_LOGO = 'http://localhost:8787/assets/coffee/logo/master?v=version-1'

describe('logo preview connection', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it.each([
    { dev: true, expected: '/api/assets/coffee/logo/master?v=version-1', url: LOCAL_LOGO },
    { dev: false, expected: LOCAL_LOGO, url: LOCAL_LOGO },
    {
      dev: true,
      expected: 'https://cdn.example/logo.png?signature=abc',
      url: 'https://cdn.example/logo.png?signature=abc',
    },
    {
      dev: true,
      expected: 'http://localhost:8787/pass/example',
      url: 'http://localhost:8787/pass/example',
    },
    { dev: true, expected: '/saved-logo.png', url: '/saved-logo.png' },
  ])(
    'renders the saved logo through the appropriate connection: $dev / $url',
    async ({ dev, url, expected }) => {
      vi.stubEnv('DEV', dev)
      vi.resetModules()
      const { LogoField } = await import('./LogoField.tsx')
      const host = mount(() => (
        <LogoField
          busy={false}
          copy={DASH_COPY.en.logo}
          id="logo"
          label="Logo"
          onClear={null}
          onPick={vi.fn<(file: File) => void>()}
          savedUrl={url}
          state={EMPTY_LOGO}
        />
      ))
      expect(host.querySelector('img')?.getAttribute('src')).toBe(expected)
    },
  )
})
