import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

import { portlessViteConfig } from '../../vite.portless.ts'

// Portless injects its dynamic Vite port; direct development keeps the member app on 5173.
export default defineConfig({
  ...portlessViteConfig('app', 5173),
  plugins: [tailwindcss()],
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], unstubGlobals: true },
})
