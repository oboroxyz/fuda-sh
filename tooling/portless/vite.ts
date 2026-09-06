import { env } from 'node:process'

import { deriveApiOrigin } from './environment.ts'

export type FrontendName = 'app' | 'dash' | 'gate'

interface ViteDefineValues {
  'import.meta.env.VITE_API_BASE_URL': string
  'import.meta.env.VITE_APP_ORIGIN'?: string
  'import.meta.env.VITE_RP_ID'?: string
}

export interface PortlessViteOverrides {
  define: Record<string, string>
  proxy: Record<'/api', { changeOrigin: true; rewrite: (path: string) => string; target: string }>
}

export const portlessViteOverrides = (
  surface: FrontendName,
  publicUrl = env.PORTLESS_URL,
): PortlessViteOverrides | undefined => {
  if (publicUrl === undefined) {
    return undefined
  }

  const apiOrigin = deriveApiOrigin(publicUrl, surface)
  const memberUrl = new URL(publicUrl)
  const apiBaseUrl = JSON.stringify('/api')
  const define: ViteDefineValues = {
    'import.meta.env.VITE_API_BASE_URL': apiBaseUrl,
  }

  if (surface === 'app') {
    define['import.meta.env.VITE_APP_ORIGIN'] = JSON.stringify(memberUrl.origin)
    define['import.meta.env.VITE_RP_ID'] = JSON.stringify(memberUrl.hostname)
  }

  return {
    define: { ...define },
    proxy: {
      '/api': {
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api(?=\/|$)/u, '') || '/',
        target: apiOrigin,
      },
    },
  }
}
