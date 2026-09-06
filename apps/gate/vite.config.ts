import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite-plus'

import { portlessViteConfig } from '../../vite.portless.ts'

// Portless injects its dynamic Vite port; direct development keeps the scanner on 5174.
export default defineConfig({
  ...portlessViteConfig('gate', 5174),
  plugins: [tailwindcss()],
  test: { environment: 'node', include: ['src/**/*.test.ts'], unstubGlobals: true },
})
