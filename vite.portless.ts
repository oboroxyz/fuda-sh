import { env } from 'node:process'

type Frontend = 'app' | 'dash' | 'gate'

interface PortlessProxy {
  changeOrigin: true
  rewrite: (path: string) => string
  target: string
}

interface PortlessDefine {
  'import.meta.env.VITE_API_BASE_URL': string
  'import.meta.env.VITE_APP_ORIGIN'?: string
  'import.meta.env.VITE_RP_ID'?: string
}

interface PortlessViteConfig {
  define?: PortlessDefine
  server: {
    port: number
    proxy?: Record<'/api', PortlessProxy>
    strictPort: true
  }
}

export const portlessViteConfig = (
  frontend: Frontend,
  directPort: number,
  portlessUrl = env.PORTLESS_URL,
): PortlessViteConfig => {
  const server = { port: directPort, strictPort: true as const }
  if (portlessUrl === undefined) {
    return { server }
  }

  const publicUrl = new URL(portlessUrl)
  const apiUrl = new URL(portlessUrl)
  const [configuredHostSuffix = '.localhost'] = (
    env.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS ?? '.localhost'
  ).split(',')
  const normalizedHostSuffix = configuredHostSuffix.trim()
  const hostSuffix = normalizedHostSuffix.startsWith('.') ? normalizedHostSuffix : `.${normalizedHostSuffix}`
  const routeName = apiUrl.hostname.endsWith(hostSuffix) ? apiUrl.hostname.slice(0, -hostSuffix.length) : ''
  if (routeName !== frontend && !routeName.endsWith(`.${frontend}`)) {
    throw new Error(`Portless URL does not match the ${frontend} route or its configured host suffix`)
  }
  apiUrl.hostname = `${routeName.slice(0, -frontend.length)}api${hostSuffix}`

  const define =
    frontend === 'app'
      ? {
          'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
          'import.meta.env.VITE_APP_ORIGIN': JSON.stringify(publicUrl.origin),
          'import.meta.env.VITE_RP_ID': JSON.stringify(publicUrl.hostname),
        }
      : { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api') }

  return {
    define,
    server: {
      ...server,
      proxy: {
        '/api': {
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api(?=\/|$)/u, '') || '/',
          target: apiUrl.origin,
        },
      },
    },
  }
}
