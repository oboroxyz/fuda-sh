import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

import { portlessViteOverrides } from '../../tooling/portless/vite.ts'

const portless = portlessViteOverrides('dash')

// Non-Portless direct development uses 5175; 5173 is reserved for apps/app.
export default defineConfig({
  // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- Portless additions must be absent in direct development.
  ...(portless === undefined ? {} : { define: portless.define }),
  plugins: [tailwindcss()],
  server: {
    port: 5175,
    // oxlint-disable-next-line anti-slop/no-conditional-empty-object-spread -- Portless proxying must be absent in direct development.
    ...(portless === undefined ? {} : { proxy: portless.proxy }),
    strictPort: true,
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'], unstubGlobals: true },
})
