import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

import { portlessViteOverrides } from '../../tooling/portless/vite.ts'

const portless = portlessViteOverrides('app')

// Non-Portless direct development uses 5173; the member app owns this port.
export default defineConfig({
  // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- Portless additions must be absent in direct development.
  ...(portless === undefined ? {} : { define: portless.define }),
  plugins: [tailwindcss()],
  server: {
    port: 5173,
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- Portless proxying must be absent in direct development.
    ...(portless === undefined ? {} : { proxy: portless.proxy }),
    strictPort: true,
  },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
